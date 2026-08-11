/**
 * Combat maths.
 *
 *   power = effectiveStrength × contestMultiplier × diceNudge
 *
 * The contest can swing 1.75× (0.80 → 1.40) while the dice swing only 1.27×, so
 * the pact dominates without making any fight a foregone conclusion. A concord
 * against a spurned opponent at equal armies is a 1.59× edge — strong, but the
 * underdog still steals it often enough that nobody feels the result was
 * decided before the turn began.
 *
 * All integer: effective strength is a whole army count, the multiplier and the
 * nudge are both ×100, so power carries a ×10,000 scale and never touches a
 * float. Determinism depends on it.
 */

import { DICE_NUDGE, SCALE } from './constants.js';
import type { Rng } from './rng.js';

export const POWER_SCALE = SCALE * SCALE;

export function computePower(effective: number, multiplier: number, roll: number): number {
  return effective * multiplier * DICE_NUDGE[roll];
}

/**
 * Casualties taken by the winner of a battle: half the losing effective
 * strength, rounded up, but always leaving at least one army standing.
 *
 * The cost scales with everything that was thrown at you, which is what makes a
 * multi-way melee genuinely punishing — winning a three-way fight of 4 v 3 v 3
 * leaves you holding the ground with one army and anyone nearby can take it.
 */
export function winnerCasualties(winnerArmies: number, losingEffective: number): number {
  return Math.min(Math.ceil(losingEffective / 2), Math.max(0, winnerArmies - 1));
}

/** A beaten attacking stack limps home at a third strength. */
export function retreatSurvivors(committed: number): number {
  return Math.floor(committed / 3);
}

/**
 * Splits `total` survivors across stacks in proportion to what each committed,
 * using largest-remainder so the parts always sum to exactly `total`.
 *
 * Ties break toward the larger stack, then the lower index, so the split is
 * canonical rather than dependent on sort stability.
 */
export function splitProportionally(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (w * total) / sum);
  const out = exact.map((v) => Math.floor(v));
  let remaining = total - out.reduce((acc, v) => acc + v, 0);

  const order = weights
    .map((weight, index) => ({ index, weight, remainder: exact[index] - out[index] }))
    .sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.index - b.index);

  for (let i = 0; i < order.length && remaining > 0; i++) {
    out[order[i].index]++;
    remaining--;
  }
  return out;
}

export interface OddsSide {
  effective: number;
  multiplier: number;
  isDefender?: boolean;
}

/**
 * Win probability per side.
 *
 * Enumerated exactly for up to six sides (6^6 = 46,656 outcomes, trivial), and
 * estimated by seeded sampling beyond that. Used by the client to show honest
 * odds — including the fact that an opponent's multiplier is unknown at commit
 * time, which the caller expresses by asking for a range across their possible
 * pact outcomes.
 */
export function battleOdds(sides: readonly OddsSide[], rng?: Rng): number[] {
  const n = sides.length;
  if (n === 0) return [];
  if (n === 1) return [1];

  const wins = new Array<number>(n).fill(0);

  if (n <= 6) {
    const total = 6 ** n;
    const rolls = new Array<number>(n).fill(1);

    for (let i = 0; i < total; i++) {
      let carry = i;
      for (let s = 0; s < n; s++) {
        rolls[s] = (carry % 6) + 1;
        carry = Math.floor(carry / 6);
      }
      awardWin(sides, rolls, wins, 1);
    }
    return wins.map((w) => w / total);
  }

  const samples = 20_000;
  const source = rng;
  if (!source) throw new Error('battleOdds needs an Rng for more than six sides');
  const rolls = new Array<number>(n).fill(1);
  for (let i = 0; i < samples; i++) {
    for (let s = 0; s < n; s++) rolls[s] = source.d6();
    awardWin(sides, rolls, wins, 1);
  }
  return wins.map((w) => w / samples);
}

function awardWin(
  sides: readonly OddsSide[],
  rolls: readonly number[],
  wins: number[],
  weight: number,
): void {
  let best = -1;
  const tied: number[] = [];

  for (let s = 0; s < sides.length; s++) {
    const power = computePower(sides[s].effective, sides[s].multiplier, rolls[s]);
    if (power > best) {
      best = power;
      tied.length = 0;
      tied.push(s);
    } else if (power === best) {
      tied.push(s);
    }
  }

  // Ties go to the defender; with no defender among them it is a coin flip, so
  // the tied sides share the outcome evenly.
  const defender = tied.find((s) => sides[s].isDefender);
  if (defender !== undefined) {
    wins[defender] += weight;
    return;
  }
  for (const s of tied) wins[s] += weight / tied.length;
}
