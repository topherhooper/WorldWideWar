/**
 * What is legal, separated from what happens.
 *
 * Two rules here were left unimplemented by the prototype and cannot be
 * hand-waved by a mode people actually play: "extending an already scored set"
 * and the one about a Score that forecloses your own win.
 */

import { nextRank, value, type Card, type Suit } from './cards.js';
import { MIN_HAND } from './state.js';
import type { SacrePlayer, SacreState, ScoredRun, Slot } from './types.js';

export interface RunCheck {
  ok: boolean;
  points: number;
  suit: Suit | null;
  ranks: number[];
  why?: string;
}

/**
 * Is this exact list of cards, in this order, a legal run?
 *
 * The player picks the cards and the order, so unlike the bot harness this
 * validates rather than searches. Jokers stand in for whatever rank the position
 * needs and score nothing.
 */
export function checkRun(cards: readonly Card[]): RunCheck {
  const fail = (why: string): RunCheck => ({ ok: false, points: 0, suit: null, ranks: [], why });
  if (cards.length < 3) return fail('A sequence has to be at least 3 cards.');

  const suit = cards.find((c) => c.suit !== null)?.suit ?? null;
  if (suit === null) return fail('A sequence of nothing but Jokers has no suit.');
  if (cards.some((c) => c.suit !== null && c.suit !== suit)) {
    return fail('Every card in a sequence has to be the same suit.');
  }

  // Anchor on the first real card and walk outwards, so leading Jokers get the
  // rank the position implies rather than a rank of their own.
  const firstReal = cards.findIndex((c) => c.rank !== null);
  let rank = cards[firstReal].rank as number;
  for (let i = firstReal; i > 0; i--) rank = rank === 2 ? 14 : rank - 1;

  const ranks: number[] = [];
  let points = 0;
  for (const card of cards) {
    if (card.rank !== null && card.rank !== rank) {
      return fail('Those cards are not consecutive.');
    }
    ranks.push(rank);
    if (card.rank !== null) points += value(rank);
    rank = nextRank(rank);
  }

  if (new Set(ranks).size !== ranks.length) return fail('A sequence cannot loop past itself.');
  return { ok: true, points, suit, ranks };
}

/**
 * "Extending an already scored set is not allowed."
 *
 * Read narrowly: a new run may not butt up against one you already laid down in
 * the same suit at either end. The wide reading -- any second run in a suit you
 * have scored -- would forbid the deck's own advice to commit to a suit, so the
 * narrow one is what the sentence has to mean.
 */
export function extendsScored(player: SacrePlayer, suit: Suit, ranks: readonly number[]): boolean {
  const before = ranks[0] === 2 ? 14 : ranks[0] - 1;
  const after = nextRank(ranks[ranks.length - 1]);
  return player.scored.some(
    (run: ScoredRun) =>
      run.suit === suit && (run.ranks.includes(before) || run.ranks.includes(after)),
  );
}

export const leaderExcluding = (state: SacreState, slot: Slot): number =>
  state.players.reduce((best, p) => (p.slot === slot ? best : Math.max(best, p.score)), 0);

/**
 * "Scoring a sequence that precludes winning is not allowed."
 *
 * Not a solver. A Score only forecloses anything when it ends your game -- under
 * `MIN_HAND` cards, hand face-up, no more turns -- so that is the only case it
 * has to catch, and then the test is simply whether it leaves you in front.
 */
export function scoreForeclosesWin(state: SacreState, slot: Slot, spent: number, points: number) {
  const player = state.players[slot];
  if (player.hand.length - spent >= MIN_HAND) return false;
  return player.score + points <= leaderExcluding(state, slot);
}

/** Cycle is barred in round 8, and barred twice running. */
export function cycleAllowed(state: SacreState, slot: Slot): { ok: boolean; why?: string } {
  if (state.round === 8) return { ok: false, why: 'Cycle is not available in the last round.' };
  const previous = previousActive(state, slot);
  if (previous !== null && state.lastCycleSlot === previous) {
    return { ok: false, why: 'The player before you cycled, so you cannot.' };
  }
  return { ok: true };
}

/** The seat before this one that still holds more than 2 cards. */
export function previousActive(state: SacreState, slot: Slot): Slot | null {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const s = (slot - step + n * 2) % n;
    if (state.players[s].hand.length > 2) return s;
  }
  return null;
}

/** Advertise: equal or greater potential scoring value, and never a Joker. */
export const eligibleFor = (hand: readonly Card[], floor: number): Card[] =>
  hand.filter((c) => c.rank !== null && value(c.rank) >= floor);
