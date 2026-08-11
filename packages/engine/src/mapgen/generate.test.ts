import { describe, expect, it } from 'vitest';
import { bfsDistances, isConnected } from '../graph.js';
import { generateMap, MAX_PLAYERS, MIN_PLAYERS } from './generate.js';
import { WORLD_RADIUS } from './points.js';
import { makeLayout, perWedgeFor, rotate, wedgeOf, type SymmetryLayout } from './symmetry.js';
import {
  MAX_DEGREE,
  MIN_DEGREE,
  validateFairness,
  validateGraph,
  validateStructure,
  validateSymmetry,
} from './validate.js';

const PLAYER_COUNTS = Array.from(
  { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
  (_, i) => MIN_PLAYERS + i,
);

/**
 * Seeds swept per player count. The exhaustive sweep is a separate, slower CI
 * job; this keeps the default `pnpm test` fast enough to run constantly while
 * still covering every table size.
 */
const SEEDS_PER_COUNT = Number(process.env.MAPGEN_SEEDS ?? 25);

function layoutFor(playerCount: number): SymmetryLayout {
  return makeLayout(playerCount, perWedgeFor(playerCount));
}

function seeds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `sweep-${i}`);
}

describe('generateMap', () => {
  it('rejects player counts outside the supported range', () => {
    expect(() => generateMap('s', 1)).toThrow();
    expect(() => generateMap('s', 13)).toThrow();
    expect(() => generateMap('s', 4.5)).toThrow();
  });

  it('is a pure function of its seed and player count', () => {
    const a = generateMap('repeatable', 6);
    const b = generateMap('repeatable', 6);
    expect(b).toEqual(a);
  });

  it('produces different worlds for different seeds', () => {
    const a = generateMap('alpha', 6);
    const b = generateMap('beta', 6);
    expect(a.territories.map((t) => t.centroid)).not.toEqual(b.territories.map((t) => t.centroid));
  });

  it('quantises all coordinates to integers', () => {
    // The frozen snapshot is canonical for replay, so it must not carry float
    // formatting drift between platforms.
    const map = generateMap('integers', 8);
    for (const territory of map.territories) {
      expect(Number.isInteger(territory.centroid[0])).toBe(true);
      expect(Number.isInteger(territory.centroid[1])).toBe(true);
      for (const [x, y] of territory.polygon) {
        expect(Number.isInteger(x)).toBe(true);
        expect(Number.isInteger(y)).toBe(true);
      }
    }
  });

  describe.each(PLAYER_COUNTS)('with %i players', (playerCount) => {
    const layout = layoutFor(playerCount);
    const maps = seeds(SEEDS_PER_COUNT).map((seed) => generateMap(seed, playerCount));

    it('passes every structural constraint on every seed', () => {
      const failures: string[] = [];
      for (const map of maps) {
        const issues = [
          ...validateGraph(map.adjacency, new Set([layout.centre])),
          ...validateSymmetry(layout, map.adjacency),
          ...validateStructure(map),
        ];
        if (issues.length > 0) {
          failures.push(`${map.seed}: ${issues.map((i) => `${i.code}(${i.detail})`).join(', ')}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it('gives every seat a structurally identical start', () => {
      // The whole point of the wedge construction. If this ever fails, seat win
      // rates will drift and no amount of tuning elsewhere will fix it.
      const failures: string[] = [];
      for (const map of maps) {
        const issues = validateFairness(map);
        if (issues.length > 0) failures.push(`${map.seed}: ${issues.map((i) => i.detail).join(', ')}`);
      }
      expect(failures).toEqual([]);
    });

    it('is invariant under a one-wedge rotation', () => {
      for (const map of maps) {
        for (let id = 0; id < layout.count; id++) {
          const rotated = rotate(layout, id, 1);
          const expected = new Set(map.adjacency[id].map((n) => rotate(layout, n, 1)));
          expect(new Set(map.adjacency[rotated])).toEqual(expected);
        }
      }
    });

    it('keeps every territory reachable and out of a dead end', () => {
      for (const map of maps) {
        expect(isConnected(map.adjacency)).toBe(true);
        for (let id = 0; id < layout.count; id++) {
          const degree = map.adjacency[id].length;
          expect(degree).toBeGreaterThanOrEqual(MIN_DEGREE);
          if (id !== layout.centre) expect(degree).toBeLessThanOrEqual(MAX_DEGREE);
        }
      }
    });

    it('seats one player per wedge with a distinct start', () => {
      for (const map of maps) {
        expect(map.starts).toHaveLength(playerCount);
        const claimed = new Set<number>();
        for (const start of map.starts) {
          expect(wedgeOf(layout, start.capital)).toBe(start.slot);
          expect(start.extra.length).toBeGreaterThan(0);
          for (const id of [start.capital, ...start.extra]) {
            expect(claimed.has(id)).toBe(false);
            claimed.add(id);
          }
        }
      }
    });

    it('leaves a contested core once the storm has finished', () => {
      for (const map of maps) {
        const collapsing = new Set(map.collapseWaves.flat());
        const survivors = map.territories.filter((t) => !collapsing.has(t.id));

        // Enough ground for a real endgame, little enough to force a decision.
        expect(survivors.length).toBeGreaterThanOrEqual(2);
        expect(survivors.length).toBeLessThanOrEqual(playerCount + 4);

        // The centre is the final battleground and never burns.
        expect(collapsing.has(layout.centre)).toBe(false);

        // Waves are radial: every wave takes the same count from each wedge.
        for (const wave of map.collapseWaves) {
          const perWedge = new Map<number, number>();
          for (const id of wave) {
            const w = wedgeOf(layout, id);
            perWedge.set(w, (perWedge.get(w) ?? 0) + 1);
          }
          expect(new Set(perWedge.values()).size).toBe(1);
          expect(perWedge.size).toBe(playerCount);
        }
      }
    });

    it('gives every region a contiguous body and a sane bonus', () => {
      for (const map of maps) {
        for (const region of map.regions) {
          expect(region.territoryIds.length).toBeGreaterThan(0);
          expect(region.bonus).toBeGreaterThanOrEqual(2);
          expect(region.bonus).toBeLessThanOrEqual(8);
        }
        const covered = map.regions.flatMap((r) => r.territoryIds);
        expect(new Set(covered).size).toBe(map.territories.length);
      }
    });

    it('does not clamp every region bonus to the floor', () => {
      // Regression guard. The bonus formula charges exposure per territory
      // rather than as a flat subtraction; a flat one swamps the size term at
      // this graph density and pins every region in the game to the minimum,
      // which quietly removes the entire incentive to hold a region.
      const distinct = new Set<number>();
      let aboveFloor = 0;
      for (const map of maps) {
        for (const region of map.regions) {
          distinct.add(region.bonus);
          if (region.bonus > 2) aboveFloor++;
        }
      }
      expect(distinct.size).toBeGreaterThan(1);
      expect(aboveFloor).toBeGreaterThan(0);
    });

    it('keeps regions small enough to be takeable', () => {
      for (const map of maps) {
        // Excluding the single-territory centre region.
        const bodies = map.regions.filter((r) => r.territoryIds.length > 1);
        for (const region of bodies) {
          expect(region.territoryIds.length).toBeGreaterThanOrEqual(2);
          expect(region.territoryIds.length).toBeLessThanOrEqual(7);
        }
      }
    });

    it('keeps every territory inside the world', () => {
      for (const map of maps) {
        for (const territory of map.territories) {
          const r = Math.hypot(territory.centroid[0], territory.centroid[1]);
          expect(r).toBeLessThanOrEqual(WORLD_RADIUS * 1.05);
        }
      }
    });

    it('scales roughly to six territories per player', () => {
      const map = maps[0];
      expect(map.territories.length).toBe(layout.count);
      expect(map.territories.length / playerCount).toBeGreaterThan(4.5);
      expect(map.territories.length / playerCount).toBeLessThan(11);
    });
  });
});

describe('sea lanes', () => {
  it('reach across wedges rather than looping inside one', () => {
    // A lane inside a single wedge would be nearly pointless: a wedge is a
    // narrow slice, so everything in it is already a hop or two apart. The
    // lane earns its place only by connecting distant parts of the map.
    for (const playerCount of [4, 6, 8, 12]) {
      const layout = layoutFor(playerCount);
      let found = 0;

      for (const seed of seeds(10)) {
        const map = generateMap(seed, playerCount);
        const lanes = map.edges.filter((e) => e.kind === 'sea');
        if (lanes.length === 0) continue;
        found++;

        // Distance in the land-only graph between a lane's endpoints.
        const landOnly: number[][] = Array.from({ length: layout.count }, () => []);
        for (const edge of map.edges) {
          if (edge.kind !== 'land') continue;
          landOnly[edge.a].push(edge.b);
          landOnly[edge.b].push(edge.a);
        }
        for (const lane of lanes) {
          const dist = bfsDistances(landOnly, lane.a);
          expect(dist[lane.b]).toBeGreaterThanOrEqual(4);
        }
      }

      expect(found).toBeGreaterThan(0);
    }
  });
});
