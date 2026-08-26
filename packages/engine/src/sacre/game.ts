/**
 * The headless harness: bots playing the real state machine.
 *
 * This is not a second implementation of the rules. It drives exactly the same
 * `applySacreAction` / `settlePending` / `endTurn` the server drives, which is
 * what makes `pnpm sacre` worth anything -- a game that plays here is a game
 * that plays on the site.
 *
 * Time is pinned at zero throughout. Bots answer immediately, so nothing ever
 * reaches its deadline and the timeout paths are exercised by tests instead.
 */

import { substream, type Rng } from '../rng.js';
import { bestRun, cardName, type Card } from './cards.js';
import { applySacreAction } from './actions.js';
import { advanceSacre, endTurn } from './clock.js';
import { eligibleFor } from './rules.js';
import {
  DEFAULT_TURN_SECONDS,
  ROUNDS,
  deal,
  dealSize,
  emptyState,
  maxCycleQuantity,
  richestSuit,
  winnerOf,
  worstFirst,
} from './state.js';
import { optionsFor } from './redact.js';
import type { SacreAction, SacreState, Slot } from './types.js';

export interface SacreResult {
  readonly lines: string[];
  readonly scores: number[];
  readonly winner: number;
}

/** Candidate actions for a seat, best first. Legality is the engine's problem. */
function candidates(state: SacreState, slot: Slot, rng: Rng): SacreAction[] {
  const hand = state.players[slot].hand;
  const suit = richestSuit(hand);
  const options = optionsFor(state, slot);
  const out: SacreAction[] = [];

  const run = bestRun(hand);
  const worst = worstFirst(hand, suit);

  // The document's own advice: don't Score in your first two turns, and in the
  // last round take a free option first so the bonus Score comes after it.
  const wantScore = run !== null && state.round >= 3 && state.round < ROUNDS && run.points >= 24;
  if (wantScore && options.includes('score')) {
    out.push({ type: 'score', cards: (run as { cards: readonly Card[] }).cards.map((c) => c.id) });
  }

  if (state.round === ROUNDS && options.includes('return')) {
    const give = worst.slice(0, Math.min(3, Math.max(0, hand.length - 3)));
    const want = [...state.deck]
      .sort(
        (a, b) =>
          (b.suit === suit ? 20 : 0) + (b.rank ?? 0) - ((a.suit === suit ? 20 : 0) + (a.rank ?? 0)),
      )
      .slice(0, give.length)
      .map((c) => c.id);
    if (give.length > 0) out.push({ type: 'return', cards: give.map((c) => c.id), want });
  }

  const weak = run === null || run.points < 20;
  if (weak && options.includes('return') && state.deck.length > 0 && rng.int(3) > 0) {
    const give = worst.slice(0, Math.min(3, Math.max(1, hand.length - 3)));
    if (give.length > 0) out.push({ type: 'return', cards: give.map((c) => c.id) });
  }
  if (weak && options.includes('cycle') && rng.bool()) {
    const quantity = 1 + rng.int(maxCycleQuantity(state.players.length));
    out.push({
      type: 'cycle',
      quantity,
      offset: 1 + rng.int(Math.max(1, state.players.length - 1)),
    });
  }
  if (options.includes('advertise') && rng.bool()) {
    const offer = worst.find((c) => c.rank !== null);
    if (offer) out.push({ type: 'advertise', card: offer.id });
  }
  if (options.includes('exchange')) {
    const target = state.players.find((p) => p.slot !== slot && !p.out && p.hand.length > 0);
    if (target && worst.length > 0) {
      out.push({ type: 'exchange', target: target.slot, card: worst[0].id });
    }
  }
  // Always leave something that cannot be refused.
  if (options.includes('return') && hand.length > 0) {
    out.push({ type: 'return', cards: [worst[0].id] });
  }
  if (options.includes('score') && run !== null) {
    out.push({ type: 'score', cards: (run as { cards: readonly Card[] }).cards.map((c) => c.id) });
  }
  return out;
}

/** Every seat that owes an answer gives one. */
function answerPending(state: SacreState): SacreState {
  let next = state;
  for (
    let guard = 0;
    guard < 16 && next.pending !== null && next.pending.owed.length > 0;
    guard++
  ) {
    const pending = next.pending;
    const slot = pending.owed[0];
    const hand = next.players[slot].hand;

    if (pending.kind === 'advertise') {
      const eligible = eligibleFor(hand, pending.floor);
      const action: SacreAction =
        eligible.length > 0
          ? {
              type: 'respond',
              card: eligible.reduce((a, b) => ((a.rank as number) <= (b.rank as number) ? a : b))
                .id,
            }
          : { type: 'respond', card: '' };
      const attempt = applySacreAction(next, action, { slot, nowMs: 0 });
      // No eligible card means proving an empty hand, which respond() refuses.
      next = attempt.changed ? attempt.state : forcePass(next, slot);
    } else {
      const give = worstFirst(hand, richestSuit(hand)).slice(0, pending.quantity);
      const attempt = applySacreAction(
        next,
        { type: 'pass', cards: give.map((c) => c.id) },
        { slot, nowMs: 0 },
      );
      next = attempt.changed ? attempt.state : forcePass(next, slot);
    }
  }
  return next;
}

/** Drop a seat from `owed` when it genuinely cannot answer. */
function forcePass(state: SacreState, slot: Slot): SacreState {
  const pending = state.pending;
  if (pending === null) return state;
  const owed = pending.owed.filter((s) => s !== slot);
  const updated =
    pending.kind === 'advertise'
      ? { ...pending, owed, passed: [...pending.passed, slot] }
      : { ...pending, owed };
  return { ...state, pending: updated };
}

export function playSacreGame(seed: string, players = 4): SacreResult {
  let state = deal(emptyState(seed, players, DEFAULT_TURN_SECONDS), 0);

  const lines: string[] = [
    `S.A.C.R.E. Bleu! -- ${players} players, seed "${seed}"`,
    `Dealt ${dealSize(players)} each; ${state.deck.length} cards left in the deck.`,
    ...state.players.map((p) => `  P${p.slot}: ${p.hand.map(cardName).join(' ')}`),
  ];

  let round = 0;
  for (let guard = 0; guard < 4000 && state.phase === 'playing'; guard++) {
    if (state.round !== round) {
      round = state.round;
      lines.push('');
      lines.push(`-- Round ${round}${round === ROUNDS ? ' (face-up, no Cycle)' : ''} --`);
    }

    const slot = state.active;
    const before = state.log.length;

    if (state.bonusPending) {
      // Round 8's free Score. The engine only offers it when a run exists, but
      // the run can still be refused -- it may extend a set already laid down
      // -- so declining is a real move rather than a stall.
      const bonus = bestRun(state.players[slot].hand);
      const scored =
        bonus === null
          ? { changed: false, state }
          : applySacreAction(
              state,
              { type: 'score', cards: bonus.cards.map((c) => c.id) },
              { slot, nowMs: 0 },
            );
      state = scored.changed
        ? scored.state
        : applySacreAction(state, { type: 'skip' }, { slot, nowMs: 0 }).state;
    } else {
      const rng = substream(seed, 'turn', state.round, slot, state.turn);
      for (const action of candidates(state, slot, rng)) {
        const attempt = applySacreAction(state, action, { slot, nowMs: 0 });
        if (attempt.changed) {
          state = attempt.state;
          break;
        }
      }
      state = answerPending(state);
    }

    // The engine settles the pending and hands the turn on -- the harness does
    // not get its own copy of that logic, which is the point of this file.
    const rolled = advanceSacre(state, 0);
    state = rolled.state;
    if (!rolled.changed && state.active === slot && !state.bonusPending) {
      // Nothing legal happened at all, so spend the turn rather than spin.
      state = endTurn(state, 0);
    }

    for (const line of state.log.slice(before)) lines.push(`  ${line}`);
    if (state.players[slot].out) lines.push(`  P${slot} is under 3 cards -- face-up, out.`);
  }

  const scores = state.players.map((p) => p.score);
  const winner = winnerOf(state);
  lines.push('');
  lines.push(`Final: ${scores.map((s, i) => `P${i}=${s}`).join('  ')}`);
  lines.push(`P${winner} wins. Everyone else: "Sacre bleu!"`);

  return { lines, scores, winner };
}
