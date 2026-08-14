import { describe, expect, it } from 'vitest';

import { DEFAULT_RULES } from './constants.js';
import { createInitialState } from './setup.js';
import { lineMap } from './testing.js';

function mapWithNeutrals() {
  const map = lineMap(6, 2);
  map.starts = [
    { slot: 0, capital: 0, extra: [] },
    { slot: 1, capital: 5, extra: [] },
  ];
  map.neutralGarrisons = { 1: 2, 2: 3, 3: 4 };
  return map;
}

describe('neutral garrison delta', () => {
  it('applies the delta with a floor of 1', () => {
    const state = createInitialState(mapWithNeutrals(), {
      ...DEFAULT_RULES,
      neutralGarrisonDelta: -2,
    });
    expect(state.armies[1]).toBe(1); // 2 - 2 floored at 1
    expect(state.armies[2]).toBe(1); // 3 - 2
    expect(state.armies[3]).toBe(2); // 4 - 2
  });

  it('legacy delta 0 seeds garrisons exactly as generated', () => {
    const state = createInitialState(mapWithNeutrals(), DEFAULT_RULES);
    expect([state.armies[1], state.armies[2], state.armies[3]]).toEqual([2, 3, 4]);
  });
});
