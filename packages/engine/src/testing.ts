/**
 * Helpers for building small, hand-shaped scenarios.
 *
 * Generated maps are the real thing but are hopeless to reason about in a test:
 * proving how a head-on swap resolves needs two territories and two armies, not
 * a 43-territory world. These build exactly the board a scenario needs.
 */

import { DEFAULT_RULES } from './constants.js';
import { buildAdjacency } from './graph.js';
import { recomputeIncome } from './income.js';
import { recomputeSupply } from './supply.js';
import type {
  GameState,
  GeneratedMap,
  MapEdge,
  OrderSet,
  Region,
  RuleConfig,
  Slot,
  StartingPosition,
  TerritoryId,
  UnitOrder,
} from './types.js';

export interface TestMapOptions {
  playerCount: number;
  territoryCount: number;
  /** Undirected adjacency. */
  edges: [number, number][];
  starts?: StartingPosition[];
  regions?: { bonus: number; territoryIds: TerritoryId[] }[];
  collapseWaves?: TerritoryId[][];
  seaLanes?: [number, number][];
}

export function makeTestMap(options: TestMapOptions): GeneratedMap {
  const {
    playerCount,
    territoryCount,
    edges,
    starts = [],
    regions,
    collapseWaves = [],
    seaLanes = [],
  } = options;

  const mapEdges: MapEdge[] = [
    ...edges.map(([a, b]) => ({ a: Math.min(a, b), b: Math.max(a, b), kind: 'land' as const })),
    ...seaLanes.map(([a, b]) => ({ a: Math.min(a, b), b: Math.max(a, b), kind: 'sea' as const })),
  ];

  const waveOf = new Array<number>(territoryCount).fill(-1);
  collapseWaves.forEach((wave, index) => {
    for (const id of wave) waveOf[id] = index;
  });

  const resolvedRegions: Region[] = (
    regions ?? [{ bonus: 2, territoryIds: Array.from({ length: territoryCount }, (_, i) => i) }]
  ).map((region, id) => ({
    id,
    name: `Region ${id}`,
    bonus: region.bonus,
    hue: (id * 60) % 360,
    territoryIds: [...region.territoryIds].sort((a, b) => a - b),
  }));

  return {
    formatVersion: 1,
    seed: 'test',
    playerCount,
    radius: 1000,
    territories: Array.from({ length: territoryCount }, (_, id) => ({
      id,
      name: `T${id}`,
      regionId: resolvedRegions.find((r) => r.territoryIds.includes(id))?.id ?? 0,
      centroid: [id * 100, 0] as [number, number],
      polygon: [
        [id * 100 - 40, -40],
        [id * 100 + 40, -40],
        [id * 100 + 40, 40],
        [id * 100 - 40, 40],
      ] as [number, number][],
      wave: waveOf[id],
    })),
    edges: mapEdges,
    regions: resolvedRegions,
    starts,
    neutralGarrisons: {},
    collapseWaves,
    adjacency: buildAdjacency(territoryCount, mapEdges),
  };
}

/** A line of `n` territories: 0 — 1 — 2 — … */
export function lineMap(n: number, playerCount = 2): GeneratedMap {
  return makeTestMap({
    playerCount,
    territoryCount: n,
    edges: Array.from({ length: n - 1 }, (_, i) => [i, i + 1] as [number, number]),
  });
}

/** A ring of `n` territories, so move cycles are expressible. */
export function ringMap(n: number, playerCount = 3): GeneratedMap {
  return makeTestMap({
    playerCount,
    territoryCount: n,
    edges: Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as [number, number]),
  });
}

export interface ScenarioOptions {
  owner: (Slot | null)[];
  armies: number[];
  capital?: (TerritoryId | null)[];
  income?: number[];
  turn?: number;
  activeEvent?: string | null;
  pactPartner?: (Slot | null)[];
  pactStreak?: number[];
}

/** Builds a game state directly, bypassing normal setup. */
export function scenario(map: GeneratedMap, options: ScenarioOptions): GameState {
  const territoryCount = map.territories.length;
  const playerCount = map.playerCount;

  const state: GameState = {
    turn: options.turn ?? 1,
    playerCount,
    owner: options.owner.slice(),
    armies: options.armies.slice(),
    collapsed: new Array<boolean>(territoryCount).fill(false),
    supplied: new Array<boolean>(territoryCount).fill(false),
    status: new Array<'active'>(playerCount).fill('active'),
    capital:
      options.capital?.slice() ??
      Array.from({ length: playerCount }, (_, slot) => options.owner.indexOf(slot)),
    income: options.income?.slice() ?? new Array<number>(playerCount).fill(0),
    eliminatedTurn: new Array<number | null>(playerCount).fill(null),
    pactsHonored: new Array<number>(playerCount).fill(0),
    pactsBroken: new Array<number>(playerCount).fill(0),
    betrayedBy: Array.from({ length: playerCount }, () => new Array<number>(playerCount).fill(0)),
    pactPartner: options.pactPartner?.slice() ?? new Array<Slot | null>(playerCount).fill(null),
    pactStreak: options.pactStreak?.slice() ?? new Array<number>(playerCount).fill(0),
    concordAt: Array.from({ length: playerCount }, () => new Array<number>(playerCount).fill(-1)),
    hegemonyStreak: new Array<number>(playerCount).fill(0),
    decapitationStreak: new Array<number>(playerCount).fill(0),
    activeEvent: options.activeEvent ?? null,
    pendingEvent: null,
    usedEvents: [],
    fogUntilTurn: 0,
    wavesCollapsed: 0,
    pendingBonusIncome: new Array<number>(playerCount).fill(0),
    result: null,
  };

  // Any capital pointing at a territory its owner does not hold is a scenario
  // bug, not a game state; normalise it away so tests fail for the right reason.
  for (let slot = 0; slot < playerCount; slot++) {
    const capital = state.capital[slot];
    if (capital === undefined || capital === null || capital < 0 || state.owner[capital] !== slot) {
      state.capital[slot] = state.owner.findIndex((o) => o === slot);
      if (state.capital[slot] === -1) state.capital[slot] = null;
    }
  }

  recomputeSupply(state, map);
  if (!options.income) recomputeIncome(state, map);
  return state;
}

export function orders(slot: Slot, units: UnitOrder[] = [], pledge: Slot | null = null): OrderSet {
  return { slot, pledge, deploys: [], units };
}

export function move(from: TerritoryId, to: TerritoryId, count: number): UnitOrder {
  return { kind: 'MOVE', from, to, count };
}

export function support(from: TerritoryId, target: TerritoryId, forPlayer: Slot): UnitOrder {
  return { kind: 'SUPPORT', from, target, forPlayer };
}

export function hold(from: TerritoryId): UnitOrder {
  return { kind: 'HOLD', from };
}

export const TEST_RULES: RuleConfig = { ...DEFAULT_RULES };

/** Total armies on the board, for conservation checks. */
export function armiesOnBoard(state: GameState): number {
  let total = 0;
  for (let id = 0; id < state.armies.length; id++) {
    if (!state.collapsed[id]) total += state.armies[id];
  }
  return total;
}
