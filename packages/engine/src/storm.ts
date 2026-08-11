/**
 * The storm.
 *
 * The world burns inward from the rim on a fixed schedule, each wave warned one
 * turn ahead. This is the termination guarantee: territory shrinks until only a
 * contested core remains, so a stalemate stops being geometrically possible.
 *
 * Because waves are radial and the map is P-fold symmetric, every player loses
 * the same number of territories at the same moment. The storm is pressure
 * applied evenly, not a punishment aimed at whoever happens to be losing.
 */

import type { GameState, GeneratedMap, RuleConfig, TerritoryId, WorldEvent } from './types.js';

/** Which wave index collapses on a given turn, or null. */
export function waveCollapsingOn(turn: number, rules: RuleConfig): number | null {
  if (turn < rules.stormFirstWave) return null;
  const offset = turn - rules.stormFirstWave;
  if (offset % rules.stormInterval !== 0) return null;
  return offset / rules.stormInterval;
}

/** Territories that will burn next turn, for the warning banner. */
export function warnedTerritories(
  map: GeneratedMap,
  turn: number,
  rules: RuleConfig,
): TerritoryId[] {
  const wave = waveCollapsingOn(turn + 1, rules);
  if (wave === null || wave >= map.collapseWaves.length) return [];
  return map.collapseWaves[wave];
}

/**
 * Collapses the wave due this turn, if any.
 *
 * Everything standing on collapsed ground is destroyed — the storm takes armies
 * with the land, which is what stops a player from simply parking their whole
 * force on the rim and waiting.
 */
export function applyStorm(
  state: GameState,
  map: GeneratedMap,
  rules: RuleConfig,
  events: WorldEvent[],
): void {
  const wave = waveCollapsingOn(state.turn, rules);
  if (wave === null || wave >= map.collapseWaves.length) return;

  const territories = map.collapseWaves[wave];
  let armiesLost = 0;

  for (const id of territories) {
    if (state.collapsed[id]) continue;
    armiesLost += state.armies[id];
    state.collapsed[id] = true;
    state.armies[id] = 0;
    state.owner[id] = null;
  }

  state.wavesCollapsed = Math.max(state.wavesCollapsed, wave + 1);
  events.push({ kind: 'storm', wave, territories: [...territories], armiesLost });
}

/** Territories still in play. */
export function survivingTerritories(state: GameState): number {
  let count = 0;
  for (let id = 0; id < state.collapsed.length; id++) if (!state.collapsed[id]) count++;
  return count;
}
