/** Public surface of the rules engine. */

export * from './types.js';
export * from './constants.js';
export { rulesFor, MIN_CONDOMINIUM_PLAYERS, MIN_CONCORDAT_PLAYERS } from './constants.js';
export {
  PRESETS,
  presetById,
  presetRules,
  presetsForDate,
  type GamePreset,
  type PresetId,
} from './presets.js';
export { makeRng, substream, type Rng } from './rng.js';
export { canonicalJson, hashValue, sha256 } from './hash.js';
export {
  articulationPoints,
  bfsDistances,
  buildAdjacency,
  components,
  diameter,
  isConnected,
  reachable,
} from './graph.js';
export { generateMap, MAX_PLAYERS, MIN_PLAYERS } from './mapgen/generate.js';
export { WORLD_RADIUS } from './mapgen/points.js';
export {
  makeLayout,
  perWedgeFor,
  rotate,
  orbit,
  canonical,
  localOf,
  wedgeOf,
  territoryId,
  type SymmetryLayout,
} from './mapgen/symmetry.js';
export {
  validateFairness,
  validateGraph,
  validateStructure,
  validateSymmetry,
  type ValidationIssue,
} from './mapgen/validate.js';
export { resolveTurn, type ResolveResult } from './resolve.js';
export { createInitialState, cloneState } from './setup.js';
export { normalizeOrders, buildAttackMatrix, emptyOrders } from './orders.js';
export { redact, isRedacted, HIDDEN_ARMIES } from './redact.js';
export { recomputeSupply, suppliedCount, territoryCount, relocateCapital } from './supply.js';
export { computeIncome, recomputeIncome, regionBonusFor } from './income.js';
export { applyStorm, waveCollapsingOn, warnedTerritories, survivingTerritories } from './storm.js';
export {
  checkVictory,
  rankPlayers,
  processEliminations,
  totalArmies,
  fullyHeldRegions,
  updateVictoryStreaks,
} from './victory.js';
export {
  GLOBAL_EVENTS,
  EVENT_DESCRIPTIONS,
  describeEvent,
  fogActive,
  type GlobalEventId,
} from './events.js';
export {
  battleOdds,
  computePower,
  splitProportionally,
  winnerCasualties,
  retreatSurvivors,
  type OddsSide,
} from './combat.js';
export {
  resolvePacts,
  applyPactRecord,
  concordPair,
  pactContest,
  MAX_COURTED_BONUS,
  type PactInput,
} from './contest/pact.js';
export {
  applyTiersRecord,
  decideTiersList,
  decideTiersOrders,
  makeTiersList,
  normalizeItemText,
  normalizeTiersList,
  resolveTiers,
  scoreGuess,
  tiersWarnings,
  TIERS_LIST_SIZE,
  TIERS_MAX_GUESSES,
  TIERS_MAX_ITEM_LENGTH,
} from './contest/tiers.js';
export { TIERS_TOPICS, topicForTurn, type TiersTopic } from './contest/topics.js';
export type { Contest, ContestContext, ContestOutcome } from './contest/types.js';
export {
  decideOrders,
  assistOrders,
  makePersonality,
  trustScores,
  currentLeader,
  type BotPersonality,
  type Difficulty,
} from './bot/index.js';
export { playBotGame, type GameSummary, type SimulateOptions } from './simulate.js';
