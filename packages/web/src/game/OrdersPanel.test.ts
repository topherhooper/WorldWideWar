import { describe, expect, it } from 'vitest';

import { parseMoveCount } from './OrdersPanel.js';

describe('parseMoveCount', () => {
  it('lets the field be cleared — empty stays empty instead of snapping to 1', () => {
    // The regression: Math.max(1, Number('')) === 1 made the "1" undeletable,
    // so typing a digit appended to it and only 1 or >= 10 was reachable.
    expect(parseMoveCount('')).toBe('');
    expect(parseMoveCount('  ')).toBe('');
  });

  it('parses counts and clamps the floor to one army', () => {
    expect(parseMoveCount('5')).toBe(5);
    expect(parseMoveCount('0')).toBe(1);
    expect(parseMoveCount('-3')).toBe(1);
  });

  it('floors decimals and rejects garbage', () => {
    expect(parseMoveCount('2.7')).toBe(2);
    expect(parseMoveCount('abc')).toBe('');
  });
});
