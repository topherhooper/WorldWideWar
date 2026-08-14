import { describe, expect, it } from 'vitest';

import { DEFAULT_RULES, MAX_TURN_CAP, MIN_TURN_CAP, rulesFor } from './constants.js';

describe('rulesFor with a turn cap', () => {
  it('defaults reproduce the tuned values exactly', () => {
    for (const playerCount of [2, 4, 6, 8, 10, 12]) {
      const rules = rulesFor(playerCount);
      expect(rules.turnCap).toBe(25);
      expect(rules.contest).toBe('pact');
      expect(rules.stormFirstWave).toBe(playerCount <= 6 ? 10 : playerCount <= 9 ? 9 : 6);
      expect(rules.stormInterval).toBe(playerCount <= 6 ? 2 : 1);
      expect(rules.concordatWindow).toBe(5);
    }
  });

  it('scales the storm schedule with the cap', () => {
    const short = rulesFor(4, 15);
    expect(short.turnCap).toBe(15);
    expect(short.stormFirstWave).toBe(6); // round(15 * 0.4)
    expect(short.stormInterval).toBe(1); // short games tighten the interval
    const long = rulesFor(4, 35);
    expect(long.stormFirstWave).toBe(14);
    expect(long.stormInterval).toBe(2);
  });

  it('keeps a floor on the first wave and scales the concordat window', () => {
    expect(rulesFor(12, 10).stormFirstWave).toBeGreaterThanOrEqual(4);
    expect(rulesFor(4, 10).concordatWindow).toBe(3); // round(10 / 3)
    expect(rulesFor(4, 50).concordatWindow).toBe(5); // never above today's 5
    expect(rulesFor(4, 10).concordatWindow).toBeGreaterThanOrEqual(2);
  });

  it('streak requirements are cap-independent', () => {
    const short = rulesFor(4, 10);
    expect(short.hegemonyStreak).toBe(DEFAULT_RULES.hegemonyStreak);
    expect(short.decapitationStreak).toBe(DEFAULT_RULES.decapitationStreak);
    expect(short.condominiumStreak).toBe(DEFAULT_RULES.condominiumStreak);
  });

  it('carries the contest kind', () => {
    expect(rulesFor(4, 25, 'tiers').contest).toBe('tiers');
    expect(MIN_TURN_CAP).toBe(10);
    expect(MAX_TURN_CAP).toBe(50);
  });
});

describe('economy and payout rule fields', () => {
  it('legacy defaults reproduce the old constants exactly', () => {
    expect(DEFAULT_RULES.warEconomyInterval).toBe(5);
    expect(DEFAULT_RULES.neutralGrowthInterval).toBe(3);
    expect(DEFAULT_RULES.neutralGarrisonDelta).toBe(0);
    expect(DEFAULT_RULES.plunderIncome).toBe(0);
    expect(DEFAULT_RULES.plunderCap).toBe(3);
    expect(DEFAULT_RULES.tiersPayout).toBe('multiplier');
  });

  it('rulesFor passes the legacy defaults through untouched', () => {
    const rules = rulesFor(6, 25, 'tiers');
    expect(rules.warEconomyInterval).toBe(5);
    expect(rules.neutralGrowthInterval).toBe(3);
    expect(rules.neutralGarrisonDelta).toBe(0);
    expect(rules.plunderIncome).toBe(0);
    expect(rules.tiersPayout).toBe('multiplier');
  });
});
