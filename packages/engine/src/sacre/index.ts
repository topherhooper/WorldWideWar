/**
 * Public surface of S.A.C.R.E. Bleu!
 *
 * Reached as `@www/engine/sacre`, deliberately not folded into the engine's
 * root `index.ts` -- that file is the war game's document, and the balance and
 * mapgen sweeps should not grow a card-shaped import graph.
 */

export {
  bestRun,
  buildDeck,
  cardName,
  cardValue,
  isJoker,
  value,
  type Card,
  type Run,
  type Suit,
} from './cards.js';
export type {
  Pending,
  PendingAdvertise,
  PendingCycle,
  SacreAction,
  SacreContext,
  SacreOption,
  SacrePhase,
  SacrePlayer,
  SacreState,
  ScoredRun,
  Slot,
  TurnPhase,
} from './types.js';
export {
  DEFAULT_TURN_SECONDS,
  MAX_PLAYERS,
  MIN_HAND,
  MIN_PLAYERS,
  ROUNDS,
  cloneSacre,
  deal,
  dealSize,
  emptyState,
  maxCycleQuantity,
  winnerOf,
} from './state.js';
export { checkRun, cycleAllowed, eligibleFor, extendsScored } from './rules.js';
export { applySacreAction, settleAdvertise, settleCycle } from './actions.js';
export { advanceSacre, endTurn, pendingSettled, settlePending, type Advanced } from './clock.js';
export {
  optionsFor,
  redactSacre,
  type PendingView,
  type SacreView,
  type SeatView,
} from './redact.js';
export { playSacreGame, type SacreResult } from './game.js';
