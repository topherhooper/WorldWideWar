import { describe, expect, it } from 'vitest';

import { rulesFor } from './constants.js';
import { playBotGame } from './simulate.js';

describe('bot games under the tiers contest', () => {
  it('terminate, score reads, and never touch pact state', () => {
    for (const playerCount of [2, 4, 6]) {
      const summary = playBotGame({
        seed: `tiers-${playerCount}`,
        playerCount,
        rules: rulesFor(playerCount, 25, 'tiers'),
        keepHistory: true,
      });
      expect(summary.result.kind).not.toBe('condominium');
      expect(summary.result.kind).not.toBe('concordat');
      expect(summary.turns).toBeLessThanOrEqual(25);
      const reports = summary.history ?? [];
      expect(reports.length).toBeGreaterThan(0);
      // Turn 1 already scores: lobby lists exist, bots guess from the start.
      const scored = reports[0].tiers.flatMap((r) => r.guesses);
      expect(scored.length).toBeGreaterThan(0);
      // Popularity-order bots read each other well: multipliers actually move.
      const multipliers = reports.flatMap((r) => r.tiers.map((t) => t.multiplier));
      expect(multipliers.some((m) => m !== 100)).toBe(true);
      expect(Math.min(...multipliers)).toBeGreaterThanOrEqual(80);
      expect(Math.max(...multipliers)).toBeLessThanOrEqual(140);
      expect(summary.finalState.pactsHonored.every((n) => n === 0)).toBe(true);
    }
  });

  it('short-cap tiers games still end decisively or on standings', () => {
    const summary = playBotGame({
      seed: 'tiers-short',
      playerCount: 4,
      rules: rulesFor(4, 15, 'tiers'),
    });
    expect(summary.turns).toBeLessThanOrEqual(15);
    expect(summary.result.winners.length).toBeGreaterThan(0);
  });
});
