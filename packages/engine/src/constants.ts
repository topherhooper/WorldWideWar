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
  // 0.55, not the 0.7 this started at. Measured: by the time the storm has
  // finished there are only `players + 1` territories left, and 70% of seven
  // rounds to five — a bar three surviving players essentially never clear. The
  // result was 46% of games ending on points at the turn cap with a median
  // length of 23. At 0.55 the same games end in a decisive domination 72% of
  // the time with a median of 19. Note 0.6, 0.65 and 0.7 all behave
  // identically on a seven-territory endgame; they round to the same integer.
  dominationShare: 0.55,
  // A pair must hold more ground together than a solo winner needs alone, and
  // the solo check runs first — so nobody ever settles for sharing a win they
  // could have taken outright. The real cost is not territory but the three
  // unbroken turns of mutual concord it takes to qualify: one pledge per turn,
  // and betrayal pays the best single-turn payoff in the game.
  //
  // Measured at 0.85 this fired in 2 games out of 800 once solo domination
  // dropped to 0.55, which is not a feature so much as a rumour. At 0.65 it
  // lands around 5% of games — rare enough to feel like an event, common enough
  // to be worth playing for.
  condominiumShare: 0.65,
  condominiumStreak: 3,
  stormFirstWave: 10,
  stormInterval: 2,
  eventInterval: 3,
};

/**
 * Minimum players for a shared victory.
 *
 * A two-player condominium is not a shared win, it is a draw — and the design
 * promises no draws. In a duel the only honest endings are conquest, domination
 * and the turn cap.
 */
export const MIN_CONDOMINIUM_PLAYERS = 3;

/**
 * Rules scaled to table size.
 *
 * A single fixed rule set cannot serve both a duel and a twelve-player brawl.
 * Tuned for 6 players, the same numbers gave 2-player games that ended in 6
 * turns and 12-player games where 83% ran out the clock, because reaching a
 * fixed share of the map gets steadily harder as the table grows: the storm
 * floors at `players + 1` territories, so at twelve players the endgame is
 * thirteen provinces split between everyone still standing.
 *
 * So the domination bar falls and the storm bites earlier as players are added.
 * All values below come from the balance harness, not from intuition.
 */
export function rulesFor(playerCount: number): RuleConfig {
  return {
    ...DEFAULT_RULES,
    dominationShare:
      playerCount <= 3 ? 0.7 : playerCount <= 6 ? 0.55 : playerCount <= 9 ? 0.48 : 0.45,
    stormFirstWave: playerCount <= 6 ? 10 : playerCount <= 9 ? 9 : 6,
    stormInterval: playerCount <= 6 ? 2 : 1,
  };
}

/** Territory count scales with player count: T = 6P + 6. */
export function territoryTarget(playerCount: number): number {
  return 6 * playerCount + 6;
}

export function regionTarget(territoryCount: number): number {
  return Math.ceil(territoryCount / 5);
}
