/**
 * Renders generated maps to SVG so the generator can be eyeballed.
 *
 * Symmetry, chokepoints and sea-lane placement are obvious to the eye and easy
 * to miss in assertions — a map can satisfy every numeric constraint and still
 * look wrong.
 *
 *   pnpm mapviz -- --players 8 --seeds 6
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateMap,
  makeLayout,
  perWedgeFor,
  validateFairness,
  validateGraph,
  validateStructure,
  validateSymmetry,
} from '@www/engine';
import { escapeXml, renderMapSvg } from './render.js';

interface Options {
  players: number;
  seeds: number;
  out: string;
  seedPrefix: string;
}

function parseArgs(argv: string[]): Options {
  const here = dirname(fileURLToPath(import.meta.url));
  const options: Options = {
    players: 8,
    seeds: 6,
    out: resolve(here, '../out'),
    seedPrefix: 'viz',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case '--players':
        options.players = Number(value);
        i++;
        break;
      case '--seeds':
        options.seeds = Number(value);
        i++;
        break;
      case '--out':
        options.out = resolve(value);
        i++;
        break;
      case '--prefix':
        options.seedPrefix = value;
        i++;
        break;
      case '--help':
        console.log('usage: pnpm mapviz -- [--players N] [--seeds N] [--out DIR] [--prefix S]');
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
  const layout = makeLayout(options.players, perWedgeFor(options.players));
  mkdirSync(options.out, { recursive: true });

  const cards: string[] = [];

  for (let i = 0; i < options.seeds; i++) {
    const seed = `${options.seedPrefix}-${i}`;
    const map = generateMap(seed, options.players);

    const issues = [
      ...validateGraph(map.adjacency, new Set([layout.centre])),
      ...validateSymmetry(layout, map.adjacency),
      ...validateStructure(map),
      ...validateFairness(map),
    ];

    let degreeSum = 0;
    for (const list of map.adjacency) degreeSum += list.length;
    const seaLanes = map.edges.filter((edge) => edge.kind === 'sea').length;

    const svg = renderMapSvg(map);
    writeFileSync(resolve(options.out, `${seed}.svg`), svg, 'utf8');

    const status = issues.length === 0 ? 'ok' : issues.map((x) => x.code).join(', ');
    console.log(
      `${seed}: ${map.territories.length} territories, ` +
        `${map.regions.length} regions, avg degree ${(degreeSum / map.adjacency.length).toFixed(2)}, ` +
        `${seaLanes} sea lanes, ${map.collapseWaves.length} storm waves — ${status}`,
    );

    cards.push(
      `<figure><div class="map">${svg}</div>` +
        `<figcaption><strong>${escapeXml(seed)}</strong> · ${map.territories.length} territories · ` +
        `${map.regions.length} regions · ${seaLanes} sea lanes · ${escapeXml(status)}</figcaption></figure>`,
    );
  }

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>World Wide War — generated maps</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 2rem; background: #0b0e15; color: #e8ecf4;
         font-family: ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 .35rem; }
  p.lede { margin: 0 0 2rem; color: #93a1bb; max-width: 62ch; line-height: 1.55; }
  .grid { display: grid; gap: 1.75rem; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
  figure { margin: 0; background: #131926; border: 1px solid #222c40; border-radius: 12px; overflow: hidden; }
  .map svg { display: block; width: 100%; height: auto; }
  figcaption { padding: .7rem .85rem; font-size: .78rem; color: #93a1bb; border-top: 1px solid #222c40; }
</style></head>
<body>
  <h1>Generated maps — ${options.players} players</h1>
  <p class="lede">Each world is one angular wedge sampled once and rotated ${options.players} times,
  so every seat's neighbourhood is graph-isomorphic to every other's. Filled territories are starting
  positions, ringed circles are capitals, dashed arcs are sea lanes, and darkened territories toward
  the rim are the ones the storm burns first.</p>
  <div class="grid">${cards.join('\n')}</div>
</body></html>`;

  writeFileSync(resolve(options.out, 'index.html'), html, 'utf8');
  console.log(`\nwrote ${options.seeds} maps to ${options.out}`);
}

main();
