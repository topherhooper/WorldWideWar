/**
 * Victory conditions.
 *
 * Games always end. Conquest and domination end them early; the storm shrinks
 * the map until domination becomes reachable; and a hard turn cap resolves
 * anything still standing into ranked standings with no draws.
 *
 * A shared *condominium* victory is possible, but deliberately harder to reach
 * than winning alone: a larger share of the map, capped at two players, and
 * only on an unbroken mutual concord. It is meant to be the fallback when
 * neither partner can finish the other before the storm closes — not something
 * a table can comfortably coast into. With one pledge available per turn and a
 * shrinking board, a general peace cannot win.
 */

import { MIN_CONDOMINIUM_PLAYERS } from './constants.js';
import { concordPair } from './contest/pact.js';
import { suppliedCount, territoryCount } from './supply.js';
import { survivingTerritories } from './storm.js';
import type { GameResult, GameState, GeneratedMap, RuleConfig, Slot, WorldEvent } from './types.js';

export function checkVictory(
  state: GameState,
  map: GeneratedMap,
  rules: RuleConfig,
): GameResult | null {
  const alive: Slot[] = [];
  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] === 'active') alive.push(slot);
  }

  if (alive.length === 0) {
    // Everyone burned or was eliminated in the same tick.
    return { kind: 'conquest', winners: [], standings: rankPlayers(state, map) };
  }

  if (alive.length === 1) {
    return { kind: 'conquest', winners: alive, standings: rankPlayers(state, map) };
  }

  const surviving = survivingTerritories(state);
  if (surviving > 0) {
    // Solo domination.
    for (const slot of alive) {
      if (territoryCount(state, slot) / surviving >= rules.dominationShare) {
        return { kind: 'domination', winners: [slot], standings: rankPlayers(state, map) };
      }
    }

    // Shared condominium: strictly two players, jointly over a higher bar, on a
    // concord neither has broken for `condominiumStreak` turns. Never in a
    // duel, where "we both win" is simply a draw.
    if (state.playerCount >= MIN_CONDOMINIUM_PLAYERS) {
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i];
          const b = alive[j];
          if (!concordPair(state, a, b, rules.condominiumStreak)) continue;

          const share = (territoryCount(state, a) + territoryCount(state, b)) / surviving;
          if (share >= rules.condominiumShare) {
            return { kind: 'condominium', winners: [a, b], standings: rankPlayers(state, map) };
          }
        }
      }
    }
  }

  if (state.turn >= rules.turnCap) {
    const standings = rankPlayers(state, map);
    const [first, second] = standings;

    // At the cap a standing concord can still share first place, on a lower
    // territory bar than mid-game — by this point the storm has done most of
    // the work of deciding who was ever in contention.
    if (
      first !== undefined &&
      second !== undefined &&
      state.playerCount >= MIN_CONDOMINIUM_PLAYERS &&
      concordPair(state, first, second, rules.condominiumStreak) &&
      surviving > 0 &&
      (territoryCount(state, first) + territoryCount(state, second)) / surviving >= 0.6
    ) {
      return { kind: 'turn_cap', winners: [first, second], standings };
    }

    return { kind: 'turn_cap', winners: first === undefined ? [] : [first], standings };
  }

  return null;
}

/**
 * Ranks every player, best first.
 *
 * Surviving territories, then income, then total armies, then whether they
 * still hold their own capital. Eliminated players sort below the living, in
 * reverse elimination order, so surviving longer always ranks better.
 */
export function rankPlayers(state: GameState, map: GeneratedMap): Slot[] {
  const slots = Array.from({ length: state.playerCount }, (_, slot) => slot);

  // Final tie-break is seeded rather than by slot index: at the turn cap a
  // genuine dead heat would otherwise always be awarded to the lowest seat.
  const tiebreak = slots.map((slot) => seatTiebreak(map.seed, slot));

  return slots.sort((a, b) => {
    const aliveA = state.status[a] === 'active';
    const aliveB = state.status[b] === 'active';
    if (aliveA !== aliveB) return aliveA ? -1 : 1;

    if (!aliveA && !aliveB) {
      const ta = state.eliminatedTurn[a] ?? 0;
      const tb = state.eliminatedTurn[b] ?? 0;
      if (ta !== tb) return tb - ta;
      return a - b;
    }

    const territories = territoryCount(state, b) - territoryCount(state, a);
    if (territories !== 0) return territories;

    const supplied = suppliedCount(state, b) - suppliedCount(state, a);
    if (supplied !== 0) return supplied;

    const armies = totalArmies(state, b) - totalArmies(state, a);
    if (armies !== 0) return armies;

    const holdsA = holdsOwnCapital(state, map, a) ? 1 : 0;
    const holdsB = holdsOwnCapital(state, map, b) ? 1 : 0;
    if (holdsA !== holdsB) return holdsB - holdsA;

    return tiebreak[a] - tiebreak[b];
  });
}

function seatTiebreak(seed: string, slot: Slot): number {
  let h = 2166136261 ^ slot;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function totalArmies(state: GameState, slot: Slot): number {
  let total = 0;
  for (let id = 0; id < state.owner.length; id++) {
    if (state.owner[id] === slot && !state.collapsed[id]) total += state.armies[id];
  }
  return total;
}

function holdsOwnCapital(state: GameState, map: GeneratedMap, slot: Slot): boolean {
  const start = map.starts.find((s) => s.slot === slot);
  if (!start) return false;
  return state.owner[start.capital] === slot && !state.collapsed[start.capital];
}

/** Marks players with nothing left as eliminated. */
export function processEliminations(state: GameState, events: WorldEvent[]): void {
  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] !== 'active') continue;
    if (territoryCount(state, slot) > 0) continue;

    state.status[slot] = 'eliminated';
    state.eliminatedTurn[slot] = state.turn;
    state.capital[slot] = null;

    // A dead player's pact obligations die with them, so a surviving partner's
    // streak cannot be propped up by someone no longer on the board.
    state.pactPartner[slot] = null;
    state.pactStreak[slot] = 0;
    for (let other = 0; other < state.playerCount; other++) {
      if (state.pactPartner[other] === slot) {
        state.pactPartner[other] = null;
        state.pactStreak[other] = 0;
      }
    }

    events.push({ kind: 'eliminated', slot });
  }
}
