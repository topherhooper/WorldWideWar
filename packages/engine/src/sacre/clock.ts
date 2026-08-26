/**
 * The clock. Advanced on every read, swept by tick.ts as a backstop.
 *
 * A live table cannot be driven by a once-a-minute sweep, so the same lazy
 * advance the dinner party uses applies here: any request rolls the clock
 * forward first, and the sweep only exists for a room that has pocketed its
 * phones.
 *
 * The whole reason this is more than a countdown is that Advertise and Cycle
 * wait on other people. **When the clock runs out, a missing answer is filled
 * in rather than stalling the table** -- the cheapest eligible card for an
 * Advertise, the worst cards for a Cycle. That is the same instinct as the
 * war game's "invalid input degrades, never throws": one person putting their
 * phone down must not end everyone else's evening.
 */

import { eligibleFor } from './rules.js';
import { ROUNDS, live, richestSuit, winnerOf, worstFirst } from './state.js';
import { pass, proveEmpty, respond, settleAdvertise, settleCycle } from './actions.js';
import type { SacreState, Slot } from './types.js';

export interface Advanced {
  state: SacreState;
  changed: boolean;
}

/** Is the pending fully answered? */
export const pendingSettled = (state: SacreState): boolean =>
  state.pending !== null && state.pending.owed.length === 0;

/** Fill in every unanswered seat, then settle. */
function forceSettle(state: SacreState): SacreState {
  const pending = state.pending;
  if (pending === null) return state;

  let next = state;
  if (pending.kind === 'advertise') {
    for (const slot of [...pending.owed]) {
      const hand = next.players[slot].hand;
      const eligible = eligibleFor(hand, pending.floor);
      if (eligible.length === 0) {
        next = proveEmpty(next, slot).state;
      } else {
        const cheapest = eligible.reduce((a, b) =>
          (a.rank as number) <= (b.rank as number) ? a : b,
        );
        next = respond(next, slot, cheapest.id).state;
      }
    }
    return settleAdvertise(next, null);
  }

  for (const slot of [...pending.owed]) {
    const hand = next.players[slot].hand;
    const give = worstFirst(hand, richestSuit(hand)).slice(0, pending.quantity);
    next = pass(
      next,
      slot,
      give.map((c) => c.id),
    ).state;
  }
  return settleCycle(next);
}

/** Settle a fully-answered pending without waiting for the clock. */
export function settlePending(state: SacreState, choice: Slot | null = null): SacreState {
  if (state.pending === null) return state;
  return state.pending.kind === 'advertise' ? settleAdvertise(state, choice) : settleCycle(state);
}

/** The next seat still holding cards, or null if the round is done. */
function nextSeat(state: SacreState, from: Slot): Slot | null {
  for (let slot = from + 1; slot < state.players.length; slot++) {
    if (!state.players[slot].out) return slot;
  }
  return null;
}

/** Hand the turn on, rolling the round over and ending the game after round 8. */
export function endTurn(state: SacreState, nowMs: number): SacreState {
  const finished = {
    ...state,
    prevTurnOf: state.prevTurnOf.map((prev, i) => (i === state.active ? state.turn : prev)),
    turn: state.turn + 1,
    pending: null,
    turnPhase: 'choosing' as const,
  };

  const next = nextSeat(finished, finished.active);
  if (next !== null) {
    return { ...finished, active: next, phaseEndsAt: nowMs + finished.turnSeconds * 1000 };
  }

  if (finished.round >= ROUNDS || live(finished).length === 0) {
    const winner = winnerOf(finished);
    return {
      ...finished,
      phase: 'over',
      phaseEndsAt: null,
      log: [...finished.log, `P${winner} wins. Everyone else: "Sacre bleu!"`].slice(-60),
    };
  }

  const first = nextSeat({ ...finished, active: -1 }, -1);
  if (first === null) {
    return { ...finished, phase: 'over', phaseEndsAt: null };
  }
  const round = finished.round + 1;
  return {
    ...finished,
    round,
    active: first,
    phaseEndsAt: nowMs + finished.turnSeconds * 1000,
    log: [
      ...finished.log,
      round === ROUNDS ? 'Round 8: hands face-up, no Cycle, bonus scoring.' : `Round ${round}.`,
    ].slice(-60),
  };
}

/**
 * Roll the clock forward to `nowMs`.
 *
 * Loops, because one expiry can cascade: a pending times out, its turn ends, and
 * the next seat's turn may already have expired too if nobody has read the game
 * in a while.
 */
export function advanceSacre(state: SacreState, nowMs: number): Advanced {
  if (state.phase !== 'playing') return { state, changed: false };

  let next = state;
  let changed = false;

  for (let guard = 0; guard < 64; guard++) {
    if (next.phase !== 'playing') break;

    if (next.pending !== null && pendingSettled(next)) {
      next = endTurn(settlePending(next), nowMs);
      changed = true;
      continue;
    }
    if (next.phaseEndsAt !== null && nowMs >= next.phaseEndsAt) {
      // A seat that let its turn expire simply loses it; a pending gets filled.
      next = endTurn(next.pending !== null ? forceSettle(next) : next, nowMs);
      changed = true;
      continue;
    }
    break;
  }

  return { state: next, changed };
}
