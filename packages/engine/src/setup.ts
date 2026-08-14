/** Builds the opening position from a generated map. */

import { CAPITAL_START_ARMIES, DEFAULT_RULES, TERRITORY_START_ARMIES } from './constants.js';
import { recomputeIncome } from './income.js';
import { recomputeSupply } from './supply.js';
import type { GameState, GeneratedMap, RuleConfig, TiersList } from './types.js';

export function createInitialState(
  map: GeneratedMap,
  rules: RuleConfig = DEFAULT_RULES,
): GameState {
  const territoryCount = map.territories.length;
  const playerCount = map.playerCount;

  const state: GameState = {
    turn: 1,
    playerCount,

    owner: new Array<number | null>(territoryCount).fill(null),
    armies: new Array<number>(territoryCount).fill(0),
    collapsed: new Array<boolean>(territoryCount).fill(false),
    supplied: new Array<boolean>(territoryCount).fill(false),

    status: new Array<'active'>(playerCount).fill('active'),
    capital: new Array<number | null>(playerCount).fill(null),
    income: new Array<number>(playerCount).fill(0),
    eliminatedTurn: new Array<number | null>(playerCount).fill(null),

    pactsHonored: new Array<number>(playerCount).fill(0),
    pactsBroken: new Array<number>(playerCount).fill(0),
    betrayedBy: Array.from({ length: playerCount }, () => new Array<number>(playerCount).fill(0)),
    pactPartner: new Array<number | null>(playerCount).fill(null),
    pactStreak: new Array<number>(playerCount).fill(0),
    concordAt: Array.from({ length: playerCount }, () => new Array<number>(playerCount).fill(-1)),
    hegemonyStreak: new Array<number>(playerCount).fill(0),
    decapitationStreak: new Array<number>(playerCount).fill(0),
    tiersLists: new Array<TiersList | null>(playerCount).fill(null),

    activeEvent: null,
    pendingEvent: null,
    usedEvents: [],
    fogUntilTurn: 0,
    wavesCollapsed: 0,
    pendingBonusIncome: new Array<number>(playerCount).fill(0),

    result: null,
  };

  for (const start of map.starts) {
    state.owner[start.capital] = start.slot;
    state.armies[start.capital] = CAPITAL_START_ARMIES;
    state.capital[start.slot] = start.capital;

    for (const id of start.extra) {
      state.owner[id] = start.slot;
      state.armies[id] = TERRITORY_START_ARMIES;
    }
  }

  for (const [id, garrison] of Object.entries(map.neutralGarrisons)) {
    const territory = Number(id);
    if (state.owner[territory] === null) {
      state.armies[territory] = Math.max(1, garrison + rules.neutralGarrisonDelta);
    }
  }

  recomputeSupply(state, map);
  recomputeIncome(state, map, rules);

  return state;
}

/**
 * Deep copy of a state.
 *
 * Resolution never mutates its input: phases read a frozen snapshot and write
 * into a fresh state, which is what makes simultaneity a mechanical guarantee
 * rather than a matter of care, and what lets a crashed resolution simply be
 * re-run.
 */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    owner: state.owner.slice(),
    armies: state.armies.slice(),
    collapsed: state.collapsed.slice(),
    supplied: state.supplied.slice(),
    status: state.status.slice(),
    capital: state.capital.slice(),
    income: state.income.slice(),
    eliminatedTurn: state.eliminatedTurn.slice(),
    pactsHonored: state.pactsHonored.slice(),
    pactsBroken: state.pactsBroken.slice(),
    betrayedBy: state.betrayedBy.map((row) => row.slice()),
    pactPartner: state.pactPartner.slice(),
    pactStreak: state.pactStreak.slice(),
    concordAt: state.concordAt.map((row) => row.slice()),
    hegemonyStreak: state.hegemonyStreak.slice(),
    decapitationStreak: state.decapitationStreak.slice(),
    tiersLists: state.tiersLists.map((list) =>
      list === null ? null : { items: list.items.slice(), shuffle: list.shuffle.slice() },
    ),
    usedEvents: state.usedEvents.slice(),
    pendingBonusIncome: state.pendingBonusIncome.slice(),
    result: state.result
      ? {
          ...state.result,
          winners: [...state.result.winners],
          standings: [...state.result.standings],
        }
      : null,
  };
}
