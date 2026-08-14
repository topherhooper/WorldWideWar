import { randomUUID } from 'node:crypto';

import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  MAX_PLAYERS,
  MAX_TURN_CAP,
  MIN_PLAYERS,
  MIN_TURN_CAP,
  createInitialState,
  decideTiersList,
  generateMap,
  makeTiersList,
  normalizeOrders,
  normalizeTiersList,
  presetById,
  presetRules,
  redact,
  substream,
  tiersWarnings,
  topicForTurn,
} from '@www/engine';
import type { GameResult, OrderSet, TurnReport, WorldEvent } from '@www/engine';

import type {
  CreateGameRequest,
  GameSummaryView,
  GameView,
  SeatView,
  SubmitOrdersRequest,
  SubmitOrdersResponse,
  UpdateConfigRequest,
} from './api-types.js';
import type { NotifyDeps } from './notify.js';
import { resolveGameTurn } from './resolve.js';
import {
  effectiveRules,
  games,
  humanSlots,
  liveHumanSlots,
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
const LOBBY_START_PLAYERS = 4;

export async function createGame(
  db: Firestore,
  user: AuthedUser,
  req: CreateGameRequest,
): Promise<string> {
  const preset = presetById(typeof req.presetId === 'string' ? req.presetId : '');
  if (preset === null) throw new HttpError(400, 'unknown preset');
  const playerCount = LOBBY_START_PLAYERS;

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
    turnMinutes: preset.defaultTurnMinutes,
    remindedTurn: 0,
    seed,
    presetId: preset.id,
    rules: presetRules(preset, playerCount, preset.defaultTurnCap),
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

async function loadGame(db: Firestore, gameId: string): Promise<GameDoc> {
  const snap = await games(db).doc(gameId).get();
  if (!snap.exists) throw new HttpError(404, 'game not found');
  return snap.data() as GameDoc;
}

function slotOf(doc: GameDoc, uid: string): number | null {
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

export async function readReport(
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

  const humans = humanSlots(game.seats);
  const orderRefs = humans.map((slot) => ordersCol(db, gameId).doc(orderDocId(game.turn, slot)));
  const orderSnaps = orderRefs.length > 0 ? await db.getAll(...orderRefs) : [];
  const lockedSlots: number[] = [];
  let myOrders: OrderSet | null = null;
  let myLocked = false;
  orderSnaps.forEach((snap, i) => {
    if (!snap.exists) return;
    const order = snap.data() as OrderDoc;
    const slot = humans[i];
    if (order.locked) lockedSlots.push(slot);
    if (slot === mySlot) {
      myOrders = JSON.parse(order.ordersJson) as OrderSet;
      myLocked = order.locked;
    }
  });

  const latestReport = await readReport(db, gameId, game.turn - 1);
  const result: GameResult | null = latestReport?.result ?? null;

  const contest = game.rules.contest ?? 'pact';
  const rules = effectiveRules(game);
  const preset = presetById(game.presetId ?? contest);
  let tiersTopic: string | null = null;
  let lobbyListSlots: number[] = [];
  if (contest === 'tiers') {
    tiersTopic = topicForTurn(game.seed, game.status === 'lobby' ? 0 : game.turn).title;
    if (game.status === 'lobby') {
      if (humans.length > 0) {
        const snaps = await db.getAll(
          ...humans.map((slot) => ordersCol(db, gameId).doc(orderDocId(0, slot))),
        );
        lobbyListSlots = humans.filter((_, i) => snaps[i].exists);
      }
    }
  }

  return {
    id: gameId,
    status: game.status,
    playerCount: game.playerCount,
    seats: seatViews(game),
    turn: game.turn,
    deadlineAt: game.deadlineAt?.toDate().toISOString() ?? null,
    turnMinutes: game.turnMinutes,
    contest,
    turnCap: rules.turnCap,
    rules,
    presetId: game.presetId ?? null,
    presetName: preset?.name ?? (contest === 'tiers' ? 'Tiers' : 'Pact'),
    tiersTopic,
    lobbyListSlots,
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

/** Lobby ("turn 0") lists per slot, read inside a transaction before any writes. */
async function readLobbyLists(
  tx: FirebaseFirestore.Transaction,
  db: Firestore,
  gameId: string,
  game: GameDoc,
): Promise<(string[] | null)[]> {
  const lists: (string[] | null)[] = new Array(game.playerCount).fill(null);
  if ((game.rules.contest ?? 'pact') !== 'tiers') return lists;
  const humans = humanSlots(game.seats);
  if (humans.length === 0) return lists;
  const snaps = await tx.getAll(
    ...humans.map((slot) => ordersCol(db, gameId).doc(orderDocId(0, slot))),
  );
  snaps.forEach((snap, i) => {
    if (!snap.exists) return;
    const set = JSON.parse((snap.data() as OrderDoc).ordersJson) as OrderSet;
    lists[humans[i]] = set.tiers?.list ?? null;
  });
  return lists;
}

function canActivate(game: GameDoc, lobbyLists: readonly (string[] | null)[]): boolean {
  if (!game.seats.every((seat) => seat !== null)) return false;
  if ((game.rules.contest ?? 'pact') !== 'tiers') return true;
  // A seat is not ready until its first list is in.
  return humanSlots(game.seats).every((slot) => normalizeTiersList(lobbyLists[slot]) !== null);
}

/** Mutates `doc` in place: the game begins now. */
function activate(doc: GameDoc, now: Timestamp, lobbyLists: readonly (string[] | null)[]): void {
  doc.status = 'active';
  const map = parseMap(doc);
  const state = createInitialState(map, effectiveRules(doc));
  if ((doc.rules.contest ?? 'pact') === 'tiers') {
    for (let slot = 0; slot < doc.playerCount; slot++) {
      const raw = doc.seats[slot]?.isBot
        ? decideTiersList(topicForTurn(doc.seed, 0), substream(doc.seed, 'tiers-bot-list', slot))
        : lobbyLists[slot];
      state.tiersLists[slot] = makeTiersList(raw, doc.seed, 0, slot);
    }
  }
  doc.stateJson = serializeState(state);
  doc.deadlineAt = Timestamp.fromMillis(now.toMillis() + doc.turnMinutes * 60_000);
}

export async function deleteGame(db: Firestore, gameId: string, user: AuthedUser): Promise<void> {
  const game = await loadGame(db, gameId);
  if (game.createdBy !== user.uid) throw new HttpError(403, 'only the creator can delete');

  // Take the game out of every seated human's list first, so a concurrent
  // listGames cannot surface a half-deleted id.
  const uids = new Set(game.seats.flatMap((s) => (s !== null && s.uid !== null ? [s.uid] : [])));
  await Promise.all(
    [...uids].map((uid) =>
      usersCol(db)
        .doc(uid)
        .set({ gameIds: FieldValue.arrayRemove(gameId) }, { merge: true }),
    ),
  );
  // Removes the orders and reports subcollections along with the doc.
  await db.recursiveDelete(games(db).doc(gameId));
}

export async function joinGame(db: Firestore, gameId: string, user: AuthedUser): Promise<GameView> {
  const doc = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'game not found');
    const game = snap.data() as GameDoc;
    if (game.status !== 'lobby') throw new HttpError(409, 'game already started');
    if (slotOf(game, user.uid) !== null) throw new HttpError(409, 'already seated');
    const lobbyLists = await readLobbyLists(tx, db, gameId, game);
    const slot = game.seats.findIndex((s) => s === null);
    if (slot === -1) throw new HttpError(409, 'game is full');
    game.seats[slot] = { uid: user.uid, name: user.name, email: user.email, isBot: false };
    if (canActivate(game, lobbyLists)) activate(game, Timestamp.now(), lobbyLists);
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
    const lobbyLists = await readLobbyLists(tx, db, gameId, game);
    game.seats = game.seats.map(
      (seat, slot) =>
        seat ?? { uid: null, name: BOT_NAMES[slot % BOT_NAMES.length], email: null, isBot: true },
    );
    if (!canActivate(game, lobbyLists)) {
      throw new HttpError(409, 'waiting for tier lists from seated players');
    }
    activate(game, Timestamp.now(), lobbyLists);
    tx.set(games(db).doc(gameId), game);
    return game;
  });
  return getView(db, gameId, user, doc);
}

/**
 * Creator-only lobby tuning. The preset is the game's identity and immutable;
 * everything else — table size, clock, length — is negotiable until start.
 */
export async function updateConfig(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
  req: UpdateConfigRequest,
): Promise<GameView> {
  const doc = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'game not found');
    const game = snap.data() as GameDoc;
    if (game.createdBy !== user.uid) throw new HttpError(403, 'only the creator can configure');
    if (game.status !== 'lobby') throw new HttpError(409, 'game already started');

    const playerCount = req.playerCount ?? game.playerCount;
    const turnMinutes = req.turnMinutes ?? game.turnMinutes;
    const turnCap = req.turnCap ?? effectiveRules(game).turnCap;
    if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
      throw new HttpError(
        400,
        `playerCount must be an integer in [${MIN_PLAYERS}, ${MAX_PLAYERS}]`,
      );
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
    if (!Number.isInteger(turnCap) || turnCap < MIN_TURN_CAP || turnCap > MAX_TURN_CAP) {
      throw new HttpError(400, `turnCap must be an integer in [${MIN_TURN_CAP}, ${MAX_TURN_CAP}]`);
    }

    // Classic preset ids equal the contest kinds, so a legacy lobby without a
    // presetId still resolves to the preset matching its contest.
    const preset = presetById(game.presetId ?? game.rules.contest ?? 'pact');
    if (preset === null) throw new HttpError(500, 'game has no recognisable preset');

    if (playerCount !== game.playerCount) {
      if (game.seats.slice(playerCount).some((seat) => seat !== null)) {
        throw new HttpError(409, 'players are already seated beyond that count');
      }
      game.mapJson = serializeMap(generateMap(randomUUID(), playerCount));
      game.seats = Array.from({ length: playerCount }, (_, slot) => game.seats[slot] ?? null);
      game.playerCount = playerCount;
    }
    game.turnMinutes = turnMinutes;
    game.rules = presetRules(preset, playerCount, turnCap);

    tx.set(games(db).doc(gameId), game);
    return game;
  });
  return getView(db, gameId, user, doc);
}

/**
 * Creator ends the current turn on demand — the deadline and the all-locked
 * shortcut are not the only ways forward. Unlocked players fight with whatever
 * draft they last autosaved, exactly as if the deadline had passed.
 */
export async function resolveNow(
  deps: NotifyDeps,
  gameId: string,
  user: AuthedUser,
): Promise<GameView> {
  const { db } = deps;
  const game = await loadGame(db, gameId);
  if (game.createdBy !== user.uid) throw new HttpError(403, 'only the creator can end the turn');
  if (game.status !== 'active') throw new HttpError(409, 'game is not active');
  await resolveGameTurn(deps, gameId, game.turn);
  return getView(db, gameId, user);
}

export async function submitLobbyList(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
  listRaw: unknown,
): Promise<GameView> {
  const list = normalizeTiersList(listRaw);
  if (list === null) {
    throw new HttpError(400, 'list must be six distinct, non-empty entries');
  }
  const doc = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'game not found');
    const game = snap.data() as GameDoc;
    if ((game.rules.contest ?? 'pact') !== 'tiers') {
      throw new HttpError(409, 'this game has no tier lists');
    }
    if (game.status !== 'lobby') throw new HttpError(409, 'game already started');
    const mySlot = slotOf(game, user.uid);
    if (mySlot === null) throw new HttpError(403, 'not seated in this game');

    const lobbyLists = await readLobbyLists(tx, db, gameId, game);
    lobbyLists[mySlot] = list;

    tx.set(ordersCol(db, gameId).doc(orderDocId(0, mySlot)), {
      ordersJson: JSON.stringify({
        slot: mySlot,
        pledge: null,
        deploys: [],
        units: [],
        tiers: { list, guesses: [] },
      } satisfies OrderSet),
      locked: true,
      updatedAt: Timestamp.now(),
    } satisfies OrderDoc);

    if (canActivate(game, lobbyLists)) {
      activate(game, Timestamp.now(), lobbyLists);
      tx.set(games(db).doc(gameId), game);
    }
    return game;
  });
  return getView(db, gameId, user, doc);
}

export async function submitOrders(
  deps: NotifyDeps,
  gameId: string,
  user: AuthedUser,
  req: SubmitOrdersRequest,
): Promise<SubmitOrdersResponse> {
  const { db } = deps;
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
    if ((game.rules.contest ?? 'pact') === 'tiers' && req.locked) {
      // Only on lock-in: warning about a half-typed list on every autosave is noise.
      rejections.push(...tiersWarnings(state, mySlot, orders.tiers ?? null));
    }

    const otherHumans = liveHumanSlots(game.seats, state).filter((slot) => slot !== mySlot);
    const lockSnaps =
      otherHumans.length > 0
        ? await tx.getAll(
            ...otherHumans.map((slot) => ordersCol(db, gameId).doc(orderDocId(game.turn, slot))),
          )
        : [];
    const othersLocked = lockSnaps.every((s) => s.exists && (s.data() as OrderDoc).locked);

    tx.set(ordersCol(db, gameId).doc(orderDocId(game.turn, mySlot)), {
      ordersJson: JSON.stringify(orders),
      locked: req.locked,
      updatedAt: Timestamp.now(),
    } satisfies OrderDoc);

    return { turn: game.turn, allLocked: req.locked && othersLocked, warnings: rejections };
  });

  let resolved = false;
  if (allLocked) {
    resolved = (await resolveGameTurn(deps, gameId, turn)).resolved;
  }
  return { warnings, resolved, view: await getView(db, gameId, user) };
}

export async function listGames(db: Firestore, user: AuthedUser): Promise<GameSummaryView[]> {
  const userSnap = await usersCol(db).doc(user.uid).get();
  const gameIds = (userSnap.get('gameIds') as string[] | undefined) ?? [];
  if (gameIds.length === 0) return [];

  const snaps = await db.getAll(...gameIds.map((id) => games(db).doc(id)));
  const rows = snaps.flatMap((snap) => {
    if (!snap.exists) return [];
    const doc = snap.data() as GameDoc;
    return [{ id: snap.id, doc, mySlot: slotOf(doc, user.uid) }];
  });

  const seated = rows.filter((r) => r.mySlot !== null);
  const orderSnaps =
    seated.length > 0
      ? await db.getAll(
          ...seated.map((r) => ordersCol(db, r.id).doc(orderDocId(r.doc.turn, r.mySlot ?? 0))),
        )
      : [];
  const lockedByGame = new Map(
    seated.map((r, i) => [r.id, orderSnaps[i].exists && (orderSnaps[i].data() as OrderDoc).locked]),
  );

  return rows.map(({ id, doc, mySlot }) => ({
    id,
    status: doc.status,
    playerCount: doc.playerCount,
    seatsFilled: doc.seats.filter((s) => s !== null).length,
    turn: doc.turn,
    deadlineAt: doc.deadlineAt?.toDate().toISOString() ?? null,
    mySlot,
    myLocked: lockedByGame.get(id) ?? false,
  }));
}
