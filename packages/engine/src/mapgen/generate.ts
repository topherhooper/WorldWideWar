/**
 * The map generator.
 *
 * Produces a fresh, seeded world per game. The output is frozen into the game
 * record at creation time and that snapshot — not the seed — is canonical for
 * play, rendering and replay. Delaunay triangulation runs in floating point,
 * which is not portable-guaranteed across architectures, so treating the
 * snapshot as canonical buys the full replay guarantee with none of the
 * cross-platform float risk. Seed-to-map reproducibility is then a property we
 * test rather than something correctness depends on at runtime.
 */

import { Delaunay } from 'd3-delaunay';
import { bfsDistances, buildAdjacency, isConnected } from '../graph.js';
import { substream, type Rng } from '../rng.js';
import type {
  GeneratedMap,
  MapEdge,
  Region,
  StartingPosition,
  Territory,
  TerritoryId,
} from '../types.js';
import { regionNames, territoryNames } from './names.js';
import {
  expandPositions,
  polygonCentroid,
  relaxWedge,
  sampleWedge,
  sentinelRing,
  WORLD_RADIUS,
  type Polar,
} from './points.js';
import {
  edgeOrbitKey,
  equivariantNeighbourOrder,
  localOf,
  makeLayout,
  perWedgeFor,
  rotate,
  symmetrizeEdges,
  territoryId,
  wedgeOf,
  type SymmetryLayout,
} from './symmetry.js';
import { MAX_DEGREE, validateGraph, validateStructure, validateSymmetry } from './validate.js';

export const MAX_GENERATION_ATTEMPTS = 20;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;

/**
 * Voronoi adjacency is far too dense to play on: interior cells average around
 * six neighbours, which makes every position defensible from everywhere and
 * removes the whole idea of a front line. Carving cuts back toward this average
 * degree, which is where chokepoints and flanks start to mean something.
 */
const TARGET_AVERAGE_DEGREE = 3.2;
/** Never cut more than this share of edge orbits, whatever the degree says. */
const MAX_CHOKEPOINT_SHARE = 0.55;
/** Lloyd relaxation rounds; two is enough to even out cell sizes. */
const RELAXATION_ROUNDS = 2;
/** Capitals sit this far out, leaving room to expand inward and outward. */
const CAPITAL_RADIUS_FRACTION = 0.72;
/** A sea lane must skip at least this many hops to be worth adding. */
const MIN_SEA_LANE_DISTANCE = 4;

export function generateMap(seed: string, playerCount: number): GeneratedMap {
  if (
    !Number.isInteger(playerCount) ||
    playerCount < MIN_PLAYERS ||
    playerCount > MAX_PLAYERS
  ) {
    throw new Error(`playerCount must be an integer in [${MIN_PLAYERS}, ${MAX_PLAYERS}]`);
  }

  const layout = makeLayout(playerCount, perWedgeFor(playerCount));

  let best: GeneratedMap | null = null;
  let bestIssueCount = Infinity;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const rng = substream(seed, 'map', attempt);
    const candidate = buildCandidate(seed, layout, rng);

    const issues = [
      ...validateGraph(candidate.adjacency, new Set([layout.centre])),
      ...validateSymmetry(layout, candidate.adjacency),
      ...validateStructure(candidate),
    ];
    if (issues.length === 0) return candidate;

    if (issues.length < bestIssueCount) {
      best = candidate;
      bestIssueCount = issues.length;
    }
  }

  // The wedge construction makes a clean map overwhelmingly likely, so this is
  // a backstop rather than an expected path. Returning the least-bad candidate
  // keeps generation total and deterministic; the test suite sweeps hundreds of
  // seeds per player count and fails if this path is ever actually needed.
  if (best) return best;
  throw new Error(`map generation produced no candidate for ${playerCount} players`);
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

function buildCandidate(seed: string, layout: SymmetryLayout, rng: Rng): GeneratedMap {
  let wedge = sampleWedge(rng, layout);
  let cells = computeCells(layout, wedge);

  for (let round = 0; round < RELAXATION_ROUNDS; round++) {
    const centroids = cells.polygons.map((polygon) => (polygon ? polygonCentroid(polygon) : null));
    wedge = relaxWedge(layout, wedge, centroids);
    cells = computeCells(layout, wedge);
  }

  const landEdges = carveChokepoints(layout, symmetrizeEdges(layout, cells.edges), cells.positions);
  const seaEdges = addSeaLanes(layout, landEdges, wedge);

  const edges: MapEdge[] = [
    ...landEdges.map((edge) => ({ ...edge, kind: 'land' as const })),
    ...seaEdges,
  ];
  const adjacency = buildAdjacency(layout.count, edges);

  const { regionOf, regions } = buildRegions(layout, adjacency, rng);
  const starts = buildStarts(layout, adjacency, wedge);
  const collapseWaves = buildCollapseWaves(layout, wedge);
  const territories = buildTerritories(layout, cells, regionOf, collapseWaves, rng);
  const neutralGarrisons = buildNeutralGarrisons(layout, adjacency, starts);

  return {
    formatVersion: 1,
    seed,
    playerCount: layout.playerCount,
    radius: WORLD_RADIUS,
    territories,
    edges,
    regions,
    starts,
    neutralGarrisons,
    collapseWaves,
    adjacency,
  };
}

interface Cells {
  positions: [number, number][];
  polygons: ([number, number][] | null)[];
  edges: { a: number; b: number }[];
}

function computeCells(layout: SymmetryLayout, wedge: readonly Polar[]): Cells {
  const positions = expandPositions(layout, wedge);
  const all = [...positions, ...sentinelRing(layout)];

  const delaunay = Delaunay.from(all);
  const bound = WORLD_RADIUS * 2;
  const voronoi = delaunay.voronoi([-bound, -bound, bound, bound]);

  const polygons: ([number, number][] | null)[] = [];
  for (let id = 0; id < layout.count; id++) {
    const polygon = voronoi.cellPolygon(id) as [number, number][] | null;
    polygons.push(polygon ? closeRing(polygon) : null);
  }

  const edges: { a: number; b: number }[] = [];
  for (let id = 0; id < layout.count; id++) {
    for (const other of voronoi.neighbors(id)) {
      // Sentinels bound the outer cells but are not part of the world.
      if (other > id && other < layout.count) edges.push({ a: id, b: other });
    }
  }

  return { positions, polygons, edges };
}

/** d3 returns a ring whose last point repeats the first; drop the duplicate. */
function closeRing(ring: readonly [number, number][]): [number, number][] {
  const out = ring.slice();
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) out.pop();
  }
  return out;
}

/**
 * Thins the adjacency graph into something with chokepoints and flanks, keeping
 * it connected and every territory at degree 2 or more.
 *
 * Cutting whole orbits rather than individual edges is what preserves symmetry:
 * a mountain range that blocks one player blocks all of them identically.
 *
 * Removal is driven by degree rather than by a fixed quota. Each round cuts the
 * orbit that most relieves the map's most over-connected territories, breaking
 * ties toward longer edges (which read naturally as mountain ranges). Stopping
 * on a measured average rather than a share of edges is what keeps a 2-player
 * and a 12-player map feeling similarly open.
 */
function carveChokepoints(
  layout: SymmetryLayout,
  edges: readonly { a: number; b: number }[],
  positions: readonly [number, number][],
): { a: number; b: number }[] {
  const keyOf = new Map<string, string>();
  const orbitKeys = new Set<string>();
  for (const edge of edges) {
    const key = edgeOrbitKey(layout, edge.a, edge.b);
    keyOf.set(`${edge.a}-${edge.b}`, key);
    orbitKeys.add(key);
  }

  const lengthOf = new Map<string, number>();
  for (const edge of edges) {
    const key = keyOf.get(`${edge.a}-${edge.b}`)!;
    if (lengthOf.has(key)) continue;
    lengthOf.set(
      key,
      Math.hypot(positions[edge.a][0] - positions[edge.b][0], positions[edge.a][1] - positions[edge.b][1]),
    );
  }

  const maxRemovals = Math.floor(orbitKeys.size * MAX_CHOKEPOINT_SHARE);
  let current = edges.slice();
  let removals = 0;
  const rejected = new Set<string>();

  while (removals < maxRemovals) {
    const adjacency = buildAdjacency(layout.count, current);
    let degreeSum = 0;
    for (const list of adjacency) degreeSum += list.length;
    const averageDegree = degreeSum / layout.count;

    // The centre is exempt from the cap: it borders one territory per wedge by
    // construction, and cutting that orbit would sever it from the map.
    let maxDegree = 0;
    for (let id = 0; id < layout.count; id++) {
      if (id === layout.centre) continue;
      if (adjacency[id].length > maxDegree) maxDegree = adjacency[id].length;
    }

    if (averageDegree <= TARGET_AVERAGE_DEGREE && maxDegree <= MAX_DEGREE) break;

    // Score each surviving orbit by how congested its endpoints are. Cutting
    // where the map is densest keeps sparse frontier regions intact instead of
    // stranding them.
    const scores = new Map<string, { pressure: number; length: number }>();
    for (const edge of current) {
      const key = keyOf.get(`${edge.a}-${edge.b}`)!;
      if (rejected.has(key)) continue;
      const pressure = Math.max(adjacency[edge.a].length, adjacency[edge.b].length);
      const existing = scores.get(key);
      if (!existing || pressure > existing.pressure) {
        scores.set(key, { pressure, length: lengthOf.get(key) ?? 0 });
      }
    }
    if (scores.size === 0) break;

    const ranked = [...scores.entries()].sort(
      (x, y) =>
        y[1].pressure - x[1].pressure ||
        y[1].length - x[1].length ||
        (x[0] < y[0] ? -1 : 1),
    );

    let cut = false;
    for (const [key] of ranked) {
      const candidate = current.filter((edge) => keyOf.get(`${edge.a}-${edge.b}`) !== key);
      if (isViable(layout, candidate)) {
        current = candidate;
        removals++;
        cut = true;
        break;
      }
      // Removing this orbit would disconnect the map or strand a territory;
      // it will not become removable later, so stop reconsidering it.
      rejected.add(key);
    }
    if (!cut) break;
  }

  return current;
}

function isViable(layout: SymmetryLayout, edges: readonly { a: number; b: number }[]): boolean {
  const adjacency = buildAdjacency(layout.count, edges);
  for (const list of adjacency) if (list.length < 2) return false;
  return isConnected(adjacency);
}

/**
 * Adds one long-range sea lane per wedge.
 *
 * Sea lanes are the surprise vector: without them a large map settles into a
 * static front line where every player knows exactly which two neighbours can
 * reach them. A lane that skips four or more hops means an attack can arrive
 * from somewhere nobody was watching.
 */
function addSeaLanes(
  layout: SymmetryLayout,
  landEdges: readonly { a: number; b: number }[],
  wedge: readonly Polar[],
): MapEdge[] {
  const adjacency = buildAdjacency(layout.count, landEdges);
  const radiusOf = (id: number): number =>
    id === layout.centre ? 0 : wedge[localOf(layout, id)].r;

  // Anchor in wedge 0, but look for a partner anywhere on the map. A lane
  // between two territories of the same wedge would be nearly pointless — a
  // wedge is a narrow slice, so everything inside it is already close. The
  // interesting lane reaches a *different player's* coast, which is what stops
  // a large map from settling into a static front where each player knows
  // exactly which two neighbours can reach them.
  // Lanes are added after carving, so an endpoint needs a spare degree slot or
  // the lane would push it back over the cap the carve just brought it under.
  // Headroom is checked per orbit rather than per lane: every territory in an
  // orbit gains exactly one edge, so accepting the orbit is all-or-nothing.
  const hasHeadroom = (id: number): boolean =>
    id === layout.centre || adjacency[id].length < MAX_DEGREE;

  const anchors: number[] = [];
  for (let local = 0; local < layout.perWedge; local++) {
    const id = territoryId(layout, local, 0);
    if (wedge[local].r > WORLD_RADIUS * 0.55 && hasHeadroom(id)) anchors.push(id);
  }
  if (anchors.length === 0) return [];

  let bestPair: [number, number] | null = null;
  let bestDistance = MIN_SEA_LANE_DISTANCE - 1;

  for (const from of anchors) {
    const dist = bfsDistances(adjacency, from);
    for (let to = 0; to < layout.count; to++) {
      if (to === from || to === layout.centre) continue;
      if (radiusOf(to) <= WORLD_RADIUS * 0.55) continue;
      if (!hasHeadroom(to)) continue;
      if (dist[to] > bestDistance) {
        bestDistance = dist[to];
        bestPair = [from, to];
      }
    }
  }
  if (!bestPair) return [];

  const existing = new Set(landEdges.map((edge) => `${edge.a}-${edge.b}`));
  const out: MapEdge[] = [];

  for (let step = 0; step < layout.playerCount; step++) {
    const a = rotate(layout, bestPair[0], step);
    const b = rotate(layout, bestPair[1], step);
    if (a === b) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const id = `${lo}-${hi}`;
    if (existing.has(id)) continue;
    existing.add(id);
    out.push({ a: lo, b: hi, kind: 'sea' });
  }

  return out;
}

// ─── Regions ─────────────────────────────────────────────────────────────────

/**
 * Partitions the map into contiguous regions with computed bonuses.
 *
 * Regions are clustered once and then rotated, so every player faces the same
 * regional structure — but a region is *not* confined to a single wedge. A
 * wedge is a narrow slice, so most of a territory's neighbours live in the
 * wedges either side of it; clustering on same-wedge adjacency alone would be
 * clustering on a nearly disconnected graph, and would produce one giant region
 * plus a scatter of singletons.
 *
 * Instead each cluster carries a per-local *wedge offset*. A cluster of locals
 * {l} with offsets {off(l)} defines region w as {territory(l, w + off(l))}.
 * Those P regions are still disjoint and still cover exactly the territories
 * whose local is in the cluster, so the partition is intact — but because the
 * offsets follow real adjacency, a region can sweep across a wedge boundary and
 * still be contiguous. Offsets are propagated along a breadth-first tree, which
 * makes contiguity true by construction rather than something to check for.
 */
function buildRegions(
  layout: SymmetryLayout,
  adjacency: readonly number[][],
  rng: Rng,
): { regionOf: number[]; regions: Region[] } {
  const clusterCount = Math.max(1, Math.round(layout.perWedge / 4));

  // Local adjacency carrying the wedge offset each edge crosses.
  const localEdges: { to: number; delta: number }[][] = Array.from(
    { length: layout.perWedge },
    () => [],
  );
  for (let local = 0; local < layout.perWedge; local++) {
    const id = territoryId(layout, local, 0);
    for (const neighbour of adjacency[id]) {
      if (neighbour === layout.centre) continue;
      localEdges[local].push({
        to: localOf(layout, neighbour),
        delta: wedgeOf(layout, neighbour),
      });
    }
    localEdges[local].sort((a, b) => a.to - b.to || a.delta - b.delta);
  }

  const plainAdjacency = localEdges.map((list) => [...new Set(list.map((e) => e.to))].sort((a, b) => a - b));
  const seeds = farthestPointSeeds(plainAdjacency, clusterCount);
  const { cluster, offset } = growClusters(localEdges, seeds, layout);

  const regionCount = clusterCount * layout.playerCount + 1;
  const names = regionNames(rng, regionCount);
  const regionOf = new Array<number>(layout.count).fill(-1);
  const members: number[][] = Array.from({ length: regionCount }, () => []);

  for (let local = 0; local < layout.perWedge; local++) {
    for (let w = 0; w < layout.playerCount; w++) {
      const id = territoryId(layout, local, w);
      // territory(local, w) belongs to the region indexed w - offset(local).
      const index =
        ((w - offset[local]) % layout.playerCount + layout.playerCount) % layout.playerCount;
      const regionId = cluster[local] * layout.playerCount + index;
      regionOf[id] = regionId;
      members[regionId].push(id);
    }
  }
  const centreRegion = regionCount - 1;
  regionOf[layout.centre] = centreRegion;
  members[centreRegion].push(layout.centre);

  const regions: Region[] = members.map((territoryIds, id) => {
    const sorted = territoryIds.slice().sort((a, b) => a - b);
    return {
      id,
      name: names[id],
      bonus: regionBonus(sorted, adjacency),
      hue: Math.round((360 * id) / regionCount),
      territoryIds: sorted,
    };
  });

  return { regionOf, regions };
}

/**
 * Region bonuses are computed, never authored: compact, defensible regions are
 * worth more than sprawling ones with long exposed frontiers.
 */
function regionBonus(territoryIds: readonly number[], adjacency: readonly number[][]): number {
  const members = new Set(territoryIds);
  let externalBorders = 0;
  for (const id of territoryIds) {
    for (const neighbour of adjacency[id]) {
      if (!members.has(neighbour)) externalBorders++;
    }
  }
  // Exposure is charged *per territory*, not as a flat subtraction. Charging
  // the raw border count would swamp the size term at this graph density and
  // clamp every region in the game to the floor, which makes holding one worth
  // nothing. As a ratio it does what it is meant to: a big compact region beats
  // a big sprawling one, and a small exposed one is barely worth taking.
  const size = territoryIds.length;
  const raw = Math.round(size + 1 - externalBorders / size);
  return Math.min(8, Math.max(2, raw));
}

function farthestPointSeeds(adjacency: readonly number[][], count: number): number[] {
  const n = adjacency.length;
  if (count >= n) return Array.from({ length: n }, (_, i) => i);

  const seeds = [0];
  while (seeds.length < count) {
    const distances = seeds.map((seed) => bfsDistances(adjacency, seed));
    let best = -1;
    let bestScore = -1;

    for (let node = 0; node < n; node++) {
      if (seeds.includes(node)) continue;
      let nearest = Infinity;
      for (const dist of distances) {
        const d = dist[node] === -1 ? n : dist[node];
        if (d < nearest) nearest = d;
      }
      if (nearest > bestScore) {
        bestScore = nearest;
        best = node;
      }
    }
    if (best === -1) break;
    seeds.push(best);
  }

  return seeds.sort((a, b) => a - b);
}

/**
 * Multi-source breadth-first growth over the offset-carrying local graph.
 *
 * Each cluster is connected by construction, and every local picks up the wedge
 * offset implied by the edge that reached it — so rotating a finished region
 * lands exactly on the next one.
 *
 * Growth is capped at an even share so one seed cannot swallow the map; a
 * second uncapped pass then sweeps up anything left over.
 */
function growClusters(
  localEdges: readonly { to: number; delta: number }[][],
  seeds: readonly number[],
  layout: SymmetryLayout,
): { cluster: number[]; offset: number[] } {
  const size = localEdges.length;
  const cluster = new Array<number>(size).fill(-1);
  const offset = new Array<number>(size).fill(0);
  const counts = new Array<number>(seeds.length).fill(0);
  const cap = Math.ceil(size / Math.max(1, seeds.length));

  const queue: number[] = [];
  seeds.forEach((seed, index) => {
    cluster[seed] = index;
    offset[seed] = 0;
    counts[index] = 1;
    queue.push(seed);
  });

  const visit = (respectCap: boolean): void => {
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head];
      const own = cluster[node];
      if (respectCap && counts[own] >= cap) continue;

      for (const edge of localEdges[node]) {
        if (cluster[edge.to] !== -1) continue;
        if (respectCap && counts[own] >= cap) break;
        cluster[edge.to] = own;
        offset[edge.to] = (offset[node] + edge.delta) % layout.playerCount;
        counts[own]++;
        queue.push(edge.to);
      }
    }
  };

  visit(true);
  visit(false);

  // A local the wavefront never reached (isolated in the local graph) joins the
  // lowest-indexed assigned neighbour, taking that edge's offset.
  for (let local = 0; local < size; local++) {
    if (cluster[local] !== -1) continue;
    const edge = localEdges[local].find((e) => cluster[e.to] !== -1);
    if (!edge) {
      cluster[local] = 0;
      offset[local] = 0;
      continue;
    }
    cluster[local] = cluster[edge.to];
    // Invert the edge: offset(local) = offset(neighbour) - delta.
    offset[local] =
      ((offset[edge.to] - edge.delta) % layout.playerCount + layout.playerCount) %
      layout.playerCount;
  }

  return { cluster, offset };
}

// ─── Starts, storm waves, garrisons ──────────────────────────────────────────

function buildStarts(
  layout: SymmetryLayout,
  adjacency: readonly number[][],
  wedge: readonly Polar[],
): StartingPosition[] {
  // Capital sits partway out: room to expand inward toward the contested
  // centre, and outward into the land the storm will eventually take.
  const target = WORLD_RADIUS * CAPITAL_RADIUS_FRACTION;
  let capitalLocal = 0;
  let bestDelta = Infinity;
  for (let local = 0; local < layout.perWedge; local++) {
    const delta = Math.abs(wedge[local].r - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      capitalLocal = local;
    }
  }

  const capitals = new Set<number>();
  for (let w = 0; w < layout.playerCount; w++) {
    capitals.add(territoryId(layout, capitalLocal, w));
  }

  return Array.from({ length: layout.playerCount }, (_, slot) => {
    const capital = territoryId(layout, capitalLocal, slot);
    const ordered = equivariantNeighbourOrder(layout, capital, adjacency[capital]);

    // Prefer neighbours inside the player's own wedge, so a start is a coherent
    // little country rather than a scatter of tiles across a rival's doorstep.
    const sameWedge = ordered.filter(
      (id) => id !== layout.centre && !capitals.has(id) && wedgeOf(layout, id) === slot,
    );
    const other = ordered.filter(
      (id) => id !== layout.centre && !capitals.has(id) && wedgeOf(layout, id) !== slot,
    );

    return { slot, capital, extra: [...sameWedge, ...other].slice(0, 2) };
  });
}

/**
 * Radial collapse waves.
 *
 * The storm burns the world inward from the rim. Because waves are radial and
 * the map is symmetric, every player loses the same amount at the same moment —
 * it is pressure, not a punishment aimed at whoever happens to be losing. The
 * innermost ring and the centre never collapse, so the endgame is always fought
 * over the same contested core.
 */
function buildCollapseWaves(layout: SymmetryLayout, wedge: readonly Polar[]): TerritoryId[][] {
  const byRadius = Array.from({ length: layout.perWedge }, (_, local) => local).sort(
    (a, b) => wedge[b].r - wedge[a].r || a - b,
  );

  const collapsible = byRadius.slice(0, Math.max(0, layout.perWedge - 1));
  if (collapsible.length === 0) return [];

  const waveCount = Math.min(6, collapsible.length);
  const waves: TerritoryId[][] = Array.from({ length: waveCount }, () => []);

  collapsible.forEach((local, index) => {
    // Spread locals evenly across waves, outermost first.
    const wave = Math.min(waveCount - 1, Math.floor((index * waveCount) / collapsible.length));
    for (let w = 0; w < layout.playerCount; w++) {
      waves[wave].push(territoryId(layout, local, w));
    }
  });

  for (const wave of waves) wave.sort((a, b) => a - b);
  return waves.filter((wave) => wave.length > 0);
}

function buildTerritories(
  layout: SymmetryLayout,
  cells: Cells,
  regionOf: readonly number[],
  collapseWaves: readonly TerritoryId[][],
  rng: Rng,
): Territory[] {
  const names = territoryNames(rng, layout.count);
  const waveOf = new Array<number>(layout.count).fill(-1);
  collapseWaves.forEach((wave, index) => {
    for (const id of wave) waveOf[id] = index;
  });

  return Array.from({ length: layout.count }, (_, id) => {
    const polygon = cells.polygons[id] ?? [];
    return {
      id,
      name: names[id],
      regionId: regionOf[id],
      // Quantised to integers so the frozen snapshot is exactly reproducible
      // and free of float formatting drift.
      centroid: [Math.round(cells.positions[id][0]), Math.round(cells.positions[id][1])] as [
        number,
        number,
      ],
      polygon: polygon.map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]),
      wave: waveOf[id],
    };
  });
}

function buildNeutralGarrisons(
  layout: SymmetryLayout,
  adjacency: readonly number[][],
  starts: readonly StartingPosition[],
): Record<TerritoryId, number> {
  const claimed = new Set<number>();
  for (const start of starts) {
    claimed.add(start.capital);
    for (const id of start.extra) claimed.add(id);
  }

  const garrisons: Record<TerritoryId, number> = {};
  for (let id = 0; id < layout.count; id++) {
    if (claimed.has(id)) continue;
    let garrison = 2;
    // The centre and well-connected crossroads are worth more, so they cost
    // more to take — otherwise the best land on the map is also the cheapest.
    if (id === layout.centre) garrison += 1;
    if (adjacency[id].length >= 5) garrison += 1;
    garrisons[id] = garrison;
  }
  return garrisons;
}
