/**
 * The Pact.
 *
 * Each turn, blind and simultaneously with orders, every player pledges to one
 * other living player or abstains. The resulting multiplier applies to every
 * battle that player fights that turn.
 *
 * The payoff matrix is a prisoner's dilemma: betraying a partner who honoured
 * you pays best of all. That is deliberate — a dilemma where cooperation
 * strictly dominates is not a dilemma. It only works because the game is
 * *iterated* and the record is public: every betrayal is named in the turn
 * report and counted forever, so a known backstabber finds nobody will pledge
 * to them and spends the rest of the match near 1.00 while everyone else runs
 * 1.35 pairs. That punishment is emergent, not coded — nothing in this file
 * prevents anyone from betraying every turn.
 *
 * Resolution is fully deterministic; the Pact draws no randomness at all.
 */

import { COURTED_INCOME_BONUS, PACT_MULTIPLIER } from '../constants.js';
import type { GameState, PactOutcome, PactResult, Slot } from '../types.js';
import type { Contest, ContestContext, ContestOutcome } from './types.js';

/**
 * Ceiling on how much income being courted can pay.
 *
 * Without it, a popular player in a twelve-player game collects eleven
 * reinforcements for doing nothing, and the leader everyone wants to befriend
 * snowballs on flattery alone.
 */
export const MAX_COURTED_BONUS = 2;

export type PactInput = Slot | null;

export const pactContest: Contest<PactInput, PactResult> = {
  id: 'pact',
  resolve: resolvePacts,
};

export function resolvePacts(
  state: GameState,
  pledgesIn: readonly (PactInput | null)[],
  context: ContestContext,
): ContestOutcome<PactResult> {
  const playerCount = state.playerCount;

  // Normalise: a pledge to a dead player, to yourself, or out of range is an
  // abstention rather than an error.
  const pledges: (Slot | null)[] = new Array(playerCount).fill(null);
  for (let slot = 0; slot < playerCount; slot++) {
    if (state.status[slot] !== 'active') continue;
    const raw = pledgesIn[slot] ?? null;
    if (raw === null) continue;
    if (!Number.isInteger(raw) || raw < 0 || raw >= playerCount) continue;
    if (raw === slot) continue;
    if (state.status[raw] !== 'active') continue;
    pledges[slot] = raw;
  }

  const courtedBy: number[] = new Array(playerCount).fill(0);
  for (let slot = 0; slot < playerCount; slot++) {
    const target = pledges[slot];
    // Only an *unreciprocated* pledge courts anyone; a mutual pledge is a pact.
    if (target !== null && pledges[target] !== slot) courtedBy[target]++;
  }

  const multiplier: number[] = new Array(playerCount).fill(PACT_MULTIPLIER.abstain);
  const bonusIncome: number[] = new Array(playerCount).fill(0);
  const results: PactResult[] = [];

  for (let slot = 0; slot < playerCount; slot++) {
    if (state.status[slot] !== 'active') continue;

    const pledged = pledges[slot];
    const outcome = outcomeFor(slot, pledged, pledges, context.attacked);
    const partner = isMutual(outcome) ? pledged : null;

    // A concord with the same partner as last turn extends the streak; anything
    // else breaks it. Streak length is what gates a shared victory, so it has
    // to be genuinely expensive to maintain.
    let streak = 0;
    if (outcome === 'concord' && partner !== null) {
      streak = state.pactPartner[slot] === partner ? state.pactStreak[slot] + 1 : 1;
    }

    const labelled: PactOutcome =
      outcome === 'abstain' && courtedBy[slot] > 0 ? 'courted' : outcome;

    multiplier[slot] = PACT_MULTIPLIER[outcome];
    bonusIncome[slot] = COURTED_INCOME_BONUS * Math.min(courtedBy[slot], MAX_COURTED_BONUS);

    results.push({
      slot,
      pledged,
      outcome: labelled,
      multiplier: multiplier[slot],
      streak,
      partner,
    });
  }

  return { multiplier, bonusIncome, results };
}

function outcomeFor(
  slot: Slot,
  pledged: Slot | null,
  pledges: readonly (Slot | null)[],
  attacked: readonly boolean[][],
): PactOutcome {
  if (pledged === null) return 'abstain';
  if (pledges[pledged] !== slot) return 'spurned';

  const iStruck = attacked[slot][pledged];
  const theyStruck = attacked[pledged][slot];

  if (iStruck && theyStruck) return 'mutual_treachery';
  if (iStruck) return 'betrayal';
  if (theyStruck) return 'betrayed';
  return 'concord';
}

function isMutual(outcome: PactOutcome): boolean {
  return (
    outcome === 'concord' ||
    outcome === 'betrayal' ||
    outcome === 'betrayed' ||
    outcome === 'mutual_treachery'
  );
}

/**
 * Folds a turn's pact outcomes into the permanent public record.
 *
 * This bookkeeping is the mechanism that makes the dilemma iterated rather than
 * one-shot, so it is deliberately unforgiving: a betrayal is counted against
 * the betrayer forever and remembered by name by its victim.
 */
export function applyPactRecord(state: GameState, results: readonly PactResult[]): void {
  for (const result of results) {
    switch (result.outcome) {
      case 'concord':
        state.pactsHonored[result.slot]++;
        state.pactPartner[result.slot] = result.partner;
        state.pactStreak[result.slot] = result.streak;
        break;

      case 'betrayal':
        state.pactsBroken[result.slot]++;
        state.pactPartner[result.slot] = null;
        state.pactStreak[result.slot] = 0;
        break;

      case 'betrayed':
        if (result.pledged !== null) state.betrayedBy[result.slot][result.pledged]++;
        state.pactPartner[result.slot] = null;
        state.pactStreak[result.slot] = 0;
        break;

      case 'mutual_treachery':
        state.pactsBroken[result.slot]++;
        if (result.pledged !== null) state.betrayedBy[result.slot][result.pledged]++;
        state.pactPartner[result.slot] = null;
        state.pactStreak[result.slot] = 0;
        break;

      default:
        state.pactPartner[result.slot] = null;
        state.pactStreak[result.slot] = 0;
        break;
    }
  }
}

/**
 * Two players qualify for a shared victory only on an unbroken mutual concord.
 * Checked from both sides so a one-sided record can never grant it.
 */
export function concordPair(state: GameState, a: Slot, b: Slot, minStreak: number): boolean {
  return (
    state.pactPartner[a] === b &&
    state.pactPartner[b] === a &&
    state.pactStreak[a] >= minStreak &&
    state.pactStreak[b] >= minStreak
  );
}
