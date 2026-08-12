import { randomUUID } from 'node:crypto';

import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  createInitialState,
  generateMap,
  normalizeOrders,
  redact,
  rulesFor,
} from '@www/engine';
import type { GameResult, OrderSet, TurnReport, WorldEvent } from '@www/engine';

import type {
  CreateGameRequest,
  GameSummaryView,
  GameView,
  SeatView,
  SubmitOrdersRequest,
  SubmitOrdersResponse,
} from './api-types.js';
import type { Mailer } from './mailer.js';
import { resolveGameTurn } from './resolve.js';
import {
  games,
  ordersCol,
  orderDocId,
  parseMap,
  parseState,
  reportsCol,
  serializeMap,
  serializeState,
  usersCol,
  type GameDoc,
  type OrderDoc,
} from './store.js';

export interface AuthedUser {
  uid: string;
  name: string;
  email: string | null;
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const MIN_TURN_MINUTES = 5;
const MAX_TURN_MINUTES = 10_080; // one week

export async function createGame(
  db: Firestore,
  user: AuthedUser,
  req: CreateGameRequest,
): Promise<string> {
  const { playerCount, turnMinutes } = req;
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new HttpError(400, `playerCount must be an integer in [${MIN_PLAYERS}, ${MAX_PLAYERS}]`);
  }
  if (
    !Number.isInteger(turnMinutes) ||
    turnMinutes < MIN_TURN_MINUTES ||
    turnMinutes > MAX_TURN_MINUTES
  ) {
    throw new HttpError(
      400,
      `turnMinutes must be an integer in [${MIN_TURN_MINUTES}, ${MAX_TURN_MINUTES}]`,
    );
  }

  // The map ships to clients (and embeds its own seed), so it must not share
  // the combat seed — that one stays server-side and decides battle rolls.
  const seed = randomUUID();
  const map = generateMap(randomUUID(), playerCount);
  const seats: GameDoc['seats'] = Array.from({ length: playerCount }, () => null);
  seats[0] = { uid: user.uid, name: user.name, email: user.email, isBot: false };

  const doc: GameDoc = {
    status: 'lobby',
    createdBy: user.uid,
    createdAt: Timestamp.now(),
    playerCount,
    seats,
    turn: 1,
    deadlineAt: null,
    turnMinutes,
    remindedTurn: 0,
    seed,
    rules: rulesFor(playerCount),
    stateJson: null,
    mapJson: serializeMap(map),
  };

  const ref = games(db).doc();
  await ref.set(doc);
  await usersCol(db)
    .doc(user.uid)
    .set(
      { name: user.name, email: user.email, gameIds: FieldValue.arrayUnion(ref.id) },
      { merge: true },
    );
  return ref.id;
}

export async function loadGame(db: Firestore, gameId: string): Promise<GameDoc> {
  const snap = await games(db).doc(gameId).get();
  if (!snap.exists) throw new HttpError(404, 'game not found');
  return snap.data() as GameDoc;
}

export function slotOf(doc: GameDoc, uid: string): number | null {
  const slot = doc.seats.findIndex((s) => s !== null && s.uid === uid);
  return slot === -1 ? null : slot;
}

const seatViews = (doc: GameDoc): SeatView[] =>
  doc.seats.map((seat, slot) => ({
    slot,
    name: seat?.name ?? `Seat ${slot + 1}`,
    isBot: seat?.isBot ?? false,
    taken: seat !== null,
  }));

async function readReport(
  db: Firestore,
  gameId: string,
  turn: number,
): Promise<TurnReport | null> {
  if (turn < 1) return null;
  const snap = await reportsCol(db, gameId).doc(String(turn)).get();
  if (!snap.exists) return null;
  return JSON.parse(snap.get('reportJson') as string) as TurnReport;
}

export async function getView(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
  doc?: GameDoc,
): Promise<GameView> {
  const game = doc ?? (await loadGame(db, gameId));
  const mySlot = slotOf(game, user.uid);
  const state = parseState(game);

  const humanSlots = game.seats.flatMap((s, slot) => (s !== null && !s.isBot ? [slot] : []));
  const orderRefs = humanSlots.map((slot) =>
    ordersCol(db, gameId).doc(orderDocId(game.turn, slot)),
  );
  const orderSnaps = orderRefs.length > 0 ? await db.getAll(...orderRefs) : [];
  const lockedSlots: number[] = [];
  let myOrders: OrderSet | null = null;
  let myLocked = false;
  orderSnaps.forEach((snap, i) => {
    if (!snap.exists) return;
    const order = snap.data() as OrderDoc;
    const slot = humanSlots[i];
    if (order.locked) lockedSlots.push(slot);
    if (slot === mySlot) {
      myOrders = JSON.parse(order.ordersJson) as OrderSet;
      myLocked = order.locked;
    }
  });

  const latestReport = await readReport(db, gameId, game.turn - 1);
  const result: GameResult | null = latestReport?.result ?? null;

  return {
    id: gameId,
    status: game.status,
    playerCount: game.playerCount,
    seats: seatViews(game),
    turn: game.turn,
    deadlineAt: game.deadlineAt?.toDate().toISOString() ?? null,
    turnMinutes: game.turnMinutes,
    map: parseMap(game),
    state: state === null ? null : redact(state, mySlot),
    mySlot,
    myOrders,
    myLocked,
    lockedSlots,
    latestReport,
    result,
  };
}

const BOT_NAMES = [
  'General Ash',
  'Marshal Brook',
  'Warlord Cole',
  'Admiral Dune',
  'Commander Elm',
  'Strategos Fen',
  'Khan Gale',
  'Consul Hale',
  'Regent Iris',
  'Praetor Jet',
  'Overlord Kite',
  'Chancellor Lark',
];

/** Mutates `doc` in place: the game begins now. */
function activate(doc: GameDoc, now: Timestamp): void {
  doc.status = 'active';
  doc.stateJson = serializeState(createInitialState(parseMap(doc), doc.rules));
  doc.deadlineAt = Timestamp.fromMillis(now.toMillis() + doc.turnMinutes * 60_000);
}

export async function joinGame(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
): Promise<GameView> {
  const doc = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'game not found');
    const game = snap.data() as GameDoc;
    if (game.status !== 'lobby') throw new HttpError(409, 'game already started');
    if (slotOf(game, user.uid) !== null) throw new HttpError(409, 'already seated');
    const slot = game.seats.findIndex((s) => s === null);
    if (slot === -1) throw new HttpError(409, 'game is full');
    game.seats[slot] = { uid: user.uid, name: user.name, email: user.email, isBot: false };
    if (game.seats.every((s) => s !== null)) activate(game, Timestamp.now());
    tx.set(games(db).doc(gameId), game);
    tx.set(
      usersCol(db).doc(user.uid),
      { name: user.name, email: user.email, gameIds: FieldValue.arrayUnion(gameId) },
      { merge: true },
    );
    return game;
  });
  return getView(db, gameId, user, doc);
}

export async function startGame(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
): Promise<GameView> {
  const doc = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'game not found');
    const game = snap.data() as GameDoc;
    if (game.createdBy !== user.uid) throw new HttpError(403, 'only the creator can start');
    if (game.status !== 'lobby') throw new HttpError(409, 'game already started');
    game.seats = game.seats.map(
      (seat, slot) =>
        seat ?? { uid: null, name: BOT_NAMES[slot % BOT_NAMES.length], email: null, isBot: true },
    );
    activate(game, Timestamp.now());
    tx.set(games(db).doc(gameId), game);
    return game;
  });
  return getView(db, gameId, user, doc);
}

export async function submitOrders(
  db: Firestore,
  mailer: Mailer,
  baseUrl: string,
  gameId: string,
  user: AuthedUser,
  req: SubmitOrdersRequest,
): Promise<SubmitOrdersResponse> {
  const { turn, allLocked, warnings } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'game not found');
    const game = snap.data() as GameDoc;
    if (game.status !== 'active') throw new HttpError(409, 'game is not active');
    const mySlot = slotOf(game, user.uid);
    if (mySlot === null) throw new HttpError(403, 'not seated in this game');
    const state = parseState(game);
    if (state === null || state.status[mySlot] !== 'active') {
      throw new HttpError(403, 'player is not active in this game');
    }

    const orders: OrderSet = { ...req.orders, slot: mySlot };
    const events: WorldEvent[] = [];
    normalizeOrders(state, parseMap(game), mySlot, orders, events);
    const rejections = events.flatMap((e) => (e.kind === 'order_rejected' ? [e.reason] : []));

    const otherHumans = game.seats.flatMap((s, slot) =>
      s !== null && !s.isBot && slot !== mySlot && state.status[slot] === 'active' ? [slot] : [],
    );
    const lockSnaps =
      otherHumans.length > 0
        ? await tx.getAll(
            ...otherHumans.map((slot) => ordersCol(db, gameId).doc(orderDocId(game.turn, slot))),
          )
        : [];
    const othersLocked = lockSnaps.every(
      (s) => s.exists && (s.data() as OrderDoc).locked,
    );

    tx.set(ordersCol(db, gameId).doc(orderDocId(game.turn, mySlot)), {
      ordersJson: JSON.stringify(orders),
      locked: req.locked,
      updatedAt: Timestamp.now(),
    } satisfies OrderDoc);

    return { turn: game.turn, allLocked: req.locked && othersLocked, warnings: rejections };
  });

  let resolved = false;
  if (allLocked) {
    resolved = (await resolveGameTurn(db, mailer, baseUrl, gameId, turn)).resolved;
  }
  return { warnings, resolved, view: await getView(db, gameId, user) };
}

export async function listGames(db: Firestore, user: AuthedUser): Promise<GameSummaryView[]> {
  const userSnap = await usersCol(db).doc(user.uid).get();
  const gameIds = (userSnap.get('gameIds') as string[] | undefined) ?? [];
  if (gameIds.length === 0) return [];

  const snaps = await db.getAll(...gameIds.map((id) => games(db).doc(id)));
  const summaries: GameSummaryView[] = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const doc = snap.data() as GameDoc;
    const mySlot = slotOf(doc, user.uid);
    let myLocked = false;
    if (mySlot !== null) {
      const orderSnap = await ordersCol(db, snap.id).doc(orderDocId(doc.turn, mySlot)).get();
      myLocked = orderSnap.exists && (orderSnap.data() as OrderDoc).locked;
    }
    summaries.push({
      id: snap.id,
      status: doc.status,
      playerCount: doc.playerCount,
      seatsFilled: doc.seats.filter((s) => s !== null).length,
      turn: doc.turn,
      deadlineAt: doc.deadlineAt?.toDate().toISOString() ?? null,
      mySlot,
      myLocked,
    });
  }
  return summaries;
}
