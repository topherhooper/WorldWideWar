/**
 * Public surface of the dinner party.
 *
 * Reached as `@www/engine/party`, deliberately not folded into the engine's
 * root `index.ts`: that file is the war game's document, and the balance and
 * mapgen sweeps should not grow a party-shaped import graph.
 */

export * from './types.js';
export * from './constants.js';
export { addGuest, cloneParty, createPartyState, removeSeat } from './state.js';
export type { NewGuest, PartyOptions } from './state.js';
export {
  atTable,
  canVote,
  children,
  cursedSide,
  dependentsOf,
  grownUps,
  guestAt,
  guestsOfSeat,
  hasWon,
  minGrownUps,
  nominable,
  speakerFor,
  speakerSlot,
  suspects,
  totalVoices,
  weightOf,
} from './rules.js';
export {
  DUOS,
  FAVOURS,
  GROWN_PARTS,
  KID_PARTS,
  dealTale,
  duoById,
  duosFor,
  lieBudget,
  makeLie,
} from './tale.js';
export {
  advanceParty,
  allVoicesSpoken,
  beginRound,
  burnCandle,
  ringBell,
  settleVote,
} from './clock.js';
export { applyPartyAction } from './actions.js';
export { redactParty } from './redact.js';
export type {
  DuoCard,
  GuestCard,
  MeetOption,
  NominationView,
  PartyView,
  PendingClaim,
  RosterEntry,
} from './redact.js';
