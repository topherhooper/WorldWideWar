/**
 * The tuning surface of the game.
 *
 * Everything here is a number we expect to change from simulation data rather
 * than intuition. The balance harness (`pnpm sim`) gates on seat fairness, game
 * length, betrayal rate and shared-win rate; when a gate fails, the fix is
 * almost always in this file.
 */

import type { ContestKind, PactOutcome, RuleConfig } from './types.js';

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

/** Creation-time bounds on the configurable game length. */
// Five, not ten. The game is played once or twice a day in a group chat, so a
// 25-turn match is a month of real time and the table loses the thread long
// before the storm does. Short games are the format, not a variant of it.
export const MIN_TURN_CAP = 5;
export const MAX_TURN_CAP = 50;

export const DEFAULT_RULES: RuleConfig = {
  contest: 'pact',
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
  // Hold half the surviving regions *outright* for two turns running, and never
  // fewer than three regions whatever the share works out to.
  //
  // The floor is the important half. Measured at a third with no floor, this
  // ended 70-90% of games and swallowed every other route: the bar is a share
  // of *surviving* regions, so as the storm burns the world it collapses on its
  // own — late on, three live regions meant holding one region won the game.
  hegemonyShare: 0.5,
  hegemonyMinimum: 3,
  // Hegemony is a mid-game condition and switches off once the storm has eaten
  // the map. Without this it becomes the default ending on larger tables — 51%
  // of eight-player games — because three whole regions out of the five that
  // survive to the endgame is far easier than holding half the territory.
  // Building an empire should win; mopping up a burnt world should not.
  hegemonyMinRegionsAlive: 6,
  // The region *count* alone is too coarse a dial to balance: region totals are
  // fixed per map, so ceil(regions x share) jumps between whole numbers and
  // there is no value between "hegemony never fires" and "hegemony ends 64% of
  // games". Requiring the held regions to cover a share of the surviving
  // territory gives a continuous knob, and it is the more honest requirement
  // anyway — a hegemon should visibly control the map, not just collect three
  // small regions in a quiet corner.
  hegemonyTerritoryShare: 0.45,
  hegemonyStreak: 2,
  // Your own founding capital plus more than half of everyone else's. Solo and
  // aggressive, but surgical rather than a land grab — it gives raiders a
  // target list and makes capitals landmarks worth garrisoning.
  decapitationShare: 0.5,
  // Capitals must be *held*, not merely touched. Without this the condition
  // fires on a snapshot: at four players it ended a third of all games and
  // dragged the median down to 12 turns with a tenth finishing by turn 7.
  // Requiring a turn of holding gives the table a round to take one back.
  decapitationStreak: 2,
  // A three-way concordat: every pair must have cooperated within this many
  // turns. You may only pledge one player per turn, so closing a triangle means
  // rotating pledges — which costs you the unbroken streak a condominium needs.
  // That tension is the point: the two shared victories pull in opposite
  // directions and you must commit to one.
  concordatWindow: 5,
  concordatShare: 0.75,
  stormFirstWave: 10,
  stormInterval: 2,
  eventInterval: 3,
  // The war economy ramps: +1 income every N turns, for everyone.
  warEconomyInterval: 5,
  // Neutral garrisons grow every N turns, so unclaimed land does not stay free.
  neutralGrowthInterval: 3,
  neutralGarrisonDelta: 0,
  plunderIncome: 0,
  plunderCap: 3,
  tiersPayout: 'multiplier',
  // Competitive by default. Both fields exist so the stored-rules merge in the
  // server backfills every game created before cooperative mode with the
  // behaviour it has always had.
  coop: false,
  stormRaiders: 0,
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
 * Players required before a three-way concordat is possible.
 *
 * Same principle as the duel rule: a shared victory must exclude somebody, or
 * it is just a draw wearing a different name.
 */
export const MIN_CONCORDAT_PLAYERS = 4;

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
/** Mapgen caps radial collapse at six waves; the schedule has to assume them. */
const MAX_COLLAPSE_WAVES = 6;

function stormIntervalFor(playerCount: number, turnCap: number): number {
  return playerCount <= 6 ? (turnCap <= 15 ? 1 : 2) : 1;
}

/**
 * When the first wave lands.
 *
 * The fraction sets the pace, but the schedule is then pulled earlier if the
 * last wave would fall outside the game. That clamp is what makes short caps
 * viable: at a cap of 8 the unclamped fraction starts the storm on turn 4 and
 * the final two waves never fire, which leaves the map half-burnt at the end
 * and makes a cooperative "outlast the storm" unwinnable by construction.
 *
 * It is inert at the caps that existed before short games: 25 turns still
 * starts on 10 and 15 still starts on 6.
 */
function stormFirstWaveFor(turnCap: number, fraction: number, interval: number): number {
  const byPace = Math.max(4, Math.round(turnCap * fraction));
  const latestStart = turnCap - (MAX_COLLAPSE_WAVES - 1) * interval;
  return Math.max(2, Math.min(byPace, latestStart));
}

export function rulesFor(
  playerCount: number,
  turnCap: number = DEFAULT_RULES.turnCap,
  contest: ContestKind = 'pact',
): RuleConfig {
  // Same per-table-size fraction that produced the tuned 10/9/6 first waves at
  // the default cap of 25; the cap now just stretches or compresses the clock.
  const firstWaveFraction = playerCount <= 6 ? 0.4 : playerCount <= 9 ? 0.36 : 0.24;
  return {
    ...DEFAULT_RULES,
    contest,
    turnCap,
    // Raised across the board now that hegemony, decapitation and the concordat
    // exist. At the old values domination ended ~70% of games and the other
    // routes were decorative; a higher bar makes each of them a real plan
    // rather than a consolation prize.
    dominationShare:
      playerCount <= 4 ? 0.65 : playerCount <= 6 ? 0.6 : playerCount <= 9 ? 0.55 : 0.5,
    // Scales down with the table for the same reason domination does. Region
    // count grows with player count (roughly 2P+1), so a fixed share becomes
    // unreachable: half of twenty-five regions is not a strategy, and hegemony
    // simply stopped existing above six players.
    hegemonyShare: playerCount <= 4 ? 0.5 : playerCount <= 6 ? 0.45 : playerCount <= 9 ? 0.4 : 0.45,
    stormFirstWave: stormFirstWaveFor(
      turnCap,
      firstWaveFraction,
      stormIntervalFor(playerCount, turnCap),
    ),
    stormInterval: stormIntervalFor(playerCount, turnCap),
    // "Recent cooperation" must never mean a third of the game ago.
    concordatWindow: Math.min(5, Math.max(2, Math.round(turnCap / 3))),
  };
}

/** Territory count scales with player count: T = 6P + 6. */
export function territoryTarget(playerCount: number): number {
  return 6 * playerCount + 6;
}

export function regionTarget(territoryCount: number): number {
  return Math.ceil(territoryCount / 5);
}
