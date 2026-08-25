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

/**
 * A traitor party needs three grown-ups, not two.
 *
 * The prototype required two, reasoning only that one of them did it. That is
 * necessary and not sufficient: a nomination carries on `yes * 2 > total`, so
 * with two grown-ups the single innocent raises at most half the voices in the
 * room and the curse can never be broken. `together` parties have no such
 * bound — nobody at the table did it, so two grown-ups is a full hall.
 */
export const MIN_TRAITOR_GROWNUPS = 3;
export const MIN_TOGETHER_GROWNUPS = 1;

/** How many courtiers went home before anyone noticed. The suspect list. */
export const TOGETHER_SUSPECTS = 6;

/**
 * The candles are the curser's clock, and the reason a wrongful banishment
 * hurts. One burns at the end of every round. Banishing an innocent burns a
 * second, because the hall spent its accusation on the wrong neck. When the
 * last one goes out, Aurora sleeps and the curser has won.
 */
export const CANDLES = 5;

/**
 * The family game, sized for the twenty minutes before bedtime: three candles
 * at two-minute rounds, which is about ten minutes end to end — long enough for
 * each grown-up to run two or three errands for a four-year-old and make one
 * guess.
 */
export const QUICK_CANDLES = 3;
export const QUICK_ROUND_MINUTES = 2;

export const MIN_CANDLES = 1;
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
