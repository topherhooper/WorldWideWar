/**
 * The balance harness.
 *
 *   pnpm sim -- --games 2000 --players 6
 *
 * Plays seeded bot games and reports whether the design still holds: fair
 * seats, fast games, a betrayal rate that means the dilemma has teeth, and a
 * shared-win rate low enough that a table cannot coast into a condominium.
 *
 * Exits non-zero on a failed gate so CI can depend on it.
 */

import { playBotGame, type Difficulty, type GameSummary } from '@www/engine';
import { aggregate, formatReport, gatesFor } from './report.js';

interface Options {
  games: number;
  players: number[];
  difficulty: Difficulty;
  seedPrefix: string;
  strict: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    games: 200,
    players: [6],
    difficulty: 'normal',
    seedPrefix: 'sim',
    strict: true,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case '--games':
        options.games = Number(value);
        i++;
        break;
      case '--players':
        options.players = value.split(',').map((v) => Number(v.trim()));
        i++;
        break;
      case '--difficulty':
        options.difficulty = value as Difficulty;
        i++;
        break;
      case '--prefix':
        options.seedPrefix = value;
        i++;
        break;
      case '--no-gates':
        options.strict = false;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
        console.log(
          'usage: pnpm sim -- [--games N] [--players 4,6,12] [--difficulty easy|normal|hard]\n' +
            '                  [--prefix S] [--no-gates] [--verbose]',
        );
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  let failures = 0;

  for (const playerCount of options.players) {
    const started = Date.now();
    const summaries: GameSummary[] = [];

    for (let i = 0; i < options.games; i++) {
      summaries.push(
        playBotGame({
          seed: `${options.seedPrefix}-${playerCount}-${i}`,
          playerCount,
          difficulty: options.difficulty,
        }),
      );
    }

    const elapsed = Date.now() - started;
    const stats = aggregate(summaries);
    const gates = gatesFor(stats);

    console.log(`\n${'='.repeat(72)}`);
    console.log(formatReport(stats, gates));
    console.log(
      `\n  ${elapsed}ms for ${options.games} games ` +
        `(${(elapsed / options.games).toFixed(1)}ms each)`,
    );

    if (options.verbose) {
      const longest = [...summaries].sort((a, b) => b.turns - a.turns)[0];
      const shortest = [...summaries].sort((a, b) => a.turns - b.turns)[0];
      console.log(`\n  longest  ${longest.seed}: ${longest.turns} turns, ${longest.kind}`);
      console.log(`  shortest ${shortest.seed}: ${shortest.turns} turns, ${shortest.kind}`);
    }

    failures += gates.filter((gate) => !gate.ok).length;
  }

  if (options.strict && failures > 0) {
    console.error(`\n${failures} gate(s) failed`);
    process.exit(1);
  }
}

main();
