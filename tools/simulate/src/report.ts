/**
 * Aggregate statistics and the gates that turn them into a pass/fail.
 *
 * These are the numbers the design lives or dies on. Seat fairness and game
 * length say whether it is a fair, fast game; betrayal rate and shared-win rate
 * say whether the social layer has any teeth. All four are checkable in CI,
 * which is the point — they are how the pact multipliers get tuned from data
 * rather than from intuition.
 */

import type { GameSummary, PactOutcome } from '@www/engine';

export interface Aggregate {
  /** Share of games taken by the single most common ending route. */
  dominantRouteShare: number;
  /** Ending routes that account for at least 5% of games. */
  liveRoutes: number;
  games: number;
  playerCount: number;
  /** Share of wins per seat; uniform is 1/playerCount. */
  winRateBySeat: number[];
  seatDeviation: number;
  turnsMedian: number;
  turnsMean: number;
  turnsP10: number;
  turnsP90: number;
  endings: Record<string, number>;
  pactOutcomes: Record<PactOutcome, number>;
  /** Betrayals as a share of all mutual pacts formed. */
  betrayalRate: number;
  /** Mutual pacts as a share of all pledges made. */
  reciprocationRate: number;
  sharedWinRate: number;
  firstBloodMedian: number;
  /** Largest share of the map any one player ever held, averaged. */
  snowballIndex: number;
  /** Cooperative runs only: mean players left standing at the end. */
  survivorMean: number;
  /** Cooperative runs only: share of games the world took everyone. */
  extinctionRate: number;
}

export interface Gate {
  name: string;
  ok: boolean;
  detail: string;
}

export function aggregate(summaries: readonly GameSummary[]): Aggregate {
  const games = summaries.length;
  const playerCount = summaries[0]?.playerCount ?? 0;

  const wins = new Array<number>(playerCount).fill(0);
  let winnerSlots = 0;
  for (const summary of summaries) {
    for (const slot of summary.winners) {
      wins[slot]++;
      winnerSlots++;
    }
  }
  const winRateBySeat = wins.map((count) => (winnerSlots > 0 ? count / winnerSlots : 0));

  const uniform = playerCount > 0 ? 1 / playerCount : 0;
  const seatDeviation = Math.max(...winRateBySeat.map((rate) => Math.abs(rate - uniform)), 0);

  // In co-op the winners *are* the survivors, so the score is their count.
  const coopGames = summaries.filter((s) => s.kind === 'survival' || s.kind === 'extinction');
  const survivorMean =
    coopGames.length > 0
      ? coopGames.reduce((sum, s) => sum + s.winners.length, 0) / coopGames.length
      : 0;
  const extinctionRate =
    coopGames.length > 0
      ? coopGames.filter((s) => s.kind === 'extinction').length / coopGames.length
      : 0;

  const turns = summaries.map((s) => s.turns).sort((a, b) => a - b);
  const firstBlood = summaries
    .map((s) => s.firstBloodTurn)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);

  const endings: Record<string, number> = {};
  for (const summary of summaries) endings[summary.kind] = (endings[summary.kind] ?? 0) + 1;

  const pactOutcomes: Record<PactOutcome, number> = {
    concord: 0,
    betrayal: 0,
    betrayed: 0,
    mutual_treachery: 0,
    spurned: 0,
    courted: 0,
    abstain: 0,
  };
  let pledges = 0;
  for (const summary of summaries) {
    for (const [outcome, count] of Object.entries(summary.pactOutcomes)) {
      pactOutcomes[outcome as PactOutcome] += count;
    }
    pledges += summary.pledgesMade;
  }

  // A "mutual pact" is any pledge that was reciprocated, however it then ended.
  const mutual =
    pactOutcomes.concord +
    pactOutcomes.betrayal +
    pactOutcomes.betrayed +
    pactOutcomes.mutual_treachery;
  const defections = pactOutcomes.betrayal + pactOutcomes.mutual_treachery;

  const sharedWins = summaries.filter((s) => s.winners.length > 1).length;

  const routeShares = Object.values(endings).map((count) => count / Math.max(1, games));

  return {
    games,
    playerCount,
    dominantRouteShare: routeShares.length > 0 ? Math.max(...routeShares) : 0,
    liveRoutes: routeShares.filter((share) => share >= 0.05).length,
    winRateBySeat,
    seatDeviation,
    turnsMedian: percentile(turns, 0.5),
    turnsMean: turns.reduce((a, b) => a + b, 0) / Math.max(1, turns.length),
    turnsP10: percentile(turns, 0.1),
    turnsP90: percentile(turns, 0.9),
    endings,
    pactOutcomes,
    betrayalRate: mutual > 0 ? defections / mutual : 0,
    reciprocationRate: pledges > 0 ? mutual / pledges : 0,
    sharedWinRate: games > 0 ? sharedWins / games : 0,
    firstBloodMedian: percentile(firstBlood, 0.5),
    snowballIndex: summaries.reduce((sum, s) => sum + s.peakShare, 0) / Math.max(1, games),
    survivorMean,
    extinctionRate,
  };
}

/**
 * The gates a run has to clear.
 *
 * Cooperative runs are scored differently, and not as an excuse. Three of the
 * competitive gates assert things that cannot exist in co-op: there are no
 * pacts to betray, a shared win is the only ending there is, and one route
 * taking 100% of games is the design rather than a collapse of it. Applying
 * them anyway would mean a mode that fails CI forever and teaches the table
 * nothing. What replaces them is the number co-op actually lives on -- how many
 * players are left standing -- gated from both sides, because a coalition that
 * always survives intact has no game in it either.
 */
/**
 * Seat fairness: the limit is statistical, not a flat 3%.
 *
 * Win rates are binomial, so a perfectly fair game still scatters around
 * uniform by roughly one standard error per seat — at 400 games and 8 players
 * that is 1.65%, and a fixed 3% bar would fail by chance a noticeable fraction
 * of the time. Scaling the bar with the sample keeps the gate meaningful as the
 * run size grows instead of merely flaky when it is small.
 */
function seatFairnessGate(stats: Aggregate): Gate {
  return {
    name: 'seat fairness',
    ok: stats.seatDeviation <= seatLimit(stats.playerCount, stats.games),
    detail:
      `max deviation from uniform ${(stats.seatDeviation * 100).toFixed(1)}% ` +
      `(limit ${(seatLimit(stats.playerCount, stats.games) * 100).toFixed(1)}% ` +
      `at n=${stats.games}, Bonferroni-corrected for ${stats.playerCount} seats)`,
  };
}

function gameLengthGate(stats: Aggregate, turnCap: number): Gate {
  const [low, high] = lengthBand(stats.playerCount, turnCap);
  return {
    name: 'game length',
    ok: stats.turnsMedian >= low && stats.turnsMedian <= high,
    detail: `median ${stats.turnsMedian} turns (target ${low}-${high} at a cap of ${turnCap})`,
  };
}

export function gatesFor(stats: Aggregate, turnCap: number): Gate[] {
  const coop = (stats.endings.survival ?? 0) + (stats.endings.extinction ?? 0) > 0;

  if (coop) {
    const players = stats.playerCount;
    return [
      seatFairnessGate(stats),
      gameLengthGate(stats, turnCap),
      {
        name: 'survivor spread',
        // A clean run has to be possible and it has to be rare-ish. Measured at
        // five players: raiders=0 leaves 3.90 of 5 standing and never wipes the
        // table, raiders=6 leaves 3.43 and wipes it 5% of the time.
        ok: stats.survivorMean >= players * 0.5 && stats.survivorMean <= players - 0.25,
        detail:
          `mean ${stats.survivorMean.toFixed(2)} of ${players} survived ` +
          `(target ${(players * 0.5).toFixed(2)}-${(players - 0.25).toFixed(2)})`,
      },
      {
        name: 'losable',
        // If the world never takes everyone, nothing is at stake; if it usually
        // does, nobody will play it twice.
        ok: stats.extinctionRate > 0 && stats.extinctionRate <= 0.2,
        detail: `${(stats.extinctionRate * 100).toFixed(1)}% of games ended in extinction (target 0-20%, non-zero)`,
      },
    ];
  }

  return [
    seatFairnessGate(stats),
    gameLengthGate(stats, turnCap),
    {
      name: 'betrayal rate',
      // Below the floor the dilemma is toothless and the pact is just a bonus
      // for pairing up; above the ceiling nobody ever cooperates and it is
      // indistinguishable from noise.
      ok: stats.betrayalRate >= 0.15 && stats.betrayalRate <= 0.45,
      detail: `${(stats.betrayalRate * 100).toFixed(1)}% of mutual pacts broken (target 15-45%)`,
    },
    {
      name: 'shared wins',
      // Two-sided. The ceiling is the anti-stalemate guard: if a table can
      // reliably coast into a shared win, the thresholds are wrong. The floor
      // matters just as much — a shared victory nobody ever reaches is not a
      // feature, and every tuning pass so far has pushed it toward extinction.
      // Duels are exempt: there, a shared win would be a draw.
      ok: stats.sharedWinRate < 0.25 && (stats.playerCount < 3 || stats.sharedWinRate >= 0.01),
      detail:
        `${(stats.sharedWinRate * 100).toFixed(1)}% of games ended shared ` +
        `(target ${stats.playerCount < 3 ? '0%' : '1-25%'})`,
    },
    {
      name: 'route diversity',
      // Several victory routes only make the game more dynamic if games
      // actually reach them. Without this, a change that quietly makes one
      // route strictly easiest reverts the design to a single ending and every
      // other gate still passes.
      ok: stats.dominantRouteShare <= routeLimit(stats.playerCount) && stats.liveRoutes >= 2,
      detail:
        `${stats.liveRoutes} routes at 5%+ of games, most common takes ` +
        `${(stats.dominantRouteShare * 100).toFixed(0)}% ` +
        `(limit ${(routeLimit(stats.playerCount) * 100).toFixed(0)}%)`,
    },
  ];
}

/**
 * Tolerated seat win-rate deviation.
 *
 * Two corrections matter here, and skipping either makes the gate lie.
 *
 * First, the bar scales with the sample: win rates are binomial, so a perfectly
 * fair game still scatters around uniform by about one standard error per seat.
 * A flat percentage would be meaningless at small n and unreachably strict at
 * large n.
 *
 * Second — and this is the subtle one — the statistic is the *maximum*
 * deviation across every seat, so allowing each seat a fixed 2.5 sigma means
 * roughly a one-in-ten chance that some seat clears it by luck alone on an
 * eight-player run. That is a multiple-comparisons problem, and it showed up
 * exactly as predicted: an 8-player run failed at 3.1% which resolved to 0.8%
 * once the sample grew. Bonferroni-correcting the per-seat threshold for the
 * number of seats fixes it, and the gate still catches real bias by a mile —
 * the tie-break bug this suite was written to find sat at 12.4%.
 */
const FAMILYWISE_ALPHA = 0.01;

function seatLimit(playerCount: number, games: number): number {
  if (playerCount < 2 || games < 1) return 1;
  const p = 1 / playerCount;
  const standardError = Math.sqrt((p * (1 - p)) / games);
  const perSeatAlpha = FAMILYWISE_ALPHA / playerCount;
  return Math.max(0.02, normalQuantile(1 - perSeatAlpha / 2) * standardError);
}

/**
 * Inverse standard normal CDF (Acklam's rational approximation), accurate to
 * about 1e-9 — far more than a CI threshold needs, and it keeps the harness
 * free of a stats dependency.
 */
function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new Error(`normalQuantile expects p in (0, 1), got ${p}`);

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const low = 0.02425;
  const high = 1 - low;

  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > high) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/**
 * How much of the endings one route may take.
 *
 * Duels get more slack because fewer routes are open to them at all: no shared
 * victory, and decapitation needs at least three founding capitals to exist.
 */
function routeLimit(playerCount: number): number {
  return playerCount <= 3 ? 0.9 : 0.8;
}

/**
 * Acceptable median game length, relative to the clock the game was given.
 *
 * This used to be an absolute 6-14 for duels and 14-22 for everyone else, which
 * stopped meaning anything once every preset targeted 5-10 turns: a good 8-turn
 * game and a broken one both fail a band written for 25-turn matches. What the
 * gate is really asserting is that a game uses a fair share of its clock without
 * needing all of it, so it is expressed that way instead.
 *
 * The two floors are not a rounding of one number. A duel is genuinely a shorter
 * game than a table: 800 two-player games run to a median of 9 turns against a
 * cap of 25, barely a third of the clock, because with one rival there is
 * nobody to hold the balance and domination arrives early. The old band knew
 * that and allowed duels down to 6. A single ratio does not — at 0.4 it demands
 * 10 of a duel and fails a distribution that has not changed since the gate was
 * written, which is how the first version of this function turned a green sweep
 * red without any game having got worse.
 *
 * At the legacy cap of 25 this yields 7-25 for duels and 13-25 for tables,
 * both of which contain the medians the absolute band was built around.
 */
function lengthBand(playerCount: number, turnCap: number): [number, number] {
  const floor = playerCount <= 3 ? 0.25 : 0.5;
  return [Math.max(3, Math.ceil(turnCap * floor)), turnCap];
}

export function formatReport(stats: Aggregate, gates: readonly Gate[]): string {
  const lines: string[] = [];
  const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

  lines.push(`${stats.games} games, ${stats.playerCount} players`);
  lines.push('');
  lines.push(
    `  length        median ${stats.turnsMedian}  mean ${stats.turnsMean.toFixed(1)}  ` +
      `p10 ${stats.turnsP10}  p90 ${stats.turnsP90}`,
  );
  lines.push(`  first blood   median turn ${stats.firstBloodMedian}`);
  lines.push(`  snowball      peak share ${pct(stats.snowballIndex)}`);
  lines.push('');
  lines.push(
    `  seat win %    ${stats.winRateBySeat.map((r) => pct(r)).join('  ')}` +
      `   (uniform ${pct(1 / Math.max(1, stats.playerCount))})`,
  );
  lines.push(
    `  endings       ${Object.entries(stats.endings)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => `${kind} ${count}`)
      .join('  ')}`,
  );
  lines.push('');
  lines.push(`  reciprocated  ${pct(stats.reciprocationRate)} of pledges found a partner`);
  lines.push(`  betrayal      ${pct(stats.betrayalRate)} of mutual pacts broken`);
  lines.push(`  shared wins   ${pct(stats.sharedWinRate)}`);
  lines.push(
    `  pact tally    ${Object.entries(stats.pactOutcomes)
      .filter(([, count]) => count > 0)
      .map(([outcome, count]) => `${outcome} ${count}`)
      .join('  ')}`,
  );
  lines.push('');

  for (const gate of gates) {
    lines.push(`  ${gate.ok ? 'PASS' : 'FAIL'}  ${gate.name.padEnd(14)} ${gate.detail}`);
  }

  return lines.join('\n');
}

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[index];
}
