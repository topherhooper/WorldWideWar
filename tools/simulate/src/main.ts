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

import {
  DEFAULT_RULES,
  playBotGame,
  presetById,
  presetRules,
  type Difficulty,
  type GameSummary,
} from '@www/engine';
import { aggregate, formatReport, gatesFor } from './report.js';

interface Options {
  games: number;
  players: number[];
  difficulty: Difficulty;
  seedPrefix: string;
  strict: boolean;
  verbose: boolean;
  /** Preset id to play under; null means the legacy `rulesFor` tuning. */
  preset: string | null;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    games: 200,
    players: [6],
    difficulty: 'normal',
    seedPrefix: 'sim',
    strict: true,
    verbose: false,
    preset: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    // `pnpm sim -- --games 800` forwards a bare `--` through to us, which is
    // the invocation the README and CI both use.
    if (arg === '--') continue;
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
      case '--preset':
        options.preset = value;
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
            '                  [--preset pact|tiers|pact-blitz|tiers-v2]\n' +
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

  // Without --preset the harness stays on the legacy `rulesFor` tuning the
  // gates were calibrated against; with it, games get exactly what a new lobby
  // of that preset would get.
  const preset = options.preset !== null ? presetById(options.preset) : null;
  if (options.preset !== null && preset === null) {
    console.error(`unknown preset: ${options.preset}`);
    process.exit(2);
  }

  for (const playerCount of options.players) {
    const started = Date.now();
    const summaries: GameSummary[] = [];
    const rules =
      preset !== null ? presetRules(preset, playerCount, preset.defaultTurnCap) : undefined;

    for (let i = 0; i < options.games; i++) {
      summaries.push(
        playBotGame({
          seed: `${options.seedPrefix}-${playerCount}-${i}`,
          playerCount,
          difficulty: options.difficulty,
          // Spread rather than pass `undefined`: exactOptionalPropertyTypes
          // draws a distinction between absent and explicitly undefined.
          ...(rules !== undefined ? { rules } : {}),
        }),
      );
    }

    const elapsed = Date.now() - started;
    const stats = aggregate(summaries);
    const gates = gatesFor(stats, rules?.turnCap ?? DEFAULT_RULES.turnCap);

    console.log(`\n${'='.repeat(72)}`);
    if (preset !== null) {
      console.log(`preset ${preset.id} (turn cap ${preset.defaultTurnCap})`);
    }
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
