/** The evening's dials. Every number here is a guess that wants a real table. */

/**
 * Twenty guests. Twenty does not threaten the plumbing; it threatens the
 * fiction, and it is what rules out every table-sized mechanic.
 */
export const MAX_PARTY_GUESTS = 20;

/**
 * Seats, which is not the same number: one seat speaks for everyone who came
 * with it, so twenty guests can arrive through far fewer Google accounts.
 */
export const MAX_PARTY_SEATS = 20;

/** One of them did it, so there has to be more than one of them. */
export const MIN_GROWNUPS = 2;

/**
 * The candles are the curser's clock, and the reason a wrongful banishment
 * hurts. One burns at the end of every round. Banishing an innocent burns a
 * second, because the hall spent its accusation on the wrong neck. When the
 * last one goes out, Aurora sleeps and the curser has won.
 */
export const CANDLES = 5;
export const MIN_CANDLES = 3;
export const MAX_CANDLES = 9;

/** How long the hall has to nominate and speak once the bell has rung. */
export const VOTE_SECONDS = 90;
export const MIN_VOTE_SECONDS = 30;
export const MAX_VOTE_SECONDS = 600;

/** How long guests mingle before the bell. */
export const ROUND_MINUTES = 5;
export const MIN_ROUND_MINUTES = 1;
export const MAX_ROUND_MINUTES = 60;

/** A guest speaks with one voice; a duo speaks with two. Nothing else moves it. */
export const DUO_WEIGHT = 2;
export const SOLO_WEIGHT = 1;

/** Names are read aloud across a room, not stored in a ledger. */
export const MAX_GUEST_NAME = 24;
