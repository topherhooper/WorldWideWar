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

  applyRaiders(state, map, rules, events);
}

/**
 * Whatever lived on the burnt rim does not simply die with it.
 *
 * In cooperative games the storm stops being only a clock: each wave drives the
 * dispossessed inward, onto the permanent core -- the ring mapgen never
 * collapses, which is the only ground still worth holding at the end.
 *
 * Targeting the core rather than the collapse frontier is the whole point, and
 * it was measured. Raiders first landed on surviving land bordering the fresh
 * collapse, which read well and did nothing: at short caps the storm interval
 * is one turn, so every province they hit burned the turn after, and 0 vs 6
 * raiders moved mean survivors by 0.05 in 300 games. Pressure has to be applied
 * where the game is still going to be played.
 *
 * Owned territory is never taken outright by raiders and never drops below one
 * army. The storm's job is pressure, not elimination -- a player must always
 * lose their last province to somebody who decided to take it.
 */
function applyRaiders(
  state: GameState,
  map: GeneratedMap,
  rules: RuleConfig,
  events: WorldEvent[],
): void {
  if (rules.stormRaiders <= 0) return;

  // Ascending territory order: the target set must be identical on a replay.
  const core: TerritoryId[] = [];
  for (const territory of map.territories) {
    if (territory.wave === -1 && !state.collapsed[territory.id]) core.push(territory.id);
  }

  for (const id of core.sort((a, b) => a - b)) {
    if (state.owner[id] === null) {
      state.armies[id] += rules.stormRaiders;
      continue;
    }
    const lost = Math.min(rules.stormRaiders, Math.max(0, state.armies[id] - 1));
    if (lost === 0) continue;
    state.armies[id] -= lost;
    events.push({ kind: 'routed', slot: state.owner[id]!, at: id, lost });
  }
}

/** Territories still in play. */
export function survivingTerritories(state: GameState): number {
  let count = 0;
  for (let id = 0; id < state.collapsed.length; id++) if (!state.collapsed[id]) count++;
  return count;
}
