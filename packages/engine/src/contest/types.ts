/**
 * The contest interface.
 *
 * A contest takes each player's blind, pre-committed input and produces the
 * combat multiplier they carry into every battle that turn. Pact is the only
 * implementation shipped; the interface exists so a second one can drop in
 * without the resolution pipeline learning anything about it.
 *
 * Two properties any contest must hold:
 *
 * 1. **Pre-committed.** Input arrives alongside orders, before anyone knows
 *    which battles will happen. That is what keeps resolution a single atomic
 *    pure function — a contest needing a second round of input would double
 *    turn latency and let one absent player stall everyone else's battle.
 * 2. **Deterministic given (state, inputs, rng).** Replays depend on it.
 */

import type { GameState, Slot } from '../types.js';

export interface ContestOutcome<Result> {
  /** Combat multiplier per slot, ×100. */
  multiplier: number[];
  /** Extra income granted next turn, per slot. */
  bonusIncome: number[];
  /** Per-slot detail for the turn report. */
  results: Result[];
}

export interface Contest<Input, Result> {
  readonly id: string;
  resolve(state: GameState, inputs: (Input | null)[], context: ContestContext): ContestOutcome<Result>;
}

export interface ContestContext {
  /** `attacked[a][b]` — did slot a order an attack on slot b this turn? */
  attacked: boolean[][];
  aliveSlots: Slot[];
}
