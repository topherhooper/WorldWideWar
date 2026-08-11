/**
 * Supply lines.
 *
 * Only territories connected to your capital *through your own territory*
 * generate income or can receive reinforcements. This is the anti-snowball
 * mechanic and the best strategic lever in the game: cutting a leader's map in
 * half halves their economy that same turn, and the counterplay is a move on
 * the board rather than a rubber-banding rule.
 */

import { reachable } from './graph.js';
import type { GameState, GeneratedMap, Slot } from './types.js';

/** Recomputes `state.supplied` from current ownership. Mutates in place. */
export function recomputeSupply(state: GameState, map: GeneratedMap): void {
  state.supplied.fill(false);

  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] !== 'active') continue;
    const capital = state.capital[slot];
    if (capital === null) continue;
    if (state.owner[capital] !== slot || state.collapsed[capital]) continue;

    const supplied = reachable(
      map.adjacency,
      capital,
      (id) => state.owner[id] === slot && !state.collapsed[id],
    );
    for (const id of supplied) state.supplied[id] = true;
  }
}

/** Territories a slot holds that are in supply. */
export function suppliedCount(state: GameState, slot: Slot): number {
  let count = 0;
  for (let id = 0; id < state.owner.length; id++) {
    if (state.owner[id] === slot && state.supplied[id] && !state.collapsed[id]) count++;
  }
  return count;
}

/** Every live territory a slot holds, in or out of supply. */
export function territoryCount(state: GameState, slot: Slot): number {
  let count = 0;
  for (let id = 0; id < state.owner.length; id++) {
    if (state.owner[id] === slot && !state.collapsed[id]) count++;
  }
  return count;
}

/**
 * Relocates a capital that has fallen or burned.
 *
 * The new seat is the strongest territory in the player's largest connected
 * holding — losing your capital costs you the supply it anchored, but it does
 * not end you outright. Returns the new capital, or null if the player has
 * nothing left.
 */
export function relocateCapital(
  state: GameState,
  map: GeneratedMap,
  slot: Slot,
): number | null {
  const owned: number[] = [];
  for (let id = 0; id < state.owner.length; id++) {
    if (state.owner[id] === slot && !state.collapsed[id]) owned.push(id);
  }
  if (owned.length === 0) return null;

  const seen = new Set<number>();
  let best: number[] = [];

  for (const id of owned) {
    if (seen.has(id)) continue;
    const group = reachable(
      map.adjacency,
      id,
      (candidate) => state.owner[candidate] === slot && !state.collapsed[candidate],
    );
    for (const member of group) seen.add(member);
    if (group.size > best.length) best = [...group].sort((a, b) => a - b);
  }
  if (best.length === 0) return null;

  // Strongest garrison in the largest holding; ties to the lowest id so the
  // choice stays canonical.
  let capital = best[0];
  for (const id of best) {
    if (state.armies[id] > state.armies[capital]) capital = id;
  }
  return capital;
}
