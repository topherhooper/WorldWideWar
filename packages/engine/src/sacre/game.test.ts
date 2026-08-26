import { describe, expect, it } from 'vitest';
import { bestRun, cardName } from './cards.js';
import { playSacreGame } from './game.js';

describe('sacre prototype', () => {
  it('plays the same game twice from the same seed', () => {
    const a = playSacreGame('s1', 4);
    const b = playSacreGame('s1', 4);
    expect(a.lines).toEqual(b.lines);
    expect(a.scores).toEqual(b.scores);
  });

  it('scores the Ace loop the way the rules sheet does', () => {
    // 9, 10, J, Q, K, A, 2 of spades = 61, straight from the document.
    const hand = [9, 10, 11, 12, 13, 14, 2].map((rank) => ({
      id: `${rank}S`,
      suit: 'S' as const,
      rank,
    }));
    const run = bestRun(hand);
    expect(run?.points).toBe(61);
    expect(run?.cards.map(cardName)).toEqual(['9S', '10S', 'JS', 'QS', 'KS', 'AS', '2S']);
  });

  it('scores a joker at zero', () => {
    // Joker (as QC), KC, AC = 20, also from the document.
    const run = bestRun([
      { id: 'JOKER1', suit: null, rank: null },
      { id: '13C', suit: 'C' as const, rank: 13 },
      { id: '14C', suit: 'C' as const, rank: 14 },
    ]);
    expect(run?.points).toBe(20);
  });
});
