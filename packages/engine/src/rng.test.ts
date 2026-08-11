import { describe, expect, it } from 'vitest';
import { makeRng, substream } from './rng.js';

describe('makeRng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng('seed-1');
    const b = makeRng('seed-1');
    const draw = (r: ReturnType<typeof makeRng>) => Array.from({ length: 64 }, () => r.u32());
    expect(draw(a)).toEqual(draw(b));
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 16 }, () => makeRng('seed-1').u32());
    const b = Array.from({ length: 16 }, () => makeRng('seed-2').u32());
    expect(a).not.toEqual(b);
  });

  it('keeps int() within bounds', () => {
    const rng = makeRng('bounds');
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it('rejects a non-positive int() bound', () => {
    const rng = makeRng('bad-bound');
    expect(() => rng.int(0)).toThrow();
    expect(() => rng.int(-3)).toThrow();
    expect(() => rng.int(2.5)).toThrow();
  });

  it('distributes d6 within tolerance', () => {
    // Combat leans on d6 being fair; a biased die would surface as seat
    // unfairness across the thousands of games the balance harness runs.
    const rng = makeRng('dice');
    const counts = new Array<number>(7).fill(0);
    const rolls = 60_000;
    for (let i = 0; i < rolls; i++) counts[rng.d6()]++;

    for (let face = 1; face <= 6; face++) {
      const share = counts[face] / rolls;
      expect(share).toBeGreaterThan(0.157);
      expect(share).toBeLessThan(0.176);
    }
  });

  it('shuffles without mutating the input', () => {
    const rng = makeRng('shuffle');
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle(source);
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shuffled.slice().sort((a, b) => a - b)).toEqual(source);
  });

  it('throws when picking from nothing', () => {
    expect(() => makeRng('empty').pick([])).toThrow();
  });
});

describe('substream', () => {
  it('separates subsystems so one can change without disturbing another', () => {
    const combat = substream('game-seed', 4, 'combat');
    const tiebreak = substream('game-seed', 4, 'tiebreak');
    expect(Array.from({ length: 8 }, () => combat.u32())).not.toEqual(
      Array.from({ length: 8 }, () => tiebreak.u32()),
    );
  });

  it('separates turns', () => {
    const t4 = substream('game-seed', 4, 'combat');
    const t5 = substream('game-seed', 5, 'combat');
    expect(t4.u32()).not.toBe(t5.u32());
  });

  it('cannot collide on ambiguous numeric parts', () => {
    // Without a separator, (1, 23) and (12, 3) would both spell "123".
    const a = substream('s', 1, 23);
    const b = substream('s', 12, 3);
    expect(a.u32()).not.toBe(b.u32());
  });

  it('is reproducible', () => {
    expect(substream('s', 7, 'bot', 2).u32()).toBe(substream('s', 7, 'bot', 2).u32());
  });
});
