/**
 * The dinner party's half of the server.
 *
 * Every entry point has the same shape: read the document, notice what time it
 * is, apply at most one action, write only if something changed, and answer
 * with a redacted view. The clock advance and the action share one transaction
 * — split them and a `meet` can land in a round that already ended.
 *
 * The lazy advance is not an optimisation, it is the mechanism. `tick.ts` sweeps
 * once a minute, which cannot drive a ninety-second floor; the sweep is the
 * backstop for a party whose guests have all pocketed their phones.
 */

import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import {
  MAX_CANDLES,
  MAX_GUEST_NAME,
  MAX_PARTY_SEATS,
  MAX_ROUND_MINUTES,
  MAX_VOTE_SECONDS,
  MIN_CANDLES,
  MIN_ROUND_MINUTES,
  MIN_VOTE_SECONDS,
  QUICK_CANDLES,
  QUICK_ROUND_MINUTES,
  ROUND_MINUTES,
  CANDLES,
  VOTE_SECONDS,
  addGuest,
  advanceParty,
  applyPartyAction,
  createPartyState,
  redactParty,
} from '@www/engine/party';
import type { PartyAction, PartyMode, PartyState } from '@www/engine/party';

import type {
  CreateGameRequest,
  Dependent,
  GameStatus,
  PartyActionRequest,
  PartyGameView,
  PartySeatView,
  TakePartySeatRequest,
  UpdatePartyConfigRequest,
} from './api-types.js';
import { HttpError, type AuthedUser } from './games.js';
import {
  games,
  isPartyDoc,
  parseParty,
  serializeParty,
  usersCol,
  type GameDoc,
  type PartyGameDoc,
  type Seat,
} from './store.js';

/** The dials each mode opens with. Both are editable in the lobby. */
const DIALS: Record<PartyMode, { candles: number; roundMinutes: number }> = {
  traitor: { candles: CANDLES, roundMinutes: ROUND_MINUTES },
  together: { candles: QUICK_CANDLES, roundMinutes: QUICK_ROUND_MINUTES },
};

const cleanName = (raw: unknown): string =>
  String(raw ?? '')
    .trim()
    .slice(0, MAX_GUEST_NAME);

const partyMode = (raw: unknown): PartyMode => (raw === 'together' ? 'together' : 'traitor');

/**
 * Guest names have to be distinct, because the deck's alibi clues name them and
 * two guests called Sam make one sentence that reads as two. Google display
 * names collide more often than a four-letter-code party ever did.
 */
function distinctNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? name : `${name} (${n})`;
  });
}

/**
 * The guest list, rebuilt from the seating plan.
 *
 * Regenerated on every lobby write rather than mutated, so a seat taken, a
 * child added and a no-show dropped all reduce to the same one-line operation
 * and the ids stay contiguous. Frozen the moment the host deals, because from
 * then on half the state points at guests by id.
 */
export function seatGuests(state: PartyState, seats: (Seat | null)[]): PartyState {
  const next = createPartyState(state.hostSlot, {
    mode: state.mode,
    roundMinutes: state.roundMinutes,
    voteSeconds: state.voteSeconds,
    candles: state.candles,
  });
  const raw: { name: string; young: boolean; slot: number; parent: number | null }[] = [];
  seats.forEach((seat, slot) => {
    if (seat === null) return;
    const adultIndex = raw.length;
    raw.push({ name: seat.name, young: false, slot, parent: null });
    for (const dep of seat.dependents ?? []) {
      raw.push({ name: dep.name, young: dep.young, slot, parent: adultIndex });
    }
  });
  const names = distinctNames(raw.map((r) => r.name));
  raw.forEach((r, i) => {
    addGuest(next, {
      name: names[i],
      young: r.young,
      slot: r.slot,
      broughtBy: r.parent === null ? null : r.parent,
    });
  });
  return next;
}

/** The document mirror of `phaseEndsAt`, which is what the sweeper queries on. */
const deadlineOf = (state: PartyState): Timestamp | null =>
  state.phaseEndsAt === null ? null : Timestamp.fromMillis(state.phaseEndsAt);

/**
 * The document's status is a function of the phase, not a thing tracked beside
 * it. Deriving it in one place is what stops the two from disagreeing — and
 * views read it from the state they are rendering rather than from the document
 * they were built from, which may predate the write that just happened.
 */
const statusFor = (state: PartyState): GameStatus =>
  state.phase === 'lobby' ? 'lobby' : state.phase === 'over' ? 'finished' : 'active';

/** Everything the document derives from party state, in one place. */
const partyFields = (state: PartyState): Partial<PartyGameDoc> => ({
  partyJson: serializeParty(state),
  deadlineAt: deadlineOf(state),
  status: statusFor(state),
  turn: state.round,
  turnMinutes: state.roundMinutes,
});

export async function createPartyGame(
  db: Firestore,
  user: AuthedUser,
  req: CreateGameRequest,
): Promise<string> {
  const mode = partyMode(req.mode);
  const dials = DIALS[mode];
  const seats: (Seat | null)[] = Array.from({ length: MAX_PARTY_SEATS }, () => null);
  seats[0] = { uid: user.uid, name: user.name, email: user.email, isBot: false, dependents: [] };

  const state = seatGuests(
    createPartyState(0, { mode, ...dials, voteSeconds: VOTE_SECONDS }),
    seats,
  );

  const doc: PartyGameDoc = {
    kind: 'party',
    tale: 'sleeping-beauty',
    // `lobby` while seats fill; `active` from the deal onward, with the phase
    // carrying the finer distinction between an invitation and a running round.
    status: 'lobby',
    createdBy: user.uid,
    createdAt: Timestamp.now(),
    playerCount: MAX_PARTY_SEATS,
    seats,
    turn: 0,
    deadlineAt: null,
    turnMinutes: dials.roundMinutes,
    remindedTurn: 0,
    seed: randomUUID(),
    partyJson: serializeParty(state),
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

async function loadParty(db: Firestore, gameId: string): Promise<PartyGameDoc> {
  const snap = await games(db).doc(gameId).get();
  if (!snap.exists) throw new HttpError(404, 'party not found');
  const doc = snap.data() as GameDoc;
  if (!isPartyDoc(doc)) throw new HttpError(409, 'that is a war game, not a party');
  return doc;
}

const slotOf = (doc: PartyGameDoc, uid: string): number | null => {
  const slot = doc.seats.findIndex((s) => s !== null && s.uid === uid);
  return slot === -1 ? null : slot;
};

function readParty(doc: PartyGameDoc): PartyState {
  const state = parseParty(doc);
  if (state === null) throw new HttpError(500, 'party has no state');
  return state;
}

const seatViews = (doc: PartyGameDoc): PartySeatView[] =>
  doc.seats.flatMap((seat, slot) =>
    seat === null
      ? []
      : [
          {
            slot,
            name: seat.name,
            taken: true,
            isHost: slot === 0,
            dependents: seat.dependents ?? [],
          },
        ],
  );

function view(
  doc: PartyGameDoc,
  gameId: string,
  state: PartyState,
  mySlot: number | null,
  note: string | null,
): PartyGameView {
  return {
    kind: 'party',
    id: gameId,
    status: statusFor(state),
    tale: doc.tale,
    seats: seatViews(doc),
    maxSeats: MAX_PARTY_SEATS,
    mySlot,
    isHost: mySlot === 0,
    phaseEndsAt: state.phaseEndsAt === null ? null : new Date(state.phaseEndsAt).toISOString(),
    party: redactParty(state, mySlot),
    note,
  };
}

/**
 * A read that may write.
 *
 * The common poll writes nothing — `advanceParty` reports `changed: false` and
 * the transaction is never opened. At a phase boundary every phone in the room
 * races here at once; they serialize on the one document, the first wins, and
 * the rest re-read inside their transaction and find the advance already made.
 */
export async function getPartyView(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
): Promise<PartyGameView> {
  const doc = await loadParty(db, gameId);
  const state = readParty(doc);
  const advanced = advanceParty(state, Date.now());
  if (!advanced.changed) {
    return view(doc, gameId, state, slotOf(doc, user.uid), null);
  }

  const settled = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    const fresh = snap.data() as PartyGameDoc;
    const freshState = readParty(fresh);
    const again = advanceParty(freshState, Date.now());
    if (again.changed) tx.update(games(db).doc(gameId), partyFields(again.state));
    return again.state;
  });
  return view(doc, gameId, settled, slotOf(doc, user.uid), null);
}

export async function takePartySeat(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
  req: TakePartySeatRequest,
): Promise<PartyGameView> {
  const dependents: Dependent[] = (Array.isArray(req.dependents) ? req.dependents : [])
    .map((d) => ({ name: cleanName(d?.name), young: d?.young !== false }))
    .filter((d) => d.name !== '')
    .slice(0, 4);

  const doc = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'party not found');
    const game = snap.data() as GameDoc;
    if (!isPartyDoc(game)) throw new HttpError(409, 'that is a war game, not a party');
    if (game.status !== 'lobby') throw new HttpError(409, 'the roles are already dealt');

    const existing = slotOf(game, user.uid);
    const slot = existing ?? game.seats.findIndex((s) => s === null);
    if (slot === -1) throw new HttpError(409, `${MAX_PARTY_SEATS} guests is a full hall`);
    // Taking a seat twice edits who came with you, rather than failing: a guest
    // who forgot to mention their child should not have to leave and rejoin.
    game.seats[slot] = {
      uid: user.uid,
      name: user.name,
      email: user.email,
      isBot: false,
      dependents,
    };

    const state = seatGuests(readParty(game), game.seats);
    game.partyJson = serializeParty(state);
    tx.set(games(db).doc(gameId), game);
    tx.set(
      usersCol(db).doc(user.uid),
      { name: user.name, email: user.email, gameIds: FieldValue.arrayUnion(gameId) },
      { merge: true },
    );
    return game;
  });
  return view(doc, gameId, readParty(doc), slotOf(doc, user.uid), null);
}

/**
 * The host drops a no-show.
 *
 * The prototype never needed this, because everybody was in the room when the
 * code was read out. An invitation dealt on Tuesday for Saturday means somebody
 * will RSVP and not come, and a guest who is not there holds pieces the room
 * needs to finish the puzzle and carries a vote nobody can cast.
 */
export async function dropPartySeat(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
  slot: number,
): Promise<PartyGameView> {
  const doc = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'party not found');
    const game = snap.data() as GameDoc;
    if (!isPartyDoc(game)) throw new HttpError(409, 'that is a war game, not a party');
    if (game.createdBy !== user.uid) throw new HttpError(403, 'only the host seats the hall');
    if (game.status !== 'lobby') throw new HttpError(409, 'the roles are already dealt');
    if (slot === 0) throw new HttpError(409, 'the host cannot leave their own party');
    if (!Number.isInteger(slot) || game.seats[slot] == null) {
      throw new HttpError(404, 'nobody is sitting there');
    }

    const leaving = game.seats[slot];
    game.seats[slot] = null;
    const state = seatGuests(readParty(game), game.seats);
    game.partyJson = serializeParty(state);
    tx.set(games(db).doc(gameId), game);
    if (leaving?.uid != null) {
      tx.set(
        usersCol(db).doc(leaving.uid),
        { gameIds: FieldValue.arrayRemove(gameId) },
        { merge: true },
      );
    }
    return game;
  });
  return view(doc, gameId, readParty(doc), slotOf(doc, user.uid), null);
}

const bounded = (value: number, lo: number, hi: number, what: string): number => {
  if (!Number.isInteger(value) || value < lo || value > hi) {
    throw new HttpError(400, `${what} must be an integer in [${lo}, ${hi}]`);
  }
  return value;
};

export async function updatePartyConfig(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
  req: UpdatePartyConfigRequest,
): Promise<PartyGameView> {
  const doc = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'party not found');
    const game = snap.data() as GameDoc;
    if (!isPartyDoc(game)) throw new HttpError(409, 'that is a war game, not a party');
    if (game.createdBy !== user.uid) throw new HttpError(403, 'only the host sets the dials');
    if (game.status !== 'lobby') throw new HttpError(409, 'the roles are already dealt');

    const state = readParty(game);
    state.roundMinutes = bounded(
      req.roundMinutes ?? state.roundMinutes,
      MIN_ROUND_MINUTES,
      MAX_ROUND_MINUTES,
      'roundMinutes',
    );
    state.voteSeconds = bounded(
      req.voteSeconds ?? state.voteSeconds,
      MIN_VOTE_SECONDS,
      MAX_VOTE_SECONDS,
      'voteSeconds',
    );
    // Both, because nothing has burned yet: the lobby is the only place the
    // count changes, and the display needs the total it started with.
    state.candles = bounded(req.candles ?? state.candles, MIN_CANDLES, MAX_CANDLES, 'candles');
    state.candlesLit = state.candles;

    game.partyJson = serializeParty(state);
    game.turnMinutes = state.roundMinutes;
    tx.set(games(db).doc(gameId), game);
    return game;
  });
  return view(doc, gameId, readParty(doc), slotOf(doc, user.uid), null);
}

/**
 * Everything else — deal, bell, meet, confirm, deny, sniff, nominate, vote —
 * through one route, because every one of them is this same transaction and the
 * rules that separate them all live in the engine.
 */
export async function actOnParty(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
  req: PartyActionRequest,
): Promise<PartyGameView> {
  const action = req.action as PartyAction | undefined;
  if (action === undefined || typeof action.kind !== 'string') {
    throw new HttpError(400, 'no action');
  }

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'party not found');
    const game = snap.data() as GameDoc;
    if (!isPartyDoc(game)) throw new HttpError(409, 'that is a war game, not a party');
    const mySlot = slotOf(game, user.uid);
    if (mySlot === null) throw new HttpError(403, 'you are not at this party');

    const now = Date.now();
    // One transaction for both, or the bell can ring between them and an
    // action arrives in a round that has already closed.
    const advanced = advanceParty(readParty(game), now);
    const applied = applyPartyAction(advanced.state, action, {
      seed: game.seed,
      nowMs: now,
      slot: mySlot,
      isHost: game.createdBy === user.uid,
    });

    if (advanced.changed || applied.changed) {
      tx.update(games(db).doc(gameId), partyFields(applied.state));
    }
    return { doc: game, state: applied.state, mySlot, note: applied.rejected };
  });

  return view(outcome.doc, gameId, outcome.state, outcome.mySlot, outcome.note);
}
