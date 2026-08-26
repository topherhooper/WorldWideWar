/**
 * S.A.C.R.E. Bleu! -- the state a live table shares.
 *
 * The war game resolves everyone's orders together on a deadline. This does not:
 * the rules are strictly sequential ("the shortest player goes first and turns
 * rotate to the left"), so one seat acts at a time and the others watch. That
 * makes it the dinner party's shape rather than the war game's -- a live phase
 * machine, advanced on read, with a deadline as the backstop.
 *
 * The awkward part, and the reason a turn is a machine rather than a function:
 * **two of the five options stop mid-turn and wait for everybody else.**
 * Advertise needs a face-down card from each other player; Cycle needs a
 * simultaneous pass. So a turn is `choosing -> awaiting -> over`, and the
 * pending record is what the other seats are answering.
 */

import type { Card, Suit } from './cards.js';

/** A seat index. Stable for the life of the game. */
export type Slot = number;

export type SacrePhase = 'lobby' | 'playing' | 'over';

/** What the seat whose turn it is is doing right now. */
export type TurnPhase = 'choosing' | 'awaiting';

export type SacreOption = 'score' | 'advertise' | 'cycle' | 'return' | 'exchange';

export interface SacrePlayer {
  slot: Slot;
  hand: Card[];
  score: number;
  /**
   * Under 3 cards: the hand goes face-up and the seat skips the rest of the
   * game. One-way -- nothing puts a player back in.
   */
  out: boolean;
  /** Runs already laid down, so "extending an already scored set" can be checked. */
  scored: ScoredRun[];
}

export interface ScoredRun {
  suit: Suit;
  /** Ranks in laid order, so adjacency is checkable at either end. */
  ranks: number[];
  points: number;
}

/**
 * An Advertise in flight.
 *
 * `offered` is public the moment it is placed -- the rules put it face-up. The
 * responses are face-down, so they reach nobody but the advertiser, and only
 * once every seat has answered.
 */
export interface PendingAdvertise {
  kind: 'advertise';
  by: Slot;
  offered: Card;
  /** Minimum scoring value a response must match. */
  floor: number;
  responses: { slot: Slot; card: Card }[];
  /** Seats that proved an empty hand rather than answering. */
  passed: Slot[];
  /** Seats that still owe an answer. */
  owed: Slot[];
}

/** A Cycle in flight: everyone with enough cards passes at once. */
export interface PendingCycle {
  kind: 'cycle';
  by: Slot;
  quantity: number;
  offset: number;
  participants: Slot[];
  passes: { slot: Slot; cards: Card[] }[];
  owed: Slot[];
}

export type Pending = PendingAdvertise | PendingCycle;

export interface SacreState {
  phase: SacrePhase;
  players: SacrePlayer[];
  /** Index 0 is the top. Never leaves the server except in round 8. */
  deck: Card[];
  round: number;
  /** Whose turn it is. */
  active: Slot;
  turnPhase: TurnPhase;
  pending: Pending | null;
  /** Seat that most recently chose Cycle, for the no-twice-in-a-row rule. */
  lastCycleSlot: Slot | null;
  /** Card ids revealed by Exchange, keyed to the global turn they were taken on. */
  revealed: Record<string, number>;
  /** Global turn counter; also what Exchange's "since your prior turn" measures. */
  turn: number;
  /** Per seat, the turn index of that seat's previous turn. */
  prevTurnOf: number[];
  /** When the current phase runs out, or null if nothing is on the clock. */
  phaseEndsAt: number | null;
  /** Seconds a seat gets to act, and a table gets to answer a pending. */
  turnSeconds: number;
  /** Newest last -- what the table reads to follow the game. */
  log: string[];
  seed: string;
}

/** Time arrives as a value. The engine never reads a clock. */
export interface SacreContext {
  slot: Slot | null;
  nowMs: number;
}

export type SacreAction =
  | { type: 'deal' }
  | { type: 'score'; cards: string[] }
  | { type: 'advertise'; card: string }
  | { type: 'cycle'; quantity: number; offset: number }
  | { type: 'return'; cards: string[]; want?: string[] }
  | { type: 'exchange'; target: Slot; card: string }
  /** An answer to somebody else's Advertise. */
  | { type: 'respond'; card: string }
  /** An answer to somebody else's Cycle. */
  | { type: 'pass'; cards: string[] };

export interface SacreResultState {
  state: SacreState;
  changed: boolean;
  /** A sentence the actor can read when nothing happened. */
  message?: string;
}
