/**
 * The tuning surface of the game.
 *
 * Everything here is a number we expect to change from simulation data rather
 * than intuition. The balance harness (`pnpm sim`) gates on seat fairness, game
 * length, betrayal rate and shared-win rate; when a gate fails, the fix is
 * almost always in this file.
 */

import type { PactOutcome, RuleConfig } from './types.js';

/** Multipliers are stored ×100 so combat resolution stays in integer math. */
export const SCALE = 100;

/**
 * The pact payoff matrix — the most important numbers in the game.
 *
 * Betrayal pays best, which is what makes the dilemma real rather than a
 * formality. It is survivable only because the betrayal is named publicly and
 * remembered permanently: across a 25-turn game, a known backstabber finds
 * nobody will pledge to them and sits near 1.00 while everyone else runs 1.35
 * pairs. That punishment is emergent, not coded.
 */
export const PACT_MULTIPLIER: Record<PactOutcome, number> = {
  betrayal: 140,
  concord: 135,
  mutual_treachery: 100,
  abstain: 100,
  courted: 100,
  spurned: 85,
  betrayed: 80,
};

/** Extra income for being pledged to by someone you did not pledge back. */
export const COURTED_INCOME_BONUS = 1;

/**
 * The residual dice nudge, indexed by d6 roll, ×100.
 *
 * Spread is deliberately narrow (~±12%) next to the pact's 1.75× swing: luck
 * should be able to steal a close fight, never decide a lopsided one. Mean is
 * exactly 1.00 so dice add variance without favouring attacker or defender.
 */
export const DICE_NUDGE = [0, 88, 94, 98, 102, 106, 112] as const;

/** A capital defends harder, but only while someone is actually standing in it. */
export const CAPITAL_DEFENCE_BONUS = 2;

/** Starting garrisons. */
export const CAPITAL_START_ARMIES = 5;
export const TERRITORY_START_ARMIES = 3;

/** Income formula terms. */
export const BASE_INCOME = 3;
export const TERRITORIES_PER_INCOME = 3;
export const CAPTURED_CAPITAL_INCOME = 1;
/** The war economy ramps: +1 income every N turns, for everyone. */
export const WAR_ECONOMY_INTERVAL = 5;

/** Neutral garrisons grow every N turns, so unclaimed land does not stay free. */
export const NEUTRAL_GROWTH_INTERVAL = 3;

export const DEFAULT_RULES: RuleConfig = {
  turnCap: 25,
  dominationShare: 0.7,
  // Deliberately harder than a solo win: a condominium should be the fallback
  // when neither partner can finish the other before the storm closes, not
  // something a table can comfortably coast into.
  condominiumShare: 0.85,
  condominiumStreak: 3,
  stormFirstWave: 10,
  stormInterval: 2,
  eventInterval: 3,
};

/** Territory count scales with player count: T = 6P + 6. */
export function territoryTarget(playerCount: number): number {
  return 6 * playerCount + 6;
}

export function regionTarget(territoryCount: number): number {
  return Math.ceil(territoryCount / 5);
}
