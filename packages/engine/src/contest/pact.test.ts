import { describe, expect, it } from 'vitest';
import { PACT_MULTIPLIER } from '../constants.js';
import { resolveTurn } from '../resolve.js';
import { hold, makeTestMap, move, orders, scenario, TEST_RULES } from '../testing.js';
import type { GameState, PactOutcome, Slot } from '../types.js';
import { applyPactRecord, concordPair, MAX_COURTED_BONUS, resolvePacts } from './pact.js';

/** Four players who cannot reach each other, so only the pact is under test. */
function isolated(playerCount = 4): GameState {
  const map = makeTestMap({
    playerCount,
    territoryCount: playerCount,
    edges: [],
  });
  return scenario(map, {
    owner: Array.from({ length: playerCount }, (_, i) => i),
    armies: new Array<number>(playerCount).fill(5),
  });
}

function run(
  state: GameState,
  pledges: (Slot | null)[],
  attacks: [Slot, Slot][] = [],
): ReturnType<typeof resolvePacts> {
  const attacked = Array.from({ length: state.playerCount }, () =>
    new Array<boolean>(state.playerCount).fill(false),
  );
  for (const [a, b] of attacks) attacked[a][b] = true;

  const aliveSlots = Array.from({ length: state.playerCount }, (_, i) => i);
  return resolvePacts(state, pledges, { attacked, aliveSlots, rules: TEST_RULES });
}

function outcomeOf(result: ReturnType<typeof resolvePacts>, slot: Slot): PactOutcome {
  return result.results.find((r) => r.slot === slot)!.outcome;
}

describe('the pact payoff matrix', () => {
  const state = isolated();

  it('rewards both sides of a concord', () => {
    const result = run(state, [1, 0, null, null]);
    expect(outcomeOf(result, 0)).toBe('concord');
    expect(outcomeOf(result, 1)).toBe('concord');
    expect(result.multiplier[0]).toBe(PACT_MULTIPLIER.concord);
    expect(result.multiplier[1]).toBe(PACT_MULTIPLIER.concord);
  });

  it('pays the betrayer best of all', () => {
    // Deliberate. A dilemma where cooperation strictly dominates is not a
    // dilemma; what makes betrayal survivable is that it is public and counted
    // forever, not that it is unprofitable.
    const result = run(state, [1, 0, null, null], [[0, 1]]);
    expect(outcomeOf(result, 0)).toBe('betrayal');
    expect(outcomeOf(result, 1)).toBe('betrayed');
    expect(result.multiplier[0]).toBe(PACT_MULTIPLIER.betrayal);
    expect(result.multiplier[1]).toBe(PACT_MULTIPLIER.betrayed);
    expect(result.multiplier[0]).toBeGreaterThan(PACT_MULTIPLIER.concord);
  });

  it('leaves both parties looking foolish after mutual treachery', () => {
    const result = run(
      state,
      [1, 0, null, null],
      [
        [0, 1],
        [1, 0],
      ],
    );
    expect(outcomeOf(result, 0)).toBe('mutual_treachery');
    expect(outcomeOf(result, 1)).toBe('mutual_treachery');
    expect(result.multiplier[0]).toBe(PACT_MULTIPLIER.mutual_treachery);
  });

  it('penalises an unreciprocated pledge and pays the one who was courted', () => {
    const result = run(state, [1, 2, null, null]);
    expect(outcomeOf(result, 0)).toBe('spurned');
    expect(result.multiplier[0]).toBe(PACT_MULTIPLIER.spurned);

    expect(outcomeOf(result, 1)).toBe('spurned'); // 1 pledged 2, unreciprocated
    expect(outcomeOf(result, 2)).toBe('courted');
    expect(result.bonusIncome[2]).toBeGreaterThan(0);
    expect(result.multiplier[2]).toBe(PACT_MULTIPLIER.abstain);
  });

  it('treats abstention as safe but unrewarding', () => {
    const result = run(state, [null, null, null, null]);
    for (let slot = 0; slot < 4; slot++) {
      expect(outcomeOf(result, slot)).toBe('abstain');
      expect(result.multiplier[slot]).toBe(PACT_MULTIPLIER.abstain);
      expect(result.bonusIncome[slot]).toBe(0);
    }
  });

  it('caps how much being popular can pay', () => {
    // Without a ceiling, the player everyone wants to befriend snowballs on
    // flattery alone in a twelve-player game.
    const big = isolated(12);
    const pledges: (Slot | null)[] = new Array(12).fill(0);
    pledges[0] = null;
    const result = run(big, pledges);
    expect(result.bonusIncome[0]).toBe(MAX_COURTED_BONUS);
  });

  it('reads consistently from both sides of every pairing', () => {
    // Property: a pact is one relationship, so the two participants' outcomes
    // must always be a legal pairing rather than two independent readings.
    const legalPairs = new Set([
      'concord/concord',
      'betrayal/betrayed',
      'betrayed/betrayal',
      'mutual_treachery/mutual_treachery',
    ]);

    for (const attacks of [
      [],
      [[0, 1]],
      [[1, 0]],
      [
        [0, 1],
        [1, 0],
      ],
    ] as [Slot, Slot][][]) {
      const result = run(state, [1, 0, null, null], attacks);
      const pairing = `${outcomeOf(result, 0)}/${outcomeOf(result, 1)}`;
      expect(legalPairs.has(pairing)).toBe(true);
    }
  });

  it('always lands on a defined multiplier band', () => {
    const bands = new Set(Object.values(PACT_MULTIPLIER));
    for (const pledges of [
      [1, 0, 3, 2],
      [1, 2, 3, 0],
      [null, 0, null, 2],
      [2, 2, 2, null],
    ] as (Slot | null)[][]) {
      const result = run(state, pledges, [
        [0, 1],
        [2, 3],
      ]);
      for (const multiplier of result.multiplier) expect(bands.has(multiplier)).toBe(true);
    }
  });
});

describe('pact normalisation', () => {
  const state = isolated();

  it('treats a pledge to yourself as an abstention', () => {
    const result = run(state, [0, null, null, null]);
    expect(outcomeOf(result, 0)).toBe('abstain');
  });

  it('treats a pledge to a dead player as an abstention', () => {
    const dead = isolated();
    dead.status[1] = 'eliminated';
    const result = run(dead, [1, null, null, null]);
    expect(outcomeOf(result, 0)).toBe('abstain');
  });

  it('treats an out-of-range pledge as an abstention', () => {
    const result = run(state, [99, null, null, null]);
    expect(outcomeOf(result, 0)).toBe('abstain');
  });
});

describe('the public record', () => {
  it('counts honoured pacts for both partners', () => {
    const state = isolated();
    const result = run(state, [1, 0, null, null]);
    applyPactRecord(state, result.results);

    expect(state.pactsHonored[0]).toBe(1);
    expect(state.pactsHonored[1]).toBe(1);
    expect(state.pactPartner[0]).toBe(1);
    expect(state.pactStreak[0]).toBe(1);
  });

  it('remembers a betrayal against the betrayer, by name, forever', () => {
    // This bookkeeping is the entire mechanism that converts a one-shot
    // dilemma into an iterated one. Without it, defection trivially dominates.
    const state = isolated();
    const result = run(state, [1, 0, null, null], [[0, 1]]);
    applyPactRecord(state, result.results);

    expect(state.pactsBroken[0]).toBe(1);
    expect(state.betrayedBy[1][0]).toBe(1);
    expect(state.pactPartner[0]).toBeNull();
    expect(state.pactStreak[0]).toBe(0);
  });

  it('extends a streak only while the same partnership holds', () => {
    const state = isolated();

    for (let turn = 1; turn <= 3; turn++) {
      const result = run(state, [1, 0, null, null]);
      applyPactRecord(state, result.results);
      expect(state.pactStreak[0]).toBe(turn);
    }

    // Switching partners resets, even to another honest concord.
    const switched = run(state, [2, 3, 0, 1]);
    applyPactRecord(state, switched.results);
    expect(state.pactStreak[0]).toBe(1);
    expect(state.pactPartner[0]).toBe(2);
  });

  it('breaks a streak the moment one side defects', () => {
    const state = isolated();
    applyPactRecord(state, run(state, [1, 0, null, null]).results);
    applyPactRecord(state, run(state, [1, 0, null, null]).results);
    expect(state.pactStreak[0]).toBe(2);

    applyPactRecord(state, run(state, [1, 0, null, null], [[1, 0]]).results);
    expect(state.pactStreak[0]).toBe(0);
    expect(state.pactStreak[1]).toBe(0);
  });
});

describe('condominium eligibility', () => {
  it('requires an unbroken concord acknowledged from both sides', () => {
    const state = isolated();
    for (let turn = 0; turn < 3; turn++) {
      applyPactRecord(state, run(state, [1, 0, null, null]).results);
    }
    expect(concordPair(state, 0, 1, 3)).toBe(true);
    expect(concordPair(state, 0, 2, 3)).toBe(false);
  });

  it('refuses a one-sided record', () => {
    const state = isolated();
    applyPactRecord(state, run(state, [1, 0, null, null]).results);
    // Forge one side of the relationship; the pairing must still be rejected.
    state.pactPartner[0] = 1;
    state.pactStreak[0] = 9;
    state.pactPartner[1] = 2;
    expect(concordPair(state, 0, 1, 3)).toBe(false);
  });

  it('is not satisfied by a short streak', () => {
    const state = isolated();
    applyPactRecord(state, run(state, [1, 0, null, null]).results);
    expect(concordPair(state, 0, 1, 3)).toBe(false);
  });
});

describe('the pact in a real turn', () => {
  // Player 0 holds two fronts (territories 0 and 4) so they can strike two
  // different players in one turn — only one order per territory is allowed.
  const battlefield = makeTestMap({
    playerCount: 3,
    territoryCount: 6,
    edges: [
      [0, 1],
      [3, 4],
      [2, 3],
      [4, 5],
    ],
  });

  it('applies the multiplier to every battle the player fights', () => {
    // One contest per turn, applied across the board — so the edge you earned
    // by betraying one player also powers your attack on a third.
    const state = scenario(battlefield, {
      owner: [0, 1, 2, 2, 0, 1],
      armies: [10, 4, 8, 4, 12, 5],
    });

    const { report } = resolveTurn(
      state,
      [
        // Player 0 pledges 2, then attacks them at territory 3 — and attacks
        // player 1 at territory 1 in the same breath.
        { slot: 0, pledge: 2, deploys: [], units: [move(0, 1, 8), move(4, 3, 10)] },
        orders(1, [hold(1)]),
        { slot: 2, pledge: 0, deploys: [], units: [hold(3)] },
      ],
      { seed: 'pact-turn', map: battlefield, rules: TEST_RULES },
    );

    expect(report.pacts.find((p) => p.slot === 0)!.outcome).toBe('betrayal');
    expect(report.pacts.find((p) => p.slot === 2)!.outcome).toBe('betrayed');

    const fought = report.battles.filter((b) => b.sides.some((s) => s.slot === 0));
    expect(fought.length).toBe(2);
    for (const battle of fought) {
      expect(battle.sides.find((s) => s.slot === 0)!.multiplier).toBe(PACT_MULTIPLIER.betrayal);
    }
  });

  it('does not count contesting neutral ground as a betrayal', () => {
    // A pact is a promise not to attack *them*, not a promise to stay out of
    // your partner's way. Racing each other for unclaimed land is fair game,
    // and keeps a concord from being an automatic carve-up of the map.
    const map = makeTestMap({
      playerCount: 2,
      territoryCount: 3,
      edges: [
        [0, 2],
        [1, 2],
      ],
    });
    const state = scenario(map, { owner: [0, 1, null], armies: [8, 8, 2] });

    const { report } = resolveTurn(
      state,
      [
        { slot: 0, pledge: 1, deploys: [], units: [move(0, 2, 7)] },
        { slot: 1, pledge: 0, deploys: [], units: [move(1, 2, 7)] },
      ],
      { seed: 'neutral-race', map, rules: TEST_RULES },
    );

    expect(report.pacts.find((p) => p.slot === 0)!.outcome).toBe('concord');
    expect(report.pacts.find((p) => p.slot === 1)!.outcome).toBe('concord');
  });

  it('leads the headline with a betrayal', () => {
    const state = scenario(battlefield, {
      owner: [0, 1, 2, 2, 0, 1],
      armies: [10, 4, 8, 4, 12, 5],
    });

    const { report } = resolveTurn(
      state,
      [
        { slot: 0, pledge: 2, deploys: [], units: [move(4, 3, 10)] },
        orders(1, [hold(1)]),
        { slot: 2, pledge: 0, deploys: [], units: [hold(3)] },
      ],
      { seed: 'headline', map: battlefield, rules: TEST_RULES },
    );

    expect(report.headline).toContain('broke faith');
  });
});
