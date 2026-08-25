// THROWAWAY prototype harness — renders MapView to static HTML for screenshotting.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, writeFileSync } from 'node:fs';
import { generateMap, createInitialState, rulesFor, waveCollapsingOn } from '@www/engine';
import { MapView } from './src/game/MapView.js';

const PLAYERS = 8;
const TURN_CAP = 25;
const rules = rulesFor(PLAYERS, TURN_CAP);
const map = generateMap('proto-storm-1', PLAYERS);
const css = readFileSync('packages/web/src/styles.css', 'utf8');

console.log('waves:', map.collapseWaves.length, map.collapseWaves.map((w) => w.length));
console.log('stormFirstWave', rules.stormFirstWave, 'interval', rules.stormInterval);
for (let t = 8; t <= 22; t++) console.log('turn', t, '-> wave', waveCollapsingOn(t, rules));

function scene(label: string, turn: number, spray: boolean, burnThrough: number) {
  const state = createInitialState(map, rules);
  state.turn = turn;
  if (spray) {
    // Stress case: every living tile owned, cycling all eight player colours.
    for (let id = 0; id < state.owner.length; id++) {
      state.owner[id] = id % PLAYERS;
      state.armies[id] = 1 + (id % 9);
    }
  }
  // Burn the waves that have already collapsed by this turn.
  for (let w = 0; w < burnThrough; w++) {
    for (const id of map.collapseWaves[w] ?? []) {
      state.collapsed[id] = true;
      state.owner[id] = null;
      state.armies[id] = 0;
    }
  }
  const svg = renderToStaticMarkup(
    <MapView
      map={map}
      state={state}
      rules={rules}
      mySlot={0}
      selected={null}
      mode="deploy"
      onTerritoryClick={() => {}}
    />,
  );
  return `<section><h2>${label}</h2><div class="map-wrap">${svg}</div></section>`;
}

const scenes: [string, string][] = [
  ['s1', scene('turn 9 — first wave burns when these orders resolve (real start position)', 9, false, 0)],
  ['s2', scene('turn 9 — same, every tile owned (all 8 colours under the hatch)', 9, true, 0)],
  ['s3', scene('turn 12 — waves 0-2 already ash, wave 3 doomed', 12, true, 3)],
  ['s4', scene('turn 16 — storm finished, nothing doomed, over half the world ash', 16, true, 6)],
];

for (const [name, html] of scenes) {
  writeFileSync(
    `proto-${name}.html`,
    `<!doctype html><meta charset="utf8"><style>${css}
     body{padding:.75rem} h2{font-size:.9rem;color:#9a97a8;font-weight:600;margin:.2rem 0 .5rem}
     .map-wrap{max-width:900px}</style>${html}`,
  );
}
console.log('wrote', scenes.length, 'scenes');
