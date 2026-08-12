/**
 * The Tiers contest.
 *
 * Where the Pact is a loyalty game, Tiers is a legibility game. Each turn,
 * blind and simultaneous with orders, every player writes a six-entry tier
 * list for the turn's topic and may reorder up to two rivals' *previous* lists
 * as they believe the authors wrote them. Lists are pipelined: written on turn
 * N, published shuffled in the turn-N report, guessed during turn N+1, revealed
 * and scored at turn-N+1 resolution.
 *
 * Reading someone well pays you; being read well pays the author too — an
 * illegible list denies rivals points but earns its author nothing, so being
 * knowable is a mutual good. A wild guess costs: guessing is a wager, not free
 * upside.
 *
 * Resolution draws no randomness; the only seeded step is the presentation
 * shuffle applied when a new list is installed.
 */

import { substream } from '../rng.js';
import type {
  GameState,
  Slot,
  TiersGuess,
  TiersGuessResult,
  TiersList,
  TiersOrders,
  TiersResult,
} from '../types.js';
import type { ContestContext, ContestOutcome } from './types.js';

export const TIERS_LIST_SIZE = 6;
export const TIERS_MAX_GUESSES = 2;
export const TIERS_MAX_ITEM_LENGTH = 60;

/** Per item: exact tier and one-tier-off points. */
const EXACT_POINTS = 2;
const ADJACENT_POINTS = 1;
/** A guess scoring this breaks even; below it, guessing was a losing wager. */
const NEUTRAL_SCORE = 6;
/** Multiplier points per point of guess score above or below neutral. */
const GUESS_WEIGHT = 2;
const MIN_MULTIPLIER = 80;
const MAX_MULTIPLIER = 140;

/**
 * Collapses an entry to its identity: lowercased, accents folded, everything
 * that is not a letter or digit removed — "McDonald's" and "mcdonalds" are the
 * same item. Used for duplicate detection and bot popularity lookups, never
 * for display.
 */
export function normalizeItemText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Validates a raw list submission. Returns the six entries with display
 * whitespace tidied (trimmed, inner runs collapsed) — the author's casing and
 * punctuation are preserved for display — or null if the submission is not six
 * distinct, non-empty, reasonably-sized entries.
 */
export function normalizeTiersList(list: unknown): string[] | null {
  if (!Array.isArray(list) || list.length !== TIERS_LIST_SIZE) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== 'string') return null;
    const display = raw.trim().replace(/\s+/g, ' ');
    if (display.length === 0 || display.length > TIERS_MAX_ITEM_LENGTH) return null;
    const key = normalizeItemText(display);
    if (key.length === 0 || seen.has(key)) return null;
    seen.add(key);
    out.push(display);
  }
  return out;
}

/** Builds the stored list: normalized items plus the seeded presentation shuffle. */
export function makeTiersList(
  list: unknown,
  seed: string,
  writeTurn: number,
  slot: Slot,
): TiersList | null {
  const items = normalizeTiersList(list);
  if (items === null) return null;
  const positions = Array.from({ length: TIERS_LIST_SIZE }, (_, i) => i);
  return { items, shuffle: substream(seed, 'tiers-shuffle', writeTurn, slot).shuffle(positions) };
}

function isPermutation(order: unknown): order is number[] {
  if (!Array.isArray(order) || order.length !== TIERS_LIST_SIZE) return false;
  const seen = new Set<number>();
  for (const value of order) {
    if (!Number.isInteger(value) || value < 0 || value >= TIERS_LIST_SIZE || seen.has(value)) {
      return false;
    }
    seen.add(value);
  }
  return true;
}

/** Scores one guess against the author's true ordering. 0–12. */
export function scoreGuess(list: TiersList, order: readonly number[]): number {
  let score = 0;
  for (let tier = 0; tier < TIERS_LIST_SIZE; tier++) {
    const trueTier = list.shuffle[order[tier]];
    const diff = Math.abs(trueTier - tier);
    score += diff === 0 ? EXACT_POINTS : diff === 1 ? ADJACENT_POINTS : 0;
  }
  return score;
}

export function resolveTiers(
  state: GameState,
  inputs: readonly (TiersOrders | null | undefined)[],
  _context: ContestContext,
): ContestOutcome<TiersResult> {
  const playerCount = state.playerCount;

  // Normalise: like the Pact, bad input is an abstention, never an error.
  const validGuesses: TiersGuess[][] = Array.from({ length: playerCount }, () => []);
  for (let slot = 0; slot < playerCount; slot++) {
    if (state.status[slot] !== 'active') continue;
    const seen = new Set<Slot>();
    for (const guess of inputs[slot]?.guesses ?? []) {
      if (validGuesses[slot].length >= TIERS_MAX_GUESSES) break;
      const target = guess?.target;
      if (!Number.isInteger(target) || target < 0 || target >= playerCount) continue;
      if (target === slot || seen.has(target)) continue;
      if (state.status[target] !== 'active') continue;
      if (state.tiersLists[target] === null) continue;
      if (!isPermutation(guess.order)) continue;
      seen.add(target);
      validGuesses[slot].push({ target, order: guess.order.slice() });
    }
  }

  // Score every guess; track the best read of each author. Iterating guessers
  // in slot order makes the strictly-greater comparison a deterministic
  // lowest-slot tie-break.
  const guessResults: TiersGuessResult[][] = Array.from({ length: playerCount }, () => []);
  const bestRead: (TiersGuessResult | null)[] = new Array(playerCount).fill(null);
  for (let slot = 0; slot < playerCount; slot++) {
    for (const guess of validGuesses[slot]) {
      const list = state.tiersLists[guess.target];
      if (list === null) continue;
      const result: TiersGuessResult = {
        guesser: slot,
        target: guess.target,
        score: scoreGuess(list, guess.order),
      };
      guessResults[slot].push(result);
      const incumbent = bestRead[guess.target];
      if (incumbent === null || result.score > incumbent.score) bestRead[guess.target] = result;
    }
  }

  const multiplier: number[] = new Array(playerCount).fill(100);
  const bonusIncome: number[] = new Array(playerCount).fill(0);
  const results: TiersResult[] = [];

  for (let slot = 0; slot < playerCount; slot++) {
    if (state.status[slot] !== 'active') continue;

    const guessContribution = guessResults[slot].reduce(
      (sum, guess) => sum + (guess.score - NEUTRAL_SCORE) * GUESS_WEIGHT,
      0,
    );
    // Being read well pays; being read badly costs the author nothing.
    const authorBonus = Math.max(0, (bestRead[slot]?.score ?? 0) - NEUTRAL_SCORE);
    multiplier[slot] = Math.min(
      MAX_MULTIPLIER,
      Math.max(MIN_MULTIPLIER, 100 + guessContribution + authorBonus),
    );

    results.push({
      slot,
      revealed: state.tiersLists[slot]?.items.slice() ?? null,
      guesses: guessResults[slot],
      bestRead: bestRead[slot],
      multiplier: multiplier[slot],
    });
  }

  return { multiplier, bonusIncome, results };
}

/**
 * Installs the lists written this turn, replacing the ones just scored. The
 * tiers analogue of `applyPactRecord`. A missing or malformed list simply makes
 * its author unguessable next turn.
 */
export function applyTiersRecord(
  next: GameState,
  inputs: readonly (TiersOrders | null | undefined)[],
  seed: string,
  writeTurn: number,
): void {
  for (let slot = 0; slot < next.playerCount; slot++) {
    next.tiersLists[slot] =
      next.status[slot] === 'active'
        ? makeTiersList(inputs[slot]?.list ?? null, seed, writeTurn, slot)
        : null;
  }
}

/** Human-readable submission feedback for the server; resolution never warns. */
export function tiersWarnings(
  state: GameState,
  slot: Slot,
  tiers: TiersOrders | null | undefined,
): string[] {
  const warnings: string[] = [];
  if (!tiers || normalizeTiersList(tiers.list) === null) {
    warnings.push(
      'tier list incomplete — six distinct entries needed, or rivals cannot read you next turn',
    );
  }
  const guesses = tiers?.guesses ?? [];
  if (guesses.length > TIERS_MAX_GUESSES) {
    warnings.push(`only your first ${TIERS_MAX_GUESSES} guesses count`);
  }
  const seen = new Set<Slot>();
  for (const guess of guesses.slice(0, TIERS_MAX_GUESSES)) {
    const target = guess?.target;
    const badTarget =
      !Number.isInteger(target) ||
      target < 0 ||
      target >= state.playerCount ||
      target === slot ||
      seen.has(target) ||
      state.status[target] !== 'active' ||
      state.tiersLists[target] === null;
    if (badTarget) {
      warnings.push(`guess ${seen.size + 1} dropped: no guessable list for that target`);
      continue;
    }
    seen.add(target);
    if (!isPermutation(guess.order)) {
      warnings.push(`guess on seat ${target + 1} dropped: incomplete ordering`);
    }
  }
  return warnings;
}
