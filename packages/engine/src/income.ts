/**
 * Income.
 *
 * Reinforcements scale with held territory, but only territory *in supply* —
 * see supply.ts for why that matters more than any other economic rule here.
 */

import {
  BASE_INCOME,
  CAPTURED_CAPITAL_INCOME,
  TERRITORIES_PER_INCOME,
  WAR_ECONOMY_INTERVAL,
} from './constants.js';
import { suppliedCount } from './supply.js';
import type { GameState, GeneratedMap, Slot } from './types.js';

export function computeIncome(state: GameState, map: GeneratedMap, slot: Slot): number {
  if (state.status[slot] !== 'active') return 0;

  // Cold Snap: the war economy seizes up and only held regions still pay out.
  const coldSnap = state.activeEvent === 'cold_snap';

  let income = coldSnap ? 0 : BASE_INCOME;

  if (!coldSnap) {
    income += Math.floor(suppliedCount(state, slot) / TERRITORIES_PER_INCOME);
    // The war economy ramps for everyone, which shortens the late game.
    income += Math.floor(state.turn / WAR_ECONOMY_INTERVAL);
  }

  income += regionBonusFor(state, map, slot);

  // Holding someone else's capital pays, so a decapitation is worth attempting
  // even when the territory itself is not especially valuable.
  for (let other = 0; other < state.playerCount; other++) {
    if (other === slot) continue;
    const capital = state.capital[other];
    if (capital !== null && state.owner[capital] === slot && !state.collapsed[capital]) {
      income += CAPTURED_CAPITAL_INCOME;
    }
  }

  income += state.pendingBonusIncome[slot];

  return Math.max(0, income);
}

/** Sum of bonuses for regions the slot holds in full. */
export function regionBonusFor(state: GameState, map: GeneratedMap, slot: Slot): number {
  let total = 0;

  for (const region of map.regions) {
    let holdsAll = true;
    let live = 0;

    for (const id of region.territoryIds) {
      if (state.collapsed[id]) continue;
      live++;
      if (state.owner[id] !== slot) {
        holdsAll = false;
        break;
      }
    }

    // A region entirely consumed by the storm pays nobody.
    if (holdsAll && live > 0) total += region.bonus;
  }

  return total;
}

/** Recomputes every player's income for the turn about to open. */
export function recomputeIncome(state: GameState, map: GeneratedMap): void {
  for (let slot = 0; slot < state.playerCount; slot++) {
    state.income[slot] = computeIncome(state, map, slot);
  }
  state.pendingBonusIncome.fill(0);
}
