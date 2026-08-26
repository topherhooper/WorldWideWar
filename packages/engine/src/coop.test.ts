/**
 * Cooperative mode: the pooled contest, the storm's raiders, and survival.
 *
 * The three pieces are tested separately because they fail in different ways.
 * The pool is arithmetic and has to be exact — an integer division that dropped
 * its remainder would leak coalition armies every turn. The raiders are a
 * placement rule, and the thing worth pinning is *where* they land, since an
 * earlier version put them on the collapse frontier where they measurably did
 * nothing. Survival is a schedule: the coalition must not be able to close the
 * game out early.
 */

import { describe, expect, it } from 'vitest';

import { rulesFor } from './constants.js';
import { resolveTiers, splitPool } from './contest/tiers.js';
import { applyStorm } from './storm.js';
import { makeTestMap, scenario } from './testing.js';
import { commandsArmies, inContest } from './participation.js';
import { checkVictory } from './victory.js';
import type { RuleConfig, TiersList, WorldEvent } from './types.js';

const coopRules = (playerCount: number, turnCap = 8): RuleConfig => ({
  ...rulesFor(playerCount, turnCap, 'tiers'),
  tiersPayout: 'pooled',
  coop: true,
  stormRaiders: 4,
});

/** A list whose true A→F order is exactly its public order, so guessing is easy. */
/** No battles were ordered; the tiers contest ignores this, but the type wants it. */
const noAttacks = (n: number): boolean[][] =>
  Array.from({ length: n }, () => new Array<boolean>(n).fill(false));

const plainList = (prefix: string): TiersList => ({
  items: [0, 1, 2, 3, 4, 5].map((i) => `${prefix}${i}`),
  shuffle: [0, 1, 2, 3, 4, 5],
});

describe('splitPool', () => {
  it('never loses or invents an army', () => {
    for (const pool of [-7, -1, 0, 1, 5, 13]) {
      for (const size of [1, 2, 3, 5]) {
        const recipients = Array.from({ length: size }, (_, i) => i);
        const shares = splitPool(pool, recipients);
        const total = [...shares.values()].reduce((a, b) => a + b, 0);
        expect(total).toBe(pool);
        expect(shares.size).toBe(size);
      }
    }
  });

  it('drops the pool entirely when nobody is left to receive it', () => {
    expect(splitPool(10, []).size).toBe(0);
  });

  it('charges a negative pool rather than rounding it away to free', () => {
    const shares = splitPool(-5, [0, 1, 2]);
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(-5);
    expect([...shares.values()].every((share) => share < 0)).toBe(true);
  });
});

describe('pooled payout', () => {
  const map = makeTestMap({
    playerCount: 3,
    territoryCount: 3,
    edges: [
      [0, 1],
      [1, 2],
    ],
  });

  it('pays an eliminated player nothing but still banks their read', () => {
    const state = scenario(map, { owner: [0, 1, null], armies: [3, 3, 1] });
    state.status[2] = 'eliminated';
    state.tiersLists = [plainList('a'), plainList('b'), plainList('c')];

    const rules = coopRules(3);
    // Slot 2 is out of the game and reads slot 0 perfectly.
    const outcome = resolveTiers(
      state,
      [undefined, undefined, { list: [], guesses: [{ target: 0, order: [0, 1, 2, 3, 4, 5] }] }],
      { rules, attacked: noAttacks(3), aliveSlots: [0, 1] },
    );

    // The dead player earned points...
    const dead = outcome.results.find((r) => r.slot === 2);
    expect(dead).toBeDefined();
    expect(dead!.incomeDelta).toBeGreaterThan(0);

    // ...which reached the living, and none of which reached them.
    expect(outcome.bonusIncome[2]).toBe(0);
    expect(outcome.bonusIncome[0]).toBeGreaterThan(0);
    // Nothing leaks: every point contributed is a point paid out. Slot 0
    // contributes too, because being read well still pays the author -- it is
    // just the coalition that collects now.
    const contributed = outcome.results.reduce((sum, r) => sum + r.incomeDelta, 0);
    const paid = outcome.bonusIncome.reduce((sum, n) => sum + n, 0);
    expect(paid).toBe(contributed);
    // Nobody fights harder for reading well; the pool pays armies, not odds.
    expect(outcome.multiplier.every((m) => m === 100)).toBe(true);
  });

  it('leaves the eliminated out of the contest entirely in competitive games', () => {
    const state = scenario(map, { owner: [0, 1, null], armies: [3, 3, 1] });
    state.status[2] = 'eliminated';
    state.tiersLists = [plainList('a'), plainList('b'), plainList('c')];

    const rules: RuleConfig = { ...coopRules(3), coop: false, tiersPayout: 'income' };
    const outcome = resolveTiers(
      state,
      [undefined, undefined, { list: [], guesses: [{ target: 0, order: [0, 1, 2, 3, 4, 5] }] }],
      { rules, attacked: noAttacks(3), aliveSlots: [0, 1] },
    );

    expect(outcome.results.some((r) => r.slot === 2)).toBe(false);
    expect(outcome.bonusIncome[2]).toBe(0);
  });
});

describe('storm raiders', () => {
  // Territory 2 alone is the core. Everything else has to appear in some wave:
  // a territory listed in none of them has wave -1 and *is* core, which is how
  // the first draft of this test quietly gave itself two cores.
  const map = makeTestMap({
    playerCount: 2,
    territoryCount: 4,
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
    collapseWaves: [[0], [1], [3]],
  });

  const stormRules = (raiders: number): RuleConfig => ({
    ...coopRules(2),
    stormFirstWave: 1,
    stormInterval: 1,
    stormRaiders: raiders,
  });

  it('reinforces the permanent core, not the burning rim', () => {
    const state = scenario(map, { owner: [0, null, null, 1], armies: [2, 2, 2, 2], turn: 1 });
    const events: WorldEvent[] = [];
    applyStorm(state, map, stormRules(4), events);

    expect(state.collapsed[0]).toBe(true);
    // Territory 1 borders the collapse but burns in a later wave; the core does not.
    expect(state.armies[2]).toBe(6);
    expect(state.armies[1]).toBe(2);
  });

  it('bleeds a held core without ever taking it', () => {
    const state = scenario(map, { owner: [0, null, 1, 1], armies: [2, 2, 3, 2], turn: 1 });
    const events: WorldEvent[] = [];
    applyStorm(state, map, stormRules(4), events);

    // Never captured, never wiped: a player loses their last province to a
    // player, not to the weather.
    expect(state.owner[2]).toBe(1);
    expect(state.armies[2]).toBe(1);
    expect(events.some((e) => e.kind === 'routed')).toBe(true);
  });

  it('does nothing at all when raiders are off', () => {
    const state = scenario(map, { owner: [0, null, null, 1], armies: [2, 2, 2, 2], turn: 1 });
    applyStorm(state, map, { ...stormRules(0) }, []);
    expect(state.armies[2]).toBe(2);
  });
});

describe('survival victory', () => {
  const map = makeTestMap({
    playerCount: 3,
    territoryCount: 4,
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
    collapseWaves: [[0], [3]],
  });

  it('cannot be closed out early, however well the coalition is doing', () => {
    const rules = coopRules(3);
    const state = scenario(map, { owner: [0, 0, 1, 2], armies: [9, 9, 1, 1], turn: 2 });
    expect(checkVictory(state, map, rules)).toBeNull();
  });

  it('ends in survival at the cap, scored by who is left standing', () => {
    const rules = coopRules(3);
    const state = scenario(map, {
      owner: [0, 0, 1, null],
      armies: [3, 3, 3, 0],
      turn: rules.turnCap,
    });
    state.status[2] = 'eliminated';

    const result = checkVictory(state, map, rules);
    expect(result?.kind).toBe('survival');
    expect(result?.winners).toEqual([0, 1]);
    expect(result?.detail).toContain('2 of 3');
    // Everyone is still ranked, so the table still has an argument to have.
    expect(result?.standings).toHaveLength(3);
  });

  it('ends in extinction with no winners when the world takes everyone', () => {
    const rules = coopRules(3);
    const state = scenario(map, { owner: [null, null, null, null], armies: [0, 0, 0, 0], turn: 4 });
    state.status = ['eliminated', 'eliminated', 'eliminated'];

    const result = checkVictory(state, map, rules);
    expect(result?.kind).toBe('extinction');
    expect(result?.winners).toEqual([]);
  });

  it('leaves the competitive routes untouched when coop is off', () => {
    const rules: RuleConfig = { ...coopRules(3), coop: false };
    const state = scenario(map, { owner: [0, 0, 0, 0], armies: [3, 3, 3, 3], turn: 2 });
    state.status[1] = 'eliminated';
    state.status[2] = 'eliminated';

    const result = checkVictory(state, map, rules);
    expect(result?.kind).toBe('conquest');
  });
});


/**
 * The rule that decides who may still submit. It lived as a closure inside
 * resolveTiers while the harness, the server and the client each re-derived it
 * from `status === 'active'`, which is how a scored mechanic ended up with
 * nothing ever feeding it. These assertions are the contract those four now
 * share.
 */
describe('inContest', () => {
  const competitive = rulesFor(3, 8, 'tiers');
  const map = makeTestMap({
    playerCount: 3,
    territoryCount: 3,
    edges: [
      [0, 1],
      [1, 2],
    ],
  });
  const landless = () => {
    const state = scenario(map, { owner: [0, 1, null], armies: [3, 3, 1] });
    state.status[2] = 'eliminated';
    return state;
  };

  it('keeps a landless co-op player in the contest, and out of the army orders', () => {
    const state = landless();

    expect(inContest(state, 2, coopRules(3))).toBe(true);
    expect(commandsArmies(state, 2)).toBe(false);
  });

  it('drops the same player from a competitive game entirely', () => {
    expect(inContest(landless(), 2, competitive)).toBe(false);
  });

  it('lets resignation mean it in both modes', () => {
    const state = landless();
    state.status[2] = 'resigned';

    // A resigned seat that still had to be waited on would stall every
    // remaining turn until the deadline.
    expect(inContest(state, 2, coopRules(3))).toBe(false);
    expect(inContest(state, 2, competitive)).toBe(false);
  });

  it('agrees with itself for a player who still holds ground', () => {
    const state = landless();

    expect(inContest(state, 0, coopRules(3))).toBe(true);
    expect(commandsArmies(state, 0)).toBe(true);
  });
});
