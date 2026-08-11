/**
 * Map validation.
 *
 * The generator samples, validates, and resamples on failure. These constraints
 * are not cosmetic — each one rules out a specific way a generated map stops
 * being a good fast game.
 */

import { articulationPoints, bfsDistances, diameter, isConnected } from '../graph.js';
import type { GeneratedMap } from '../types.js';
import type { SymmetryLayout } from './symmetry.js';
import { canonical, orbit, rotate, wedgeOf } from './symmetry.js';

export interface ValidationIssue {
  code: string;
  detail: string;
}

export const MIN_DEGREE = 2;
export const MAX_DEGREE = 6;
const MAX_ARTICULATION_SHARE = 0.15;
const MIN_AVERAGE_DEGREE = 2.4;
const MAX_AVERAGE_DEGREE = 3.8;
const MIN_DIAMETER = 4;

/**
 * @param hubs Territories exempt from the maximum-degree cap.
 *
 * The central territory borders one territory per wedge, so at twelve players
 * it is a twelve-way hub by construction. That is deliberate rather than a
 * defect: the centre is the last ground standing once the storm has finished,
 * and everyone being able to reach it is what makes the endgame a brawl instead
 * of a siege. It also cuts both ways — whoever holds it is exposed from every
 * direction at once.
 */
export function validateGraph(
  adjacency: readonly (readonly number[])[],
  hubs: ReadonlySet<number> = new Set(),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const n = adjacency.length;

  if (!isConnected(adjacency)) {
    issues.push({ code: 'disconnected', detail: 'territory graph is not connected' });
    // Every remaining check assumes connectivity.
    return issues;
  }

  // Degree 1 is the concrete anti-"boxed in" guarantee: a territory with a
  // single neighbour is a dead end that can be sealed by one opponent.
  for (let id = 0; id < n; id++) {
    const degree = adjacency[id].length;
    if (degree < MIN_DEGREE) {
      issues.push({ code: 'degree_low', detail: `territory ${id} has degree ${degree}` });
    } else if (degree > MAX_DEGREE && !hubs.has(id)) {
      issues.push({ code: 'degree_high', detail: `territory ${id} has degree ${degree}` });
    }
  }

  let edgeCount = 0;
  for (const list of adjacency) edgeCount += list.length;
  const averageDegree = edgeCount / n;
  if (averageDegree < MIN_AVERAGE_DEGREE || averageDegree > MAX_AVERAGE_DEGREE) {
    issues.push({
      code: 'average_degree',
      detail: `average degree ${averageDegree.toFixed(2)} outside [${MIN_AVERAGE_DEGREE}, ${MAX_AVERAGE_DEGREE}]`,
    });
  }

  // A sprawling map means the early game is spent walking rather than fighting,
  // which is exactly the slow-Risk failure mode this design exists to avoid.
  const maxDiameter = Math.ceil(MIN_DIAMETER + n / 8);
  const actualDiameter = diameter(adjacency);
  if (actualDiameter < MIN_DIAMETER || actualDiameter > maxDiameter) {
    issues.push({
      code: 'diameter',
      detail: `diameter ${actualDiameter} outside [${MIN_DIAMETER}, ${maxDiameter}]`,
    });
  }

  // Owning one tile should never make a player unassailable.
  const limit = Math.floor(n * MAX_ARTICULATION_SHARE);
  for (const [vertex, largestFragment] of articulationPoints(adjacency)) {
    const isolated = n - 1 - largestFragment;
    if (isolated > limit) {
      issues.push({
        code: 'chokepoint',
        detail: `territory ${vertex} isolates ${isolated} territories (limit ${limit})`,
      });
    }
  }

  return issues;
}

/**
 * Asserts the adjacency graph is genuinely invariant under a one-wedge
 * rotation.
 *
 * This is the fairness guarantee stated as an equality. If it holds, every
 * player's neighbourhood is graph-isomorphic to every other's and seat balance
 * follows structurally rather than statistically.
 */
export function validateSymmetry(
  layout: SymmetryLayout,
  adjacency: readonly (readonly number[])[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (let id = 0; id < layout.count; id++) {
    const rotated = rotate(layout, id, 1);
    const expected = new Set(adjacency[id].map((n) => rotate(layout, n, 1)));
    const actual = new Set(adjacency[rotated]);

    if (expected.size !== actual.size || [...expected].some((v) => !actual.has(v))) {
      issues.push({
        code: 'asymmetric',
        detail: `neighbourhood of ${id} does not rotate onto ${rotated}`,
      });
      break;
    }
  }

  return issues;
}

/**
 * Per-player fairness checks on a finished map.
 *
 * These should be trivially satisfied by the wedge construction — that is the
 * point. Asserting them anyway turns any future change that quietly breaks
 * symmetry into a test failure rather than a slow drift in seat win rates.
 */
export function validateFairness(map: GeneratedMap): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { adjacency, starts } = map;
  if (starts.length < 2) return issues;

  const capitalDistances: number[] = [];
  const nearbyNeutrals: number[] = [];
  const nearbyBonus: number[] = [];

  const owned = new Set<number>();
  for (const start of starts) {
    owned.add(start.capital);
    for (const extra of start.extra) owned.add(extra);
  }

  const regionOf = new Map<number, number>();
  for (const region of map.regions) {
    for (const id of region.territoryIds) regionOf.set(id, region.bonus);
  }

  for (const start of starts) {
    const dist = bfsDistances(adjacency, start.capital);

    let nearestRival = Infinity;
    for (const other of starts) {
      if (other.slot === start.slot) continue;
      const d = dist[other.capital];
      if (d >= 0 && d < nearestRival) nearestRival = d;
    }
    capitalDistances.push(nearestRival);

    let neutrals = 0;
    let bonus = 0;
    for (let id = 0; id < adjacency.length; id++) {
      if (dist[id] < 0 || dist[id] > 3) continue;
      if (!owned.has(id)) neutrals++;
      bonus += regionOf.get(id) ?? 0;
    }
    nearbyNeutrals.push(neutrals);
    nearbyBonus.push(bonus);
  }

  const check = (label: string, values: number[], tolerance: number) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max - min > tolerance) {
      issues.push({
        code: 'unfair',
        detail: `${label} varies between seats: min ${min}, max ${max} (tolerance ${tolerance})`,
      });
    }
  };

  check('capital-to-nearest-rival distance', capitalDistances, 0);
  check('neutral territories within 3 hops', nearbyNeutrals, 1);
  check('region bonus value within 3 hops', nearbyBonus, 1);

  return issues;
}

/** Structural checks on a finished map: regions contiguous, starts distinct. */
export function validateStructure(map: GeneratedMap): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { adjacency } = map;

  for (const region of map.regions) {
    if (region.territoryIds.length === 0) {
      issues.push({ code: 'empty_region', detail: `region ${region.id} has no territories` });
      continue;
    }
    const members = new Set(region.territoryIds);
    const seen = new Set<number>([region.territoryIds[0]]);
    const queue = [region.territoryIds[0]];
    for (let head = 0; head < queue.length; head++) {
      for (const next of adjacency[queue[head]]) {
        if (members.has(next) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    if (seen.size !== members.size) {
      issues.push({ code: 'region_split', detail: `region ${region.id} is not contiguous` });
    }
  }

  const claimed = new Set<number>();
  for (const start of map.starts) {
    for (const id of [start.capital, ...start.extra]) {
      if (claimed.has(id)) {
        issues.push({ code: 'start_overlap', detail: `territory ${id} claimed twice at setup` });
      }
      claimed.add(id);
    }
  }

  const everyTerritory = new Set<number>();
  for (const region of map.regions) {
    for (const id of region.territoryIds) {
      if (everyTerritory.has(id)) {
        issues.push({ code: 'region_overlap', detail: `territory ${id} is in two regions` });
      }
      everyTerritory.add(id);
    }
  }
  if (everyTerritory.size !== map.territories.length) {
    issues.push({
      code: 'region_coverage',
      detail: `${everyTerritory.size} of ${map.territories.length} territories are in a region`,
    });
  }

  return issues;
}

/** Convenience for tests: every orbit's canonical member, ascending. */
export function orbitRepresentatives(layout: SymmetryLayout): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let id = 0; id < layout.count; id++) {
    const rep = canonical(layout, id);
    if (seen.has(rep)) continue;
    seen.add(rep);
    out.push(rep);
  }
  return out;
}

/** Convenience for tests: every territory in wedge 0, plus the centre. */
export function wedgeZero(layout: SymmetryLayout): number[] {
  const out: number[] = [];
  for (let id = 0; id < layout.count; id++) {
    if (wedgeOf(layout, id) === 0 || id === layout.centre) out.push(id);
  }
  return out;
}

export { orbit };
