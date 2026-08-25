/**
 * Dinner Party: Sleeping Beauty as an assembly puzzle for up to twenty guests.
 *
 * The war game and this share a lobby, an invite link and a deadline, and
 * nothing else — no map, no armies, no turn resolution. What they do share is
 * the discipline: state is a plain value, every draw comes from a named
 * substream, and nothing reaches a client except through a redactor.
 *
 * Two structural departures from the prototype in `prototypes/dinner-party/`:
 *
 * 1. **Guests are integers, not names.** There, pairs were matched on a typed-in
 *    name (`allyName` / `byName` / `allyOf`) and votes were keyed by name in an
 *    object. Here a guest is an index into `guests`, which deletes that whole
 *    layer and keeps arbitrary user strings out of object keys.
 * 2. **A guest need not have an account.** One seat is one Google sign-in, and
 *    it speaks for everyone who came with it. A child is the obvious case, but
 *    the field is `dependents` rather than `children` on purpose: a grandparent
 *    whose phone will not finish an OAuth redirect on somebody's guest wifi is
 *    the same problem with `young: false`, and the prototype's clearest finding
 *    was that a dinner party does not want the account model at all.
 */

/** An index into `PartyState.guests`. Stable for the life of the party. */
export type GuestId = number;

export type PartyPhase = 'lobby' | 'invited' | 'mingle' | 'vote' | 'over';

export type DuoId = 'godmother' | 'huntsman' | 'nursemaid' | 'spinner';

/**
 * What a guest wore to the christening. Public on purpose: the puzzle is the
 * culprit's costume, so the guests have to be readable or there is nothing to
 * deduce. Costumes are dealt distinct, which is what makes a fully-pinned
 * costume name exactly one guest.
 */
export interface Costume {
  gown: string;
  gift: string;
  place: string;
}

/** The errand a grown-up must run to get a clue out of a child. */
export interface Favour {
  /** How it reads to the grown-up who has to perform it. */
  grown: string;
  /** How it reads to the child who is owed it. */
  kid: string;
}

/** A character with two people in it, and an ability neither half has alone. */
export interface Duo {
  id: DuoId;
  name: string;
  grown: string;
  kid: string;
  grownBlurb: string;
  kidBlurb: string;
}

/** A fragment of the tale. Falsehoods carry `fake`, and look identical otherwise. */
export interface Piece {
  text: string;
  fake: boolean;
}

/** An encounter claimed against a guest, awaiting the word of whoever speaks for them. */
export interface Claim {
  from: GuestId;
  /** The curser's falsehood riding in on this encounter. Never survives redaction. */
  lie: string | null;
}

/** The Huntsman's single question of the night, once spent. */
export interface Sniff {
  target: GuestId;
  lied: boolean;
}

export interface PartyGuest {
  id: GuestId;
  name: string;
  /** A child: no vote, no nomination, a favour, and half of a duo. */
  young: boolean;
  /** The seat whose Google account acts for this guest. */
  slot: number;
  /** The grown-up a dependent came with; null for whoever holds the seat. */
  broughtBy: GuestId | null;
  part: string | null;
  duoId: DuoId | null;
  costume: Costume | null;
  /** Index into FAVOURS. Null for anyone not young. */
  favour: number | null;
  /** Held fragments. Never attributed — you are told you got one, not who from. */
  pieces: Piece[];
  /** Confirmed encounters. Public: the encounter log is the evidence. */
  met: GuestId[];
  claims: Claim[];
  /** Grown-ups who have played pretend with this child. Their whole scoreboard. */
  curtsies: GuestId[];
  sniff: Sniff | null;
  /** Falsehoods still in hand. Only ever non-zero for the curser. */
  lies: number;
  /** Banishment does not remove anybody. It spends their voice. */
  banished: boolean;
  lastVoteSpent: boolean;
}

export interface Tally {
  yes: number;
  total: number;
  carried: boolean;
}

export interface Vote {
  guest: GuestId;
  yes: boolean;
  weight: number;
}

export interface Nomination {
  /** Never young — no child laid that curse, and none can be accused of it. */
  suspect: GuestId;
  by: GuestId;
  /** An array, not a name-keyed map: user strings must never become object keys. */
  votes: Vote[];
  tally: Tally | null;
}

export interface VoteResult {
  suspect: GuestId;
  by: GuestId;
  tally: Tally;
}

export interface PartyState {
  formatVersion: 1;
  tale: 'sleeping-beauty';
  /**
   * `lobby` and `invited` both predate the evening: the first is filling seats,
   * the second is the window between dealing the roles and ringing everyone in,
   * which may be days. `mingle` and `vote` then alternate through the night.
   */
  phase: PartyPhase;
  round: number;
  /**
   * Epoch ms the current phase ends; null in lobby, invited and over. Mirrored
   * onto the document as `deadlineAt` so the sweeper can find it — the engine
   * cannot read a clock, so it needs the deadline as a value.
   */
  phaseEndsAt: number | null;
  roundMinutes: number;
  voteSeconds: number;
  candles: number;
  /** Why the last candle went out, so the hall can see what it cost them. */
  snuffed: string | null;
  outcome: string | null;
  guests: PartyGuest[];
  hostSlot: number;
  culprit: GuestId | null;
  /** How many falsehoods the curser was given, for the Huntsman's arithmetic. */
  lieBudget: number;
  deck: Piece[];
  nomination: Nomination | null;
  lastResult: VoteResult | null;
  banished: GuestId[];
}

export type PartyAction =
  | { kind: 'deal' }
  | { kind: 'bell' }
  | { kind: 'meet'; actor: GuestId; target: GuestId; lie: boolean }
  | { kind: 'confirm'; about: GuestId; claimant: GuestId }
  | { kind: 'deny'; about: GuestId; claimant: GuestId }
  | { kind: 'sniff'; actor: GuestId; target: GuestId }
  | { kind: 'nominate'; actor: GuestId; suspect: GuestId }
  | { kind: 'vote'; actor: GuestId; yes: boolean };

export interface PartyContext {
  seed: string;
  /** Time arrives as a value. The engine never reads a clock. */
  nowMs: number;
  /** The seat performing this action. */
  slot: number;
  isHost: boolean;
}

/**
 * An action either moves the state or explains why it did not. Nothing throws:
 * a rejected action returns the state it was given, and the server turns
 * `rejected` into a note the guest can actually read.
 */
export interface PartyResult {
  state: PartyState;
  changed: boolean;
  rejected: string | null;
}
