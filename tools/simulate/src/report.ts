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

  return {
    games,
    playerCount,
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
  };
}

export function gatesFor(stats: Aggregate): Gate[] {
  return [
    {
      name: 'seat fairness',
      // The limit is statistical, not a flat 3%. Win rates are binomial, so a
      // perfectly fair game still scatters around uniform by roughly one
      // standard error per seat — at 400 games and 8 players that is 1.65%, and
      // a fixed 3% bar would fail by chance a noticeable fraction of the time.
      // Scaling the bar with the sample keeps the gate meaningful as the run
      // size grows instead of merely flaky when it is small.
      ok: stats.seatDeviation <= seatLimit(stats.playerCount, stats.games),
      detail:
        `max deviation from uniform ${(stats.seatDeviation * 100).toFixed(1)}% ` +
        `(limit ${(seatLimit(stats.playerCount, stats.games) * 100).toFixed(1)}% ` +
        `at n=${stats.games})`,
    },
    {
      name: 'game length',
      // The band scales with table size. Forcing a duel to last as long as a
      // twelve-player brawl would mean padding it artificially: two players
      // resolve a map faster because there is nobody else to fight through.
      ok:
        stats.turnsMedian >= lengthBand(stats.playerCount)[0] &&
        stats.turnsMedian <= lengthBand(stats.playerCount)[1],
      detail: `median ${stats.turnsMedian} turns (target ${lengthBand(stats.playerCount).join('-')})`,
    },
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
      // The anti-stalemate guard: if a table can reliably coast into a
      // condominium, the thresholds are wrong.
      ok: stats.sharedWinRate < 0.25,
      detail: `${(stats.sharedWinRate * 100).toFixed(1)}% of games ended shared (limit 25%)`,
    },
  ];
}

/**
 * Tolerated seat win-rate deviation: 2.5 standard errors, floored at 2% so a
 * huge run does not start failing on noise-level differences that no player
 * could ever perceive.
 */
function seatLimit(playerCount: number, games: number): number {
  if (playerCount < 2 || games < 1) return 1;
  const p = 1 / playerCount;
  const standardError = Math.sqrt((p * (1 - p)) / games);
  return Math.max(0.02, 2.5 * standardError);
}

/** Acceptable median game length, by table size. */
function lengthBand(playerCount: number): [number, number] {
  if (playerCount <= 3) return [6, 14];
  return [14, 22];
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
