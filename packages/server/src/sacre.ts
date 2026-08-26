/**
 * S.A.C.R.E. Bleu!'s half of the server.
 *
 * Same shape as the dinner party's, and for the same reason: this is a live
 * game for people in a room, so the clock is advanced on every read and
 * `tick.ts` is only the backstop for a table that has pocketed its phones. A
 * once-a-minute sweep cannot drive a two-minute turn, let alone the pending
 * answer inside one.
 *
 * The advance and the action share one transaction. Split them and a card
 * arrives for an Advertise that has already timed out and been settled.
 */

import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_TURN_SECONDS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  advanceSacre,
  applySacreAction,
  deal,
  emptyState,
  redactSacre,
  type SacreAction,
  type SacreState,
} from '@www/engine/sacre';
import { HttpError, type AuthedUser } from './games.js';
import type {
  CreateGameRequest,
  GameStatus,
  SacreActionRequest,
  SacreGameView,
  SacreSeatView,
  UpdateSacreConfigRequest,
} from './api-types.js';
import {
  games,
  isSacreDoc,
  parseSacre,
  serializeSacre,
  usersCol,
  type GameDoc,
  type SacreGameDoc,
  type Seat,
} from './store.js';

const MIN_TURN_SECONDS = 30;
const MAX_TURN_SECONDS = 600;

const clampSeconds = (value: number): number =>
  Math.max(MIN_TURN_SECONDS, Math.min(MAX_TURN_SECONDS, Math.round(value)));

const deadlineOf = (state: SacreState): Timestamp | null =>
  state.phaseEndsAt === null ? null : Timestamp.fromMillis(state.phaseEndsAt);

/** Derived from the phase, never tracked beside it, so the two cannot disagree. */
const statusFor = (state: SacreState): GameStatus =>
  state.phase === 'lobby' ? 'lobby' : state.phase === 'over' ? 'finished' : 'active';

/** Everything the document derives from game state, in one place. */
const sacreFields = (state: SacreState): Partial<SacreGameDoc> => ({
  sacreJson: serializeSacre(state),
  deadlineAt: deadlineOf(state),
  status: statusFor(state),
  turn: state.round,
});

function readSacre(doc: SacreGameDoc): SacreState {
  const state = parseSacre(doc);
  if (state === null) throw new HttpError(500, 'card game has no state');
  return state;
}

async function loadSacre(db: Firestore, gameId: string): Promise<SacreGameDoc> {
  const snap = await games(db).doc(gameId).get();
  if (!snap.exists) throw new HttpError(404, 'card game not found');
  const doc = snap.data() as GameDoc;
  if (!isSacreDoc(doc)) throw new HttpError(409, 'that is not a card game');
  return doc;
}

const slotOf = (doc: SacreGameDoc, uid: string): number | null => {
  const slot = doc.seats.findIndex((s) => s !== null && s.uid === uid);
  return slot === -1 ? null : slot;
};

const seatViews = (doc: SacreGameDoc): SacreSeatView[] =>
  doc.seats.map((seat, slot) => ({
    slot,
    name: seat?.name ?? '',
    taken: seat !== null,
    isHost: seat !== null && seat.uid === doc.createdBy,
  }));

function view(
  doc: SacreGameDoc,
  id: string,
  state: SacreState,
  mySlot: number | null,
  note: string | null,
): SacreGameView {
  return {
    kind: 'cards',
    id,
    status: statusFor(state),
    seats: seatViews(doc),
    maxSeats: doc.playerCount,
    mySlot,
    isHost: doc.seats.some(
      (s) => s !== null && s.uid === doc.createdBy && slotOf(doc, s.uid) === mySlot,
    ),
    phaseEndsAt: state.phaseEndsAt === null ? null : new Date(state.phaseEndsAt).toISOString(),
    game: redactSacre(state, mySlot),
    note,
  };
}

export async function createSacreGame(
  db: Firestore,
  user: AuthedUser,
  req: CreateGameRequest,
): Promise<string> {
  const wanted = typeof req.players === 'number' ? req.players : 4;
  const playerCount = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.round(wanted)));

  const seats: (Seat | null)[] = Array.from({ length: playerCount }, () => null);
  seats[0] = { uid: user.uid, name: user.name, email: user.email, isBot: false, dependents: [] };

  const seed = randomUUID();
  const state = emptyState(seed, playerCount, DEFAULT_TURN_SECONDS);

  const doc: SacreGameDoc = {
    kind: 'cards',
    status: 'lobby',
    createdBy: user.uid,
    createdAt: Timestamp.now(),
    playerCount,
    seats,
    turn: 0,
    deadlineAt: null,
    turnMinutes: Math.ceil(DEFAULT_TURN_SECONDS / 60),
    remindedTurn: 0,
    seed,
    sacreJson: serializeSacre(state),
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

/**
 * A read that may write.
 *
 * The common poll writes nothing. At a turn boundary every phone at the table
 * races here at once; they serialize on the one document, the first wins, and
 * the rest re-read inside their transaction and find the advance already made.
 */
export async function getSacreView(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
): Promise<SacreGameView> {
  const doc = await loadSacre(db, gameId);
  const state = readSacre(doc);
  const advanced = advanceSacre(state, Date.now());
  if (!advanced.changed) return view(doc, gameId, state, slotOf(doc, user.uid), null);

  const settled = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    const fresh = snap.data() as SacreGameDoc;
    const again = advanceSacre(readSacre(fresh), Date.now());
    if (again.changed) tx.update(games(db).doc(gameId), sacreFields(again.state));
    return again.state;
  });
  return view(doc, gameId, settled, slotOf(doc, user.uid), null);
}

export async function takeSacreSeat(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
): Promise<SacreGameView> {
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'card game not found');
    const game = snap.data() as GameDoc;
    if (!isSacreDoc(game)) throw new HttpError(409, 'that is not a card game');

    const already = slotOf(game, user.uid);
    if (already !== null) return { doc: game, mySlot: already };
    if (game.status !== 'lobby') throw new HttpError(409, 'the game has already been dealt');

    const free = game.seats.findIndex((s) => s === null);
    if (free === -1) throw new HttpError(409, 'the table is full');

    const seats = game.seats.slice();
    seats[free] = {
      uid: user.uid,
      name: user.name,
      email: user.email,
      isBot: false,
      dependents: [],
    };
    tx.update(games(db).doc(gameId), { seats });
    tx.set(
      usersCol(db).doc(user.uid),
      { name: user.name, email: user.email, gameIds: FieldValue.arrayUnion(gameId) },
      { merge: true },
    );
    return { doc: { ...game, seats }, mySlot: free };
  });

  return view(outcome.doc, gameId, readSacre(outcome.doc), outcome.mySlot, null);
}

export async function updateSacreConfig(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
  req: UpdateSacreConfigRequest,
): Promise<SacreGameView> {
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'card game not found');
    const game = snap.data() as GameDoc;
    if (!isSacreDoc(game)) throw new HttpError(409, 'that is not a card game');
    if (game.createdBy !== user.uid) throw new HttpError(403, 'only the host sets the dials');
    if (game.status !== 'lobby') throw new HttpError(409, 'the game has already been dealt');

    const state = readSacre(game);
    const turnSeconds =
      typeof req.turnSeconds === 'number' ? clampSeconds(req.turnSeconds) : state.turnSeconds;
    const next = { ...state, turnSeconds };
    tx.update(games(db).doc(gameId), {
      ...sacreFields(next),
      turnMinutes: Math.ceil(turnSeconds / 60),
    });
    return { doc: game, state: next };
  });

  return view(outcome.doc, gameId, outcome.state, slotOf(outcome.doc, user.uid), null);
}

export async function actOnSacre(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
  req: SacreActionRequest,
): Promise<SacreGameView> {
  const action = req.action as SacreAction | undefined;
  if (action === undefined || typeof action.type !== 'string') {
    throw new HttpError(400, 'no action');
  }

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'card game not found');
    const game = snap.data() as GameDoc;
    if (!isSacreDoc(game)) throw new HttpError(409, 'that is not a card game');
    const mySlot = slotOf(game, user.uid);
    if (mySlot === null) throw new HttpError(403, 'you are not at this table');

    const now = Date.now();
    const state = readSacre(game);

    // The deal is the host's, and it is the one action the turn machine does
    // not own -- everything after it goes through applySacreAction.
    if (action.type === 'deal') {
      if (game.createdBy !== user.uid) throw new HttpError(403, 'only the host deals');
      if (state.phase !== 'lobby') throw new HttpError(409, 'already dealt');
      if (game.seats.filter((s) => s !== null).length < MIN_PLAYERS) {
        throw new HttpError(409, 'not enough players yet');
      }
      const dealt = deal(state, now);
      tx.update(games(db).doc(gameId), sacreFields(dealt));
      return { doc: game, state: dealt, mySlot, note: null as string | null };
    }

    const advanced = advanceSacre(state, now);
    const applied = applySacreAction(advanced.state, action, { slot: mySlot, nowMs: now });
    // An answer that completes a pending, or a turn that is done, rolls
    // straight on rather than waiting for the next poll.
    const rolled = advanceSacre(applied.state, now);

    if (advanced.changed || applied.changed || rolled.changed) {
      tx.update(games(db).doc(gameId), sacreFields(rolled.state));
    }
    return { doc: game, state: rolled.state, mySlot, note: applied.message ?? null };
  });

  return view(outcome.doc, gameId, outcome.state, outcome.mySlot, outcome.note);
}

/** The backstop. Every request advances its own clock; this is for an empty room. */
export async function advanceSacreGame(db: Firestore, gameId: string, now: Date): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) return false;
    const fresh = snap.data() as GameDoc;
    if (!isSacreDoc(fresh)) return false;
    const advanced = advanceSacre(readSacre(fresh), now.getTime());
    if (!advanced.changed) return false;
    tx.update(games(db).doc(gameId), sacreFields(advanced.state));
    return true;
  });
}
