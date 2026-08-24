import { describe, expect, it } from 'vitest';

import { rulesFor } from './constants.js';
import { PRESETS, presetById, presetRules } from './presets.js';

describe('presets', () => {
  it('ships exactly five presets with contest-compatible classic ids', () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      'pact',
      'tiers',
      'pact-blitz',
      'tiers-v2',
      'survival',
    ]);
    expect(presetById('nope')).toBeNull();
  });

  it('classic presets are the classic contests plus the anti-turtle economy', () => {
    const pact = presetById('pact')!;
    expect(pact.defaultTurnCap).toBe(10);
    expect(pact.defaultTurnMinutes).toBe(1440);
    expect(presetRules(pact, 6, 10)).toEqual({
      ...rulesFor(6, 10, 'pact'),
      neutralGrowthInterval: 0,
      neutralGarrisonDelta: -1,
      plunderIncome: 1,
      plunderCap: 3,
    });
    expect(presetById('tiers')!.contest).toBe('tiers');
    expect(presetById('tiers')!.tiersPayout).toBe('multiplier');
  });

  it('blitz presets run short, hot games', () => {
    for (const id of ['pact-blitz', 'tiers-v2'] as const) {
      const preset = presetById(id)!;
      expect(preset.defaultTurnCap).toBe(8);
      expect(preset.defaultTurnMinutes).toBe(60);
      const rules = presetRules(preset, 6, preset.defaultTurnCap);
      expect(rules.warEconomyInterval).toBe(3);
      // Pulled earlier than the pace fraction alone would put it, so all six
      // collapse waves land inside an 8-turn game: 3,4,5,6,7,8.
      expect(rules.stormFirstWave).toBe(3);
      expect(rules.stormFirstWave + 5 * rules.stormInterval).toBeLessThanOrEqual(
        preset.defaultTurnCap,
      );
      // Hotter than the classics on purpose: a short clock needs the economy
      // to reward taking ground, or the cap decides the game instead of a win.
      expect(rules.neutralGarrisonDelta).toBe(-2);
      expect(rules.plunderIncome).toBe(2);
    }
  });

  it('survival is the cooperative preset', () => {
    const preset = presetById('survival')!;
    const rules = presetRules(preset, 5, preset.defaultTurnCap);
    expect(rules.coop).toBe(true);
    expect(rules.contest).toBe('tiers');
    expect(rules.tiersPayout).toBe('pooled');
    expect(rules.stormRaiders).toBeGreaterThan(0);
    // The storm has to finish inside the game, or "outlast it" cannot be won.
    expect(rules.stormFirstWave + 5 * rules.stormInterval).toBeLessThanOrEqual(
      preset.defaultTurnCap,
    );
  });

  it('every preset targets a short game', () => {
    for (const preset of PRESETS) {
      expect(preset.defaultTurnCap).toBeGreaterThanOrEqual(5);
      expect(preset.defaultTurnCap).toBeLessThanOrEqual(10);
    }
  });

  it('tiers v2 pays income', () => {
    const rules = presetRules(presetById('tiers-v2')!, 4, 8);
    expect(rules.contest).toBe('tiers');
    expect(rules.tiersPayout).toBe('income');
  });
});
