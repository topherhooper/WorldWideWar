/** Public surface of the rules engine. */

export * from './types.js';
export * from './constants.js';
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
