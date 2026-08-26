/**
 * Prints one S.A.C.R.E. game.
 *
 *   pnpm sacre --seed s1
 *
 * The engine may not touch `process` or `console`, so the CLI lives out here --
 * same split as the balance harness in tools/simulate.
 */

import { playSacreGame } from '@www/engine/sacre';

const argv = process.argv.slice(2);
const seedFlag = argv.indexOf('--seed');
const seed = seedFlag >= 0 ? argv[seedFlag + 1] : 's1';
const playersFlag = argv.indexOf('--players');
const players = playersFlag >= 0 ? Number(argv[playersFlag + 1]) : 4;

const result = playSacreGame(seed, players);
for (const line of result.lines) console.log(line);
