import { describe, expect, it } from 'vitest';
import { checkRun, extendsScored, scoreForeclosesWin } from './rules.js';
import type { Card } from './cards.js';
import type { SacrePlayer, SacreState } from './types.js';

const c = (rank: number | null, suit: 'C' | 'D' | 'H' | 'S' | null): Card => ({
  id: `${rank ?? 'J0'}${suit ?? 'X'}`,
  suit,
  rank,
});

describe('checkRun', () => {
  it('scores the rules sheet examples', () => {
    expect(checkRun([c(5, 'C'), c(6, 'C'), c(7, 'C')]).points).toBe(18);
    // The Ace loops round to 2.
    const long = [9, 10, 11, 12, 13, 14, 2].map((r) => c(r, 'S'));
    expect(checkRun(long).points).toBe(61);
  });

  it('lets a Joker stand in at zero points', () => {
    // Joker as the Queen of clubs, then K, A = 20.
    expect(checkRun([c(null, null), c(13, 'C'), c(14, 'C')]).points).toBe(20);
  });

  it('places a leading Joker at the rank the position implies', () => {
    const run = checkRun([c(null, null), c(6, 'H'), c(7, 'H')]);
    expect(run.ok).toBe(true);
    expect(run.ranks).toEqual([5, 6, 7]);
  });

  it('refuses what is not a sequence', () => {
    expect(checkRun([c(5, 'C'), c(6, 'C')]).ok).toBe(false);
    expect(checkRun([c(5, 'C'), c(6, 'H'), c(7, 'C')]).ok).toBe(false);
    expect(checkRun([c(5, 'C'), c(7, 'C'), c(8, 'C')]).ok).toBe(false);
    expect(checkRun([c(null, null), c(null, null), c(null, null)]).ok).toBe(false);
  });

  it('will not let a run loop past itself', () => {
    const all = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((r) => c(r, 'D'));
    expect(checkRun(all).ok).toBe(true);
    expect(checkRun([...all, c(2, 'D')]).ok).toBe(false);
  });
});

const player = (scored: SacrePlayer['scored']): SacrePlayer => ({
  slot: 0,
  hand: [],
  score: 0,
  out: false,
  scored,
});

describe('extending an already scored set', () => {
  it('refuses a run that butts up against one you laid down', () => {
    const p = player([{ suit: 'C', ranks: [5, 6, 7], points: 18 }]);
    // 8-9-10 continues 5-6-7 at the top.
    expect(extendsScored(p, 'C', [8, 9, 10])).toBe(true);
    // 2-3-4 continues it at the bottom.
    expect(extendsScored(p, 'C', [2, 3, 4])).toBe(true);
  });

  it('allows a second, detached run in the same suit', () => {
    const p = player([{ suit: 'C', ranks: [5, 6, 7], points: 18 }]);
    // A gap at 8 means this is a new set, not an extension -- and the deck's
    // own advice is to commit to a suit, so the wide reading cannot be right.
    expect(extendsScored(p, 'C', [9, 10, 11])).toBe(false);
    expect(extendsScored(p, 'H', [8, 9, 10])).toBe(false);
  });
});

const stateWith = (mine: number, hand: number, leader: number): SacreState =>
  ({
    players: [
      {
        slot: 0,
        hand: Array.from({ length: hand }, (_, i) => c(i + 2, 'C')),
        score: mine,
        out: false,
        scored: [],
      },
      { slot: 1, hand: [], score: leader, out: false, scored: [] },
    ],
  }) as unknown as SacreState;

describe('a Score that forecloses winning', () => {
  it('is refused when it ends your game behind', () => {
    // Trailing by 10, dumping your last 3 cards for 9. The document's example.
    expect(scoreForeclosesWin(stateWith(0, 3, 10), 0, 3, 9)).toBe(true);
  });

  it('is allowed when it ends your game in front', () => {
    expect(scoreForeclosesWin(stateWith(0, 3, 10), 0, 3, 11)).toBe(false);
  });

  it('never binds while you still have a hand to play', () => {
    expect(scoreForeclosesWin(stateWith(0, 9, 100), 0, 3, 9)).toBe(false);
  });
});
