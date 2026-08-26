/**
 * Setup and the small helpers every other file needs.
 *
 * Pure: the deal comes from `substream(seed, 'setup')`, so a game is replayable
 * from its seed and nothing else.
 */

import { substream } from '../rng.js';
import { BLACK, RED, buildDeck, cardValue, isJoker, type Card, type Suit } from './cards.js';
import type { SacrePlayer, SacreState, Slot } from './types.js';

/** Cards from pile 3 per player. Piles 1 and 2 always give one each. */
const PILE3_BY_PLAYERS: Record<number, number> = { 2: 13, 3: 10, 4: 8, 5: 7, 6: 6, 7: 5 };

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 7;
export const ROUNDS = 8;
/** Under this many cards, a hand goes face-up and its seat is done. */
export const MIN_HAND = 3;
export const DEFAULT_TURN_SECONDS = 120;

export function dealSize(players: number): number {
  return 2 + PILE3_BY_PLAYERS[players];
}

/** Half the deal, rounded up -- the most a Cycle may move. */
export function maxCycleQuantity(players: number): number {
  return Math.ceil(dealSize(players) / 2);
}

export function emptyState(seed: string, players: number, turnSeconds: number): SacreState {
  return {
    phase: 'lobby',
    players: Array.from({ length: players }, (_, slot) => ({
      slot,
      hand: [],
      score: 0,
      out: false,
      scored: [],
    })),
    deck: [],
    round: 0,
    active: 0,
    turnPhase: 'choosing',
    pending: null,
    bonusPending: false,
    turnSpent: false,
    lastCycleSlot: null,
    revealed: {},
    turn: 0,
    prevTurnOf: Array.from({ length: players }, () => -1),
    phaseEndsAt: null,
    turnSeconds,
    log: [],
    seed,
  };
}

/**
 * Split into the four piles, deal, and shuffle the remainder into the deck.
 *
 * Piles 1 and 2 hold six cards each -- Q, K, A across two suits -- and every
 * player takes one from each, so a full table is one short. That is exactly why
 * the rules move a Joker into each pile at seven players instead of leaving both
 * in pile 4.
 */
export function deal(state: SacreState, nowMs: number): SacreState {
  const players = state.players.length;
  const rng = substream(state.seed, 'setup');
  const deck = buildDeck();

  const isHigh = (c: Card): boolean => c.rank !== null && c.rank >= 12;
  const jokers = deck.filter((c) => c.rank === null);
  const full = players === MAX_PLAYERS;
  const red = deck.filter((c) => isHigh(c) && RED.includes(c.suit as Suit));
  const black = deck.filter((c) => isHigh(c) && BLACK.includes(c.suit as Suit));

  const pile1 = rng.shuffle(full ? [...red, jokers[0]] : red);
  const pile2 = rng.shuffle(full ? [...black, jokers[1]] : black);
  const pile3 = rng.shuffle(deck.filter((c) => c.rank !== null && c.rank <= 10));
  const pile4 = deck.filter((c) => c.rank === 11 || (c.rank === null && !full));

  const perPlayer = PILE3_BY_PLAYERS[players];
  const dealt: SacrePlayer[] = state.players.map((p) => {
    const hand = [pile1.shift() as Card, pile2.shift() as Card];
    for (let i = 0; i < perPlayer; i++) hand.push(pile3.shift() as Card);
    return { ...p, hand };
  });

  return {
    ...state,
    phase: 'playing',
    players: dealt,
    deck: rng.shuffle([...pile1, ...pile2, ...pile3, ...pile4]),
    round: 1,
    active: 0,
    turnPhase: 'choosing',
    bonusPending: false,
    turnSpent: false,
    phaseEndsAt: nowMs + state.turnSeconds * 1000,
    log: [`Dealt ${dealSize(players)} cards each. Round 1.`],
  };
}

export function cloneSacre(state: SacreState): SacreState {
  return JSON.parse(JSON.stringify(state)) as SacreState;
}

export const playerAt = (state: SacreState, slot: Slot): SacrePlayer | undefined =>
  state.players[slot];

/** Everyone still taking turns. */
export const live = (state: SacreState): SacrePlayer[] => state.players.filter((p) => !p.out);

export function findCard(hand: readonly Card[], id: string): Card | undefined {
  return hand.find((c) => c.id === id);
}

export function removeCards(hand: Card[], ids: readonly string[]): Card[] {
  const out = hand.slice();
  for (const id of ids) {
    const i = out.findIndex((c) => c.id === id);
    if (i >= 0) out.splice(i, 1);
  }
  return out;
}

/** Worst-first: off-suit before on-suit, cheap before dear, jokers last. */
export function worstFirst(hand: readonly Card[], suit: Suit | null): Card[] {
  return hand.slice().sort((a, b) => {
    if (isJoker(a) !== isJoker(b)) return isJoker(a) ? 1 : -1;
    const onA = a.suit === suit ? 1 : 0;
    const onB = b.suit === suit ? 1 : 0;
    if (onA !== onB) return onA - onB;
    return cardValue(a) - cardValue(b);
  });
}

/** The suit a hand already has the most value in. */
export function richestSuit(hand: readonly Card[]): Suit | null {
  const totals = new Map<Suit, number>();
  for (const c of hand) {
    if (c.suit === null) continue;
    totals.set(c.suit, (totals.get(c.suit) ?? 0) + cardValue(c));
  }
  let best: Suit | null = null;
  let bestTotal = -1;
  for (const [suit, total] of totals) {
    if (total > bestTotal) {
      best = suit;
      bestTotal = total;
    }
  }
  return best;
}

/** Highest score wins; a tie goes to whoever is latest in turn order. */
export function winnerOf(state: SacreState): Slot {
  let winner = 0;
  state.players.forEach((p) => {
    if (p.score >= state.players[winner].score) winner = p.slot;
  });
  return winner;
}
