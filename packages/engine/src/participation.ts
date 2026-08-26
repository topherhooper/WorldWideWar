/**
 * Who is still playing, as opposed to who still has an empire.
 *
 * Competitively these are the same question and `status === 'active'` answers
 * both. Cooperatively they come apart: losing your last province ends your war
 * but not your contribution, because reads pay a coalition pool rather than the
 * reader (`contest/tiers.ts`). A player knocked out on turn 3 of a once-a-day
 * game keeps writing lists and reading allies, and those reads still buy armies
 * for the people still fighting.
 *
 * This is the rule's only home on purpose. It is read by resolution, by the
 * balance harness, by the server deciding whose orders to accept and whom to
 * wait for, and by the client deciding which panel to draw — five places that
 * silently disagreeing would make the mechanic look implemented while paying
 * nobody anything.
 */

import type { GameState, RuleConfig, Slot } from './types.js';

/**
 * May this slot still submit contest input, and should the turn wait for it?
 *
 * Resignation is the one exit that means it in both modes: it is a deliberate
 * "stop counting me", and a resigned seat that still had to be waited on would
 * stall every remaining turn until the deadline.
 */
export function inContest(state: GameState, slot: Slot, rules: RuleConfig): boolean {
  return rules.coop ? state.status[slot] !== 'resigned' : state.status[slot] === 'active';
}

/**
 * May this slot still give orders to armies? Land, not participation — an
 * eliminated cooperative player is `inContest` but has nowhere to deploy.
 */
export function commandsArmies(state: GameState, slot: Slot): boolean {
  return state.status[slot] === 'active';
}
