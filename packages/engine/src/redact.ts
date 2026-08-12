/**
 * The single choke point through which game state reaches a player.
 *
 * Nothing else may serialise a `GameState` outward. Concentrating it here means
 * there is exactly one function to audit, and one place for a property test to
 * assert that what a viewer receives is a subset of what they are entitled to.
 *
 * Note what is *not* handled here: pending orders and pledges are not part of
 * `GameState` at all. They are never redacted because they are never present —
 * the resolver reads them straight from storage, and no read path from the
 * outside world can reach them. That is a stronger guarantee than filtering.
 *
 * Default visibility is deliberately Risk-like: ownership and army counts are
 * public, and the secrecy lives in the orders. Resolved pact history is public
 * on purpose — it *is* the reputation system, and hiding it would collapse the
 * dilemma back to one-shot.
 */

import { fogActive } from './events.js';
import type { GameState, Slot } from './types.js';

/** Army count reported for a territory whose strength is hidden. */
export const HIDDEN_ARMIES = -1;

/**
 * @param viewer The slot receiving this state, or null for a spectator.
 */
export function redact(state: GameState, viewer: Slot | null): GameState {
  const out = cloneShallow(state);

  // Tier-list orderings are secret regardless of fog: rivals and spectators get
  // the items in public (shuffled) order with an identity shuffle, so the true
  // ordering is unrecoverable. Authors keep their own.
  out.tiersLists = state.tiersLists.map((list, slot) => {
    if (list === null) return null;
    if (viewer === slot) return { items: list.items.slice(), shuffle: list.shuffle.slice() };
    return {
      items: list.shuffle.map((authorIndex) => list.items[authorIndex]),
      shuffle: list.shuffle.map((_, position) => position),
    };
  });

  if (!fogActive(state)) return out;

  // Fog hides strength, never ownership: you can still see who holds what, you
  // just cannot count what is standing on it.
  out.armies = state.armies.map((count, id) =>
    viewer !== null && state.owner[id] === viewer ? count : HIDDEN_ARMIES,
  );

  return out;
}

/** Is any strength hidden from this viewer? */
export function isRedacted(state: GameState): boolean {
  return state.armies.some((count) => count === HIDDEN_ARMIES);
}

function cloneShallow(state: GameState): GameState {
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
