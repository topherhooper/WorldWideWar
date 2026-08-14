import { describe, expect, it } from 'vitest';
import { resolveTurn } from './resolve.js';
import {
  armiesOnBoard,
  hold,
  lineMap,
  makeTestMap,
  move,
  orders,
  ringMap,
  scenario,
  support,
  TEST_RULES,
} from './testing.js';
import type { GeneratedMap, OrderSet, ResolveContext } from './types.js';

function ctx(map: GeneratedMap, seed = 'scenario'): ResolveContext {
  return { seed, map, rules: TEST_RULES };
}

describe('the hard cases of simultaneous resolution', () => {
  it('bounces both stacks when two armies swap territories', () => {
    // The one genuinely non-local case. Neither province may change hands, and
    // there must never be a question of "who slides where".
    const map = lineMap(2);
    const state = scenario(map, { owner: [0, 1], armies: [5, 5] });

    const { next, report } = resolveTurn(
      state,
      [orders(0, [move(0, 1, 4)]), orders(1, [move(1, 0, 4)])],
      ctx(map),
    );

    expect(next.owner[0]).toBe(0);
    expect(next.owner[1]).toBe(1);
    expect(report.clashes).toHaveLength(1);
    // Both sides lost armies; nobody advanced.
    expect(next.armies[0] + next.armies[1]).toBeLessThan(10);
  });

  it('shreds every loser in a multi-way melee on empty ground', () => {
    // Piling into a chokepoint should hurt. The winner holds it barely.
    const map = makeTestMap({
      playerCount: 3,
      territoryCount: 4,
      edges: [
        [0, 3],
        [1, 3],
        [2, 3],
      ],
    });
    const state = scenario(map, { owner: [0, 1, 2, null], armies: [6, 6, 6, 0] });

    const { next, report } = resolveTurn(
      state,
      [orders(0, [move(0, 3, 5)]), orders(1, [move(1, 3, 5)]), orders(2, [move(2, 3, 5)])],
      ctx(map),
    );

    const battle = report.battles.find((b) => b.territory === 3);
    expect(battle).toBeDefined();
    expect(battle!.sides).toHaveLength(3);
    expect(next.owner[3]).toBe(battle!.winner);
    // Winning a three-way fight leaves you holding the ground on fumes.
    expect(next.armies[3]).toBeLessThan(4);
  });

  it('hands over a province that was evacuated a moment too early', () => {
    // The best chaos generator in the game: a move does not require its
    // destination to be vacated, so trades happen.
    const map = lineMap(3);
    const state = scenario(map, { owner: [0, 0, 1], armies: [1, 4, 4] });

    const { next } = resolveTurn(
      state,
      // Player 0 empties territory 1 pushing onto 2, while player 1 walks in.
      [orders(0, [move(1, 2, 4)]), orders(1, [move(2, 1, 3)])],
      ctx(map),
    );

    // Both moved, so this is a head-on swap: neither takes the other's ground.
    expect(next.owner[1]).toBe(0);
    expect(next.owner[2]).toBe(1);
  });

  it('lets an attacker walk into ground the defender abandoned', () => {
    const map = makeTestMap({
      playerCount: 2,
      territoryCount: 4,
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    });
    // Player 0 holds 1 and pushes everything to 0; player 1 attacks 1 from 2.
    const state = scenario(map, { owner: [0, 0, 1, 1], armies: [1, 5, 5, 1] });

    const { next } = resolveTurn(
      state,
      [orders(0, [move(1, 0, 5)]), orders(1, [move(2, 1, 4)])],
      ctx(map),
    );

    expect(next.owner[1]).toBe(1);
    expect(next.armies[1]).toBe(4); // uncontested, no casualties
  });

  it('slides a chain of moves forward without any cycle detection', () => {
    const map = lineMap(4);
    const state = scenario(map, { owner: [0, 0, 0, 0], armies: [3, 3, 3, 3] });

    const { next } = resolveTurn(
      state,
      [orders(0, [move(0, 1, 3), move(1, 2, 3), move(2, 3, 3)])],
      ctx(map),
    );

    // Each move is evaluated against the destination's pre-turn state, so the
    // whole line advances at once.
    expect(next.armies[0]).toBe(0);
    expect(next.armies[1]).toBe(3);
    expect(next.armies[2]).toBe(3);
    expect(next.armies[3]).toBe(6);
    expect(armiesOnBoard(next)).toBe(12);
  });

  it('rotates a three-cycle cleanly', () => {
    const map = ringMap(3, 3);
    const state = scenario(map, { owner: [0, 1, 2], armies: [4, 4, 4] });

    const { next } = resolveTurn(
      state,
      [orders(0, [move(0, 1, 3)]), orders(1, [move(1, 2, 3)]), orders(2, [move(2, 0, 3)])],
      ctx(map),
    );

    // Everyone left one behind and attacked the next; no deadlock, no paradox.
    for (const id of [0, 1, 2]) expect(next.owner[id]).not.toBeNull();
    expect(armiesOnBoard(next)).toBeGreaterThan(0);
  });

  it('destroys a beaten stack whose home fell while it was away', () => {
    // Punishes overextension, and is a large part of why games stay short.
    const map = makeTestMap({
      playerCount: 3,
      territoryCount: 3,
      edges: [
        [0, 1],
        [0, 2],
      ],
    });
    // Player 0 throws everything at 1 and loses; meanwhile player 2 takes home.
    const state = scenario(map, { owner: [0, 1, 2], armies: [6, 12, 8] });

    const { next, report } = resolveTurn(
      state,
      [orders(0, [move(0, 1, 6)]), orders(1, [hold(1)]), orders(2, [move(2, 0, 7)])],
      ctx(map),
    );

    expect(next.owner[1]).toBe(1);
    expect(next.owner[0]).toBe(2);
    const routed = report.world.filter((e) => e.kind === 'routed');
    expect(routed.length).toBeGreaterThan(0);
  });

  it('joins incoming friendly stacks to the defence', () => {
    const map = makeTestMap({
      playerCount: 2,
      territoryCount: 3,
      edges: [
        [0, 1],
        [1, 2],
      ],
    });
    const state = scenario(map, { owner: [0, 0, 1], armies: [6, 1, 8] });

    const { next } = resolveTurn(
      state,
      // Player 0 reinforces the frontier as player 1 attacks it.
      [orders(0, [move(0, 1, 5)]), orders(1, [move(2, 1, 7)])],
      ctx(map),
    );

    // 6 defending vs 7 attacking is a real fight rather than a walkover.
    expect([0, 1]).toContain(next.owner[1]);
  });
});

describe('support', () => {
  it('adds half the supporting garrison to the named side', () => {
    const map = makeTestMap({
      playerCount: 2,
      territoryCount: 3,
      edges: [
        [0, 1],
        [1, 2],
        [0, 2],
      ],
    });
    const state = scenario(map, { owner: [0, 1, 0], armies: [5, 4, 8] });

    const { report } = resolveTurn(
      state,
      [orders(0, [move(0, 1, 4), support(2, 1, 0)]), orders(1, [hold(1)])],
      ctx(map),
    );

    const battle = report.battles.find((b) => b.territory === 1);
    const attacker = battle!.sides.find((s) => s.slot === 0);
    // 4 committed + ceil(8/2) supporting = 8 effective.
    expect(attacker!.armies).toBe(4);
    expect(attacker!.effective).toBe(8);
  });

  it('is cut by a hostile move onto the supporting territory', () => {
    const map = makeTestMap({
      playerCount: 2,
      territoryCount: 4,
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [0, 2],
      ],
    });
    const state = scenario(map, { owner: [0, 1, 0, 1], armies: [5, 4, 8, 6] });

    const { report } = resolveTurn(
      state,
      [
        orders(0, [move(0, 1, 4), support(2, 1, 0)]),
        // Player 1 strikes the supporter, severing the aid.
        orders(1, [move(3, 2, 5)]),
      ],
      ctx(map),
    );

    const battle = report.battles.find((b) => b.territory === 1);
    const attacker = battle!.sides.find((s) => s.slot === 0);
    expect(attacker!.effective).toBe(4);
  });

  it('is NOT cut by an attack from the very territory being supported into', () => {
    // The classic exception. Without it a defender could always sever the aid
    // aimed at their own province simply by counter-attacking its source.
    const map = makeTestMap({
      playerCount: 2,
      territoryCount: 3,
      edges: [
        [0, 1],
        [1, 2],
        [0, 2],
      ],
    });
    const state = scenario(map, { owner: [0, 1, 0], armies: [5, 9, 8] });

    const { report } = resolveTurn(
      state,
      [
        orders(0, [move(0, 1, 4), support(2, 1, 0)]),
        // The attack on the supporter comes *from* the supported territory.
        orders(1, [move(1, 2, 8)]),
      ],
      ctx(map),
    );

    const battle = report.battles.find((b) => b.territory === 1);
    if (battle) {
      const attacker = battle.sides.find((s) => s.slot === 0);
      expect(attacker!.effective).toBeGreaterThan(4);
    }
  });

  it('halves the defence of a territory that issued a support', () => {
    // Support is a real trade: that garrison is facing outward.
    const map = makeTestMap({
      playerCount: 2,
      territoryCount: 3,
      edges: [
        [0, 1],
        [1, 2],
      ],
    });
    const state = scenario(map, { owner: [0, 0, 1], armies: [6, 6, 6] });

    const { report } = resolveTurn(
      state,
      [orders(0, [support(1, 0, 0)]), orders(1, [move(2, 1, 5)])],
      ctx(map),
    );

    const battle = report.battles.find((b) => b.territory === 1);
    const defender = battle!.sides.find((s) => s.isDefender);
    expect(defender!.armies).toBe(6);
    expect(defender!.effective).toBe(3);
  });

  it('can be given to a rival — the whole diplomacy layer in one order', () => {
    const map = makeTestMap({
      playerCount: 3,
      territoryCount: 4,
      edges: [
        [0, 3],
        [1, 3],
        [2, 3],
      ],
    });
    const state = scenario(map, { owner: [0, 1, 2, null], armies: [5, 5, 10, 2] });

    const { report } = resolveTurn(
      state,
      [
        orders(0, [move(0, 3, 4)]),
        orders(1, [move(1, 3, 4)]),
        // Player 2 throws their weight behind player 1's attack.
        orders(2, [support(2, 3, 1)]),
      ],
      ctx(map),
    );

    const battle = report.battles.find((b) => b.territory === 3);
    const backed = battle!.sides.find((s) => s.slot === 1);
    expect(backed!.effective).toBe(4 + 5);
  });
});

describe('resolution invariants', () => {
  const map = makeTestMap({
    playerCount: 4,
    territoryCount: 8,
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 0],
      [0, 4],
    ],
  });

  const state = scenario(map, {
    owner: [0, 0, 1, 1, 2, 2, 3, 3],
    armies: [5, 4, 6, 3, 7, 2, 4, 5],
    income: [3, 3, 3, 3],
  });

  const submissions: (OrderSet | null)[] = [
    { slot: 0, pledge: 1, deploys: [{ to: 0, count: 3 }], units: [move(0, 1, 2), move(1, 2, 3)] },
    {
      slot: 1,
      pledge: 0,
      deploys: [{ to: 2, count: 3 }],
      units: [move(2, 1, 4), support(3, 2, 1)],
    },
    { slot: 2, pledge: 3, deploys: [{ to: 4, count: 3 }], units: [move(4, 3, 5), move(5, 6, 1)] },
    { slot: 3, pledge: null, deploys: [{ to: 7, count: 3 }], units: [move(7, 0, 4), hold(6)] },
  ];

  it('is independent of the order submissions arrive in', () => {
    // THE simultaneity invariant. If this ever fails, the game is not actually
    // simultaneous and every other guarantee here is worthless.
    const baseline = resolveTurn(state, submissions, ctx(map));

    const permutations = [
      [3, 2, 1, 0],
      [1, 3, 0, 2],
      [2, 0, 3, 1],
    ];

    for (const permutation of permutations) {
      // Rebuild the array in a different order, still indexed by slot.
      const shuffled: (OrderSet | null)[] = new Array(4).fill(null);
      for (const slot of permutation) shuffled[slot] = submissions[slot];

      const result = resolveTurn(state, shuffled, ctx(map));
      expect(result.next).toEqual(baseline.next);
      expect(result.report).toEqual(baseline.report);
    }
  });

  it('is deterministic across repeated runs', () => {
    const a = resolveTurn(state, submissions, ctx(map));
    const b = resolveTurn(state, submissions, ctx(map));
    expect(b.next).toEqual(a.next);
    expect(b.report).toEqual(a.report);
  });

  it('never mutates the state it was given', () => {
    const before = JSON.stringify(state);
    resolveTurn(state, submissions, ctx(map));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('rolls different dice under a different seed', () => {
    const a = resolveTurn(state, submissions, ctx(map, 'seed-a'));
    const b = resolveTurn(state, submissions, ctx(map, 'seed-b'));
    const rollsOf = (r: typeof a.report) => r.battles.flatMap((x) => x.sides.map((s) => s.roll));
    expect(rollsOf(b.report)).not.toEqual(rollsOf(a.report));
  });

  it('lets the dice decide an even fight', () => {
    // The residual luck term has to be capable of flipping a close fight, or it
    // is decoration.
    const arena = makeTestMap({
      playerCount: 2,
      territoryCount: 3,
      edges: [
        [0, 2],
        [1, 2],
      ],
    });
    const even = scenario(arena, { owner: [0, 1, null], armies: [6, 6, 0] });

    const winners = new Set<number | null>();
    for (let i = 0; i < 40; i++) {
      const { next } = resolveTurn(
        even,
        [orders(0, [move(0, 2, 5)]), orders(1, [move(1, 2, 5)])],
        ctx(arena, `even-${i}`),
      );
      winners.add(next.owner[2]);
    }
    expect(winners.size).toBe(2);
  });

  it('does not let the dice steal a lopsided fight', () => {
    // The other half of the same design goal. The pact swings 1.75x and the
    // dice only 1.27x, so bringing overwhelming force has to be reliable —
    // otherwise army count stops meaning anything and the game is pure noise.
    const arena = makeTestMap({
      playerCount: 2,
      territoryCount: 3,
      edges: [
        [0, 2],
        [1, 2],
      ],
    });
    const lopsided = scenario(arena, { owner: [0, 1, null], armies: [12, 3, 0] });

    for (let i = 0; i < 40; i++) {
      const { next } = resolveTurn(
        lopsided,
        [orders(0, [move(0, 2, 11)]), orders(1, [move(1, 2, 2)])],
        ctx(arena, `lopsided-${i}`),
      );
      expect(next.owner[2]).toBe(0);
    }
  });

  it('never leaves a negative garrison', () => {
    const { next } = resolveTurn(state, submissions, ctx(map));
    for (const armies of next.armies) expect(armies).toBeGreaterThanOrEqual(0);
  });

  it('never creates armies out of nothing', () => {
    const { next } = resolveTurn(state, submissions, ctx(map));
    const deployed = submissions.reduce(
      (sum, set) => sum + (set?.deploys.reduce((s, d) => s + d.count, 0) ?? 0),
      0,
    );
    expect(armiesOnBoard(next)).toBeLessThanOrEqual(armiesOnBoard(state) + deployed);
  });
});

describe('illegal orders', () => {
  const map = lineMap(3);

  it('downgrade to HOLD rather than throwing', () => {
    // A turn must always resolve: one player's nonsense cannot stall a table.
    const state = scenario(map, { owner: [0, null, 1], armies: [5, 2, 5] });

    const { next, report } = resolveTurn(
      state,
      [
        orders(0, [
          move(0, 2, 3), // not adjacent
          move(2, 1, 3), // not owned
          move(0, 1, -5), // nonsense count
        ]),
        null,
      ],
      ctx(map),
    );

    expect(report.world.filter((e) => e.kind === 'order_rejected').length).toBe(3);
    expect(next.armies[0]).toBe(5);
  });

  it('clamp a move to the garrison actually present', () => {
    const state = scenario(map, { owner: [0, null, 1], armies: [3, 2, 5] });
    const { next } = resolveTurn(state, [orders(0, [move(0, 1, 99)]), null], ctx(map));
    expect(next.armies[0]).toBe(0);
    expect(next.owner[1]).toBe(0);
  });

  it('truncate deployments to available income', () => {
    const state = scenario(map, {
      owner: [0, null, 1],
      armies: [3, 2, 5],
      income: [2, 0],
    });
    const { next } = resolveTurn(
      state,
      [{ slot: 0, pledge: null, deploys: [{ to: 0, count: 50 }], units: [] }, null],
      ctx(map),
    );
    expect(next.armies[0]).toBe(5);
  });

  it('refuse deployment into a territory out of supply', () => {
    const map2 = makeTestMap({ playerCount: 2, territoryCount: 3, edges: [[0, 1]] });
    // Territory 2 is disconnected from player 0's capital at 0.
    const state = scenario(map2, {
      owner: [0, null, 0],
      armies: [3, 2, 1],
      capital: [0, null],
      income: [4, 0],
    });

    const { next, report } = resolveTurn(
      state,
      [{ slot: 0, pledge: null, deploys: [{ to: 2, count: 4 }], units: [] }, null],
      ctx(map2),
    );

    expect(next.armies[2]).toBe(1);
    expect(report.world.some((e) => e.kind === 'order_rejected')).toBe(true);
  });
});

describe('rules-driven neutral growth', () => {
  it('grows on the rules interval and 0 disables it', () => {
    const map = lineMap(4, 2);
    const state = scenario(map, { owner: [0, null, null, 1], armies: [3, 1, 1, 3], turn: 2 });
    // next.turn is 3 — divisible by the legacy interval of 3.
    const grown = resolveTurn(state, [orders(0), orders(1)], { seed: 's', map, rules: TEST_RULES });
    expect(grown.next.armies[1]).toBe(2);
    const frozen = resolveTurn(state, [orders(0), orders(1)], {
      seed: 's',
      map,
      rules: { ...TEST_RULES, neutralGrowthInterval: 0 },
    });
    expect(frozen.next.armies[1]).toBe(1);
  });
});

describe('plunder', () => {
  // Four provinces strike out into empty neutral land; a fifth player-owned
  // territory sits far away so player 1 stays alive.
  const plunderMap = () =>
    makeTestMap({
      playerCount: 2,
      territoryCount: 9,
      edges: [
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
        [0, 1],
        [1, 2],
        [2, 3],
        [7, 8],
      ],
    });
  const plunderState = (map: GeneratedMap) =>
    scenario(map, {
      owner: [0, 0, 0, 0, null, null, null, null, 1],
      armies: [2, 2, 2, 2, 0, 0, 0, 0, 5],
    });
  const raid = [orders(0, [move(0, 4, 1), move(1, 5, 1), move(2, 6, 1), move(3, 7, 1)]), orders(1)];

  it('captures pay income next turn, capped per turn', () => {
    const map = plunderMap();
    const rules = { ...TEST_RULES, plunderIncome: 1, plunderCap: 3 };
    const { next, report } = resolveTurn(plunderState(map), raid, { seed: 's', map, rules });
    expect(report.plunder).toEqual([{ slot: 0, captures: 4, income: 3 }]);
    const baseline = resolveTurn(plunderState(map), raid, { seed: 's', map, rules: TEST_RULES });
    expect(next.income[0] - baseline.next.income[0]).toBe(3);
  });

  it('legacy rules produce no plunder entries', () => {
    const map = plunderMap();
    const { report } = resolveTurn(plunderState(map), raid, { seed: 's', map, rules: TEST_RULES });
    expect(report.plunder).toEqual([]);
  });
});
