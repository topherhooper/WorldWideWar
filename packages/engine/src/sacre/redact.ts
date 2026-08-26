/**
 * The only path state takes to a client.
 *
 * A hand is the most secret thing this site has ever held, and this mode has
 * three separate disclosure rules rather than one:
 *
 * 1. Normally you see your own hand and nobody else's.
 * 2. **Round 8 flips every hand and the deck face-up**, for everyone. That makes
 *    redaction a mode rather than a filter -- it has to know what round it is.
 * 3. Advertise's answers are face-down. They reach the advertiser, and only once
 *    every seat has answered; and a seat with nothing eligible proves it by
 *    showing that one player its hand.
 *
 * A player who is out plays face-up too, which is rule 1 with an exception the
 * rules sheet states outright.
 */

import { ROUNDS } from './state.js';
import { checkRun } from './rules.js';
import type { Card } from './cards.js';
import type { SacreOption, SacrePhase, SacreState, ScoredRun, Slot, TurnPhase } from './types.js';

export interface SeatView {
  slot: Slot;
  score: number;
  cards: number;
  out: boolean;
  scored: ScoredRun[];
  /** Present only when this seat is legitimately face-up to the viewer. */
  hand?: Card[];
}

export interface PendingView {
  kind: 'advertise' | 'cycle';
  by: Slot;
  /** Advertise only: the face-up card on offer. */
  offered?: Card;
  floor?: number;
  quantity?: number;
  offset?: number;
  /** Seats still owing an answer -- public, so the table knows who to chase. */
  owed: Slot[];
  /** Advertise only, advertiser only, once everyone has answered. */
  responses?: { slot: Slot; card: Card }[];
  /** Advertise only, advertiser only: hands shown as proof of nothing eligible. */
  proofs?: { slot: Slot; hand: Card[] }[];
  /** Does the viewer owe an answer right now? */
  youOwe: boolean;
}

export interface SacreView {
  phase: SacrePhase;
  round: number;
  rounds: number;
  active: Slot;
  turnPhase: TurnPhase;
  /** Round 8 only: the active seat still owes itself a free Score. */
  bonusPending: boolean;
  seats: SeatView[];
  pending: PendingView | null;
  phaseEndsAt: number | null;
  log: string[];
  deckCount: number;
  /** Face-up only in round 8. */
  deck?: Card[];
  /** The viewer's seat, or null for a spectator. */
  you: Slot | null;
  yourHand: Card[];
  /** What the viewer may do right now, so the client renders no dead buttons. */
  options: SacreOption[];
  winner: Slot | null;
}

const faceUpRound = (state: SacreState): boolean => state.round >= ROUNDS;

/** Is there any legal run at all in this hand? */
const anyRunIn = (hand: readonly Card[]): boolean =>
  hand.some((_, i) =>
    hand.some((__, j) =>
      hand.some(
        (___, k) => i !== j && j !== k && i !== k && checkRun([hand[i], hand[j], hand[k]]).ok,
      ),
    ),
  );

/** Which of the five the viewer can legally pick this instant. */
export function optionsFor(state: SacreState, slot: Slot | null): SacreOption[] {
  if (slot === null || state.phase !== 'playing') return [];
  if (state.active !== slot || state.turnPhase !== 'choosing') return [];
  if (state.players[slot].out) return [];

  const hand = state.players[slot].hand;

  // Round 8's free Score: the seat has already taken its option, so the only
  // thing left to it is the bonus.
  if (state.bonusPending) return anyRunIn(hand) ? ['score'] : [];

  const options: SacreOption[] = ['return', 'exchange'];
  if (anyRunIn(hand)) options.unshift('score');

  const others = state.players.filter((p) => p.slot !== slot && !p.out && p.hand.length > 0);
  if (others.length > 0 && hand.some((c) => c.rank !== null)) options.push('advertise');
  if (state.round < ROUNDS && others.length >= 1) options.push('cycle');

  return options;
}

export function redactSacre(state: SacreState, viewer: Slot | null): SacreView {
  const faceUp = faceUpRound(state);

  const seats: SeatView[] = state.players.map((p) => {
    const visible = faceUp || p.out || p.slot === viewer;
    return {
      slot: p.slot,
      score: p.score,
      cards: p.hand.length,
      out: p.out,
      scored: p.scored,
      ...(visible ? { hand: p.hand } : {}),
    };
  });

  let pending: PendingView | null = null;
  if (state.pending !== null) {
    const base = {
      by: state.pending.by,
      owed: state.pending.owed,
      youOwe: viewer !== null && state.pending.owed.includes(viewer),
    };
    if (state.pending.kind === 'advertise') {
      const mine = viewer !== null && viewer === state.pending.by;
      const settled = state.pending.owed.length === 0;
      pending = {
        kind: 'advertise',
        offered: state.pending.offered,
        floor: state.pending.floor,
        ...base,
        // Face-down until the last answer lands, and never to anyone else.
        ...(mine && settled
          ? {
              responses: state.pending.responses,
              proofs: state.pending.passed.map((slot) => ({
                slot,
                hand: state.players[slot].hand,
              })),
            }
          : {}),
      };
    } else {
      pending = {
        kind: 'cycle',
        quantity: state.pending.quantity,
        offset: state.pending.offset,
        ...base,
      };
    }
  }

  return {
    phase: state.phase,
    round: state.round,
    rounds: ROUNDS,
    active: state.active,
    turnPhase: state.turnPhase,
    bonusPending: state.bonusPending,
    seats,
    pending,
    phaseEndsAt: state.phaseEndsAt,
    log: state.log,
    deckCount: state.deck.length,
    ...(faceUp ? { deck: state.deck } : {}),
    you: viewer,
    yourHand: viewer === null ? [] : state.players[viewer].hand,
    options: optionsFor(state, viewer),
    winner: state.phase === 'over' ? winnerSlot(state) : null,
  };
}

function winnerSlot(state: SacreState): Slot {
  let winner = 0;
  state.players.forEach((p) => {
    if (p.score >= state.players[winner].score) winner = p.slot;
  });
  return winner;
}
