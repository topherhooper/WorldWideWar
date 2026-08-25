/**
 * Reading the guest list.
 *
 * Everything the prototype did by matching typed-in names is an integer lookup
 * here, so these are small. They are gathered in one file because `actions.ts`,
 * `clock.ts` and `redact.ts` must all agree on who may vote and what a voice is
 * worth — three copies of that arithmetic is how a hall ends up unable to carry
 * any nomination at all.
 */

import { DUO_WEIGHT, SOLO_WEIGHT } from './constants.js';
import type { GuestId, PartyGuest, PartyState } from './types.js';

/** The guest an id points at, or null if the id is not one. */
export const guestAt = (state: PartyState, id: GuestId): PartyGuest | null =>
  state.guests[id] ?? null;

export const grownUps = (state: PartyState): PartyGuest[] => state.guests.filter((g) => !g.young);

export const children = (state: PartyState): PartyGuest[] => state.guests.filter((g) => g.young);

/** Everyone this guest brought with them. */
export const dependentsOf = (state: PartyState, id: GuestId): PartyGuest[] =>
  state.guests.filter((g) => g.broughtBy === id);

/** Everyone a seat speaks for, the seat-holder first. */
export const guestsOfSeat = (state: PartyState, slot: number): PartyGuest[] =>
  state.guests.filter((g) => g.slot === slot);

/**
 * A dependent never confirms anything themselves — the guest who brought them
 * answers for them. That is the whole reason a favour is worth anything: a
 * guest claims, and the partner vouches.
 */
export const speakerFor = (state: PartyState, guest: PartyGuest): PartyGuest =>
  guest.broughtBy === null ? guest : (guestAt(state, guest.broughtBy) ?? guest);

/**
 * Which Google account may act for this guest. A dependent is stored on the
 * seat that brought them, so this is already their own slot — kept as a named
 * function because the callers read better for saying what they mean.
 */
export const speakerSlot = (guest: PartyGuest): number => guest.slot;

/**
 * Vote weight. A guest speaks with one voice; half of a duo speaks with two,
 * because a duo is one character with two people in it. A child has none — the
 * grown-up half carries both.
 *
 * Note what this keys off: the duo *character*, not the fact of having brought
 * somebody. A grown-up who brought two children is still one duo and still two
 * voices, and a grown-up whose pair was the fifth and drew no duo has one voice
 * despite having a child beside them. That is the decision "a pair is a
 * character, not a link" doing its work, and it is the rule someone will argue
 * about at the table — so the invitation card says it out loud.
 */
export function weightOf(guest: PartyGuest): number {
  if (guest.young) return 0;
  return guest.duoId === null ? SOLO_WEIGHT : DUO_WEIGHT;
}

/** Grown-ups vote. A banished one has a single voice left for the rest of the night. */
export const canVote = (guest: PartyGuest): boolean =>
  !guest.young && !(guest.banished && guest.lastVoteSpent);

/** Total voices still in the room — the majority a nomination is measured against. */
export const totalVoices = (state: PartyState): number =>
  state.guests.reduce((n, g) => (canVote(g) ? n + weightOf(g) : n), 0);

/** Anyone still un-banished may be put on the floor. Children never can. */
export const nominable = (state: PartyState): PartyGuest[] =>
  state.guests.filter((g) => !g.young && !g.banished);

/**
 * The curser and everyone they brought. A pair wins or loses together, so a
 * curser who came to the party with their five-year-old drags her onto their
 * side of the ledger — without either of them being told during the night.
 *
 * The prototype's `allyOf` returned at most one ally; a seat may now speak for
 * several, and all of them share the curser's fate.
 */
export function cursedSide(state: PartyState): GuestId[] {
  if (state.culprit === null) return [];
  return [state.culprit, ...dependentsOf(state, state.culprit).map((g) => g.id)];
}

/** Whether this guest ends the night on the winning side. Only meaningful once over. */
export function hasWon(state: PartyState, guest: PartyGuest): boolean | null {
  if (state.phase !== 'over') return null;
  const cursed = cursedSide(state).includes(guest.id);
  // The curser wins by darkness: the last candle out means Aurora sleeps.
  return cursed === (state.candles === 0);
}
