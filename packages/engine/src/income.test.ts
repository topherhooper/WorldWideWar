import { describe, expect, it } from 'vitest';

import { DEFAULT_RULES } from './constants.js';
import { computeIncome } from './income.js';
import { lineMap, scenario } from './testing.js';

describe('rules-driven war economy', () => {
  it('ramp interval comes from the rules, not a constant', () => {
    const map = lineMap(4, 2);
    const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3], turn: 6 });
    const legacy = computeIncome(state, map, 0, DEFAULT_RULES); // floor(6/5) = 1 ramp
    const fast = computeIncome(state, map, 0, { ...DEFAULT_RULES, warEconomyInterval: 3 }); // floor(6/3) = 2
    expect(fast - legacy).toBe(1);
  });
});
