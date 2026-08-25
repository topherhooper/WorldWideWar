/**
 * The evening's clock, and what settles when it runs out.
 *
 * The prototype's comment was the whole design: *"the clock is lazy: nothing
 * ticks, but every request notices what time it is."* That survives the port
 * exactly, because a cron sweep once a minute cannot drive a ninety-second vote
 * window. `advanceParty` runs at the top of every party read and every party
 * action, and the deadline sweeper calls the same function — two callers, one
 * pure function, and time arriving as an argument rather than a clock read.
 */

import { cloneParty } from './state.js';
import { canVote, guestAt, totalVoices, weightOf } from './rules.js';
import type { PartyResult, PartyState } from './types.js';

const unchanged = (state: PartyState): PartyResult => ({ state, changed: false, rejected: null });

/**
 * Read through the mutation. `burnCandle` can end the night, and TypeScript
 * cannot see a field change inside a call, so a direct `phase !== 'over'` after
 * one narrows to a comparison it believes is always true.
 */
const isOver = (state: PartyState): boolean => state.phase === 'over';

/** Open a mingle round. The bell will ring when `phaseEndsAt` passes. */
export function beginRound(state: PartyState, nowMs: number): void {
  state.round += 1;
  state.phase = 'mingle';
  state.phaseEndsAt = nowMs + state.roundMinutes * 60_000;
  state.nomination = null;
}

/** Close mingling and put the floor open. */
export function ringBell(state: PartyState, nowMs: number): void {
  state.phase = 'vote';
  state.phaseEndsAt = nowMs + state.voteSeconds * 1000;
  state.nomination = null;
}

export function burnCandle(state: PartyState, why: string): void {
  state.candles -= 1;
  state.snuffed = why;
  if (state.candles <= 0) {
    state.candles = 0;
    state.phase = 'over';
    state.phaseEndsAt = null;
    state.outcome = 'the last candle went out — Aurora sleeps';
  }
}

/**
 * Settle the nomination on the floor: banish, or let them off.
 *
 * The majority is measured against **every voice still in the room**, not
 * against the voices actually raised. The prototype's comment claimed the
 * latter and its code did the former (`server.mjs:141` against `:180`); this
 * keeps the code, because that is the rule two thousand simulated parties were
 * checked under, and because a hall of twenty where six people are holding
 * drinks should not be able to banish somebody on four votes. Deal-ahead makes
 * silence more likely, not less, so if a real evening finds this too strict the
 * fix is a quorum, not a quiet switch to counting only the attentive.
 */
export function settleVote(state: PartyState, nowMs: number): void {
  const nom = state.nomination;
  if (nom === null) return;
  const suspect = guestAt(state, nom.suspect);
  if (suspect === null) {
    state.nomination = null;
    return;
  }

  // Who was already a ghost when this vote was cast. Somebody banished *by*
  // this vote was alive when they spoke, so it does not cost them their last
  // voice.
  const ghosts = new Set(state.guests.filter((g) => g.banished).map((g) => g.id));

  const yes = nom.votes.filter((v) => v.yes).reduce((n, v) => n + v.weight, 0);
  const total = totalVoices(state);
  nom.tally = { yes, total, carried: yes * 2 > total };
  state.lastResult = { suspect: nom.suspect, by: nom.by, tally: { ...nom.tally } };

  if (nom.tally.carried) {
    suspect.banished = true;
    state.banished.push(suspect.id);
    // Banishment does not remove anybody. It spends their voice.
    for (const vote of nom.votes) {
      if (!ghosts.has(vote.guest)) continue;
      const ghost = guestAt(state, vote.guest);
      if (ghost !== null) ghost.lastVoteSpent = true;
    }
    if (suspect.id === state.culprit) {
      state.phase = 'over';
      state.phaseEndsAt = null;
      state.outcome = 'the curse is broken — you named the one who laid it';
      state.nomination = null;
      return;
    }
    // Wrong neck. The hall spent its accusation, and a candle with it.
    burnCandle(state, `${suspect.name} was banished, and was innocent`);
    if (isOver(state)) {
      state.nomination = null;
      return;
    }
  }

  burnCandle(state, 'the round ended');
  state.nomination = null;
  if (isOver(state)) return;
  beginRound(state, nowMs);
}

/** Everyone who still has a voice has used it. */
export const allVoicesSpoken = (state: PartyState): boolean => {
  const nom = state.nomination;
  if (nom === null) return false;
  const spoken = new Set(nom.votes.map((v) => v.guest));
  return state.guests.filter(canVote).every((g) => spoken.has(g.id));
};

/** The total this nomination will be measured against, for the floor's display. */
export const floorTotal = (state: PartyState): number => totalVoices(state);

export const voiceOf = weightOf;

/**
 * Notice what time it is. Idempotent, and safe to call on any phase: a party in
 * lobby, invited or over has no deadline and nothing happens.
 */
export function advanceParty(state: PartyState, nowMs: number): PartyResult {
  if (state.phaseEndsAt === null || nowMs < state.phaseEndsAt) return unchanged(state);
  if (state.phase !== 'mingle' && state.phase !== 'vote') return unchanged(state);

  const next = cloneParty(state);
  // A long-abandoned party can be several phases behind; walk it forward rather
  // than jumping, so every candle it owes actually gets burned.
  let guard = 0;
  while (
    next.phaseEndsAt !== null &&
    nowMs >= next.phaseEndsAt &&
    (next.phase === 'mingle' || next.phase === 'vote') &&
    guard < 1000
  ) {
    guard += 1;
    if (next.phase === 'mingle') {
      ringBell(next, next.phaseEndsAt);
      continue;
    }
    // Time is up on the floor. A nomination settles on the voices raised; an
    // empty floor simply costs the hall a candle.
    const at = next.phaseEndsAt;
    if (next.nomination !== null) {
      settleVote(next, at);
    } else {
      burnCandle(next, 'the hall said nothing');
      if (!isOver(next)) beginRound(next, at);
    }
  }
  return { state: next, changed: true, rejected: null };
}
