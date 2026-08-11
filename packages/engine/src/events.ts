/**
 * Global events.
 *
 * Drawn from a seeded deck without replacement and **announced a turn ahead**,
 * so they are tactical rather than merely punitive: you get to write one set of
 * orders knowing what is coming. Immediate effects land at the end of the world
 * tick, before players write orders for the turn the event governs, so nobody
 * is ever surprised by a board they could not see.
 */

import type { GameState, GeneratedMap, Slot, WorldEvent } from './types.js';
import type { Rng } from './rng.js';

export const GLOBAL_EVENTS = [
  'mobilization',
  'mud_season',
  'uprising',
  'warlords',
  'cold_snap',
  'conscription',
  'fog',
] as const;

export type GlobalEventId = (typeof GLOBAL_EVENTS)[number];

export const EVENT_DESCRIPTIONS: Record<GlobalEventId, string> = {
  mobilization: 'Mobilization — every power raises five extra armies.',
  mud_season: 'Mud Season — attackers fight a band weaker.',
  uprising: 'Uprising — every stack of eight or more loses three to unrest.',
  warlords: 'Warlords — unclaimed lands raise fresh garrisons.',
  cold_snap: 'Cold Snap — no income this turn beyond held regions.',
  conscription: 'Conscription — every frontier territory raises one army.',
  fog: 'Fog — army counts are hidden for two turns.',
};

/** Armies added to every player's income by Mobilization. */
const MOBILIZATION_BONUS = 5;
/** Stack size at which unrest sets in, and the armies it costs. */
const UPRISING_THRESHOLD = 8;
const UPRISING_LOSS = 3;
const WARLORD_TERRITORIES = 3;
const WARLORD_ARMIES = 3;
const FOG_DURATION = 2;

export function mobilizationBonus(state: GameState): number {
  return state.activeEvent === 'mobilization' ? MOBILIZATION_BONUS : 0;
}

/** Draws an unused event, or null once the deck is exhausted. */
export function drawEvent(state: GameState, rng: Rng): GlobalEventId | null {
  const available = GLOBAL_EVENTS.filter((id) => !state.usedEvents.includes(id));
  if (available.length === 0) return null;
  return rng.pick(available);
}

/**
 * Applies an event's immediate board effects.
 *
 * Effects that change income (Mobilization, Cold Snap) or combat (Mud Season)
 * are not handled here — they are read where they apply, in income.ts and the
 * resolution pipeline respectively.
 */
export function applyEventEffects(
  state: GameState,
  map: GeneratedMap,
  eventId: GlobalEventId | null,
  rng: Rng,
  events: WorldEvent[],
): void {
  if (eventId === null) return;

  switch (eventId) {
    case 'uprising': {
      // A tax on doomstacks: hoarding one enormous army stops being free.
      for (let id = 0; id < state.armies.length; id++) {
        if (state.collapsed[id]) continue;
        if (state.armies[id] >= UPRISING_THRESHOLD) {
          state.armies[id] = Math.max(1, state.armies[id] - UPRISING_LOSS);
        }
      }
      break;
    }

    case 'warlords': {
      const neutrals: number[] = [];
      for (let id = 0; id < state.owner.length; id++) {
        if (state.owner[id] === null && !state.collapsed[id]) neutrals.push(id);
      }
      for (const id of rng
        .shuffle(neutrals)
        .slice(0, WARLORD_TERRITORIES)
        .sort((a, b) => a - b)) {
        state.armies[id] += WARLORD_ARMIES;
      }
      break;
    }

    case 'conscription': {
      // Rewards holding a real frontier rather than a safe interior.
      const gains: number[] = [];
      for (let id = 0; id < state.owner.length; id++) {
        const owner = state.owner[id];
        if (owner === null || state.collapsed[id]) continue;
        const onFrontier = map.adjacency[id].some(
          (n) => !state.collapsed[n] && state.owner[n] !== owner,
        );
        if (onFrontier) gains.push(id);
      }
      for (const id of gains) state.armies[id]++;
      break;
    }

    case 'fog': {
      state.fogUntilTurn = state.turn + FOG_DURATION;
      break;
    }

    case 'mobilization':
    case 'cold_snap':
    case 'mud_season':
      // Read at the point of use rather than applied to the board.
      break;
  }

  events.push({ kind: 'global_event', id: eventId, applied: true });
}

/** Are army counts hidden from everyone this turn? */
export function fogActive(state: GameState): boolean {
  return state.turn < state.fogUntilTurn;
}

/** Mud Season drops attackers one multiplier band. */
export const MUD_SEASON_PENALTY = 15;

export function attackerPenalty(state: GameState, isDefender: boolean): number {
  if (state.activeEvent !== 'mud_season' || isDefender) return 0;
  return MUD_SEASON_PENALTY;
}

export function describeEvent(id: string | null): string | null {
  if (id === null) return null;
  return EVENT_DESCRIPTIONS[id as GlobalEventId] ?? id;
}

export function slotsAlive(state: GameState): Slot[] {
  const out: Slot[] = [];
  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] === 'active') out.push(slot);
  }
  return out;
}
