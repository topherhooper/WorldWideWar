import { describe, expect, it } from 'vitest';

import { rulesFor } from './constants.js';
import { PRESETS, presetById, presetRules } from './presets.js';

describe('presets', () => {
  it('ships exactly four presets with contest-compatible classic ids', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['pact', 'tiers', 'pact-blitz', 'tiers-v2']);
    expect(presetById('nope')).toBeNull();
  });

  it('classic presets are the classic contests plus the anti-turtle economy', () => {
    const pact = presetById('pact')!;
    expect(pact.defaultTurnCap).toBe(25);
    expect(pact.defaultTurnMinutes).toBe(1440);
    expect(presetRules(pact, 6, 25)).toEqual({
      ...rulesFor(6, 25, 'pact'),
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
      expect(preset.defaultTurnCap).toBe(15);
      expect(preset.defaultTurnMinutes).toBe(60);
      const rules = presetRules(preset, 6, preset.defaultTurnCap);
      expect(rules.warEconomyInterval).toBe(3);
      expect(rules.stormFirstWave).toBe(6); // rulesFor already scales storm to the cap
    }
  });

  it('tiers v2 pays income', () => {
    const rules = presetRules(presetById('tiers-v2')!, 4, 15);
    expect(rules.contest).toBe('tiers');
    expect(rules.tiersPayout).toBe('income');
  });
});
