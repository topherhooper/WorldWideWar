import { describe, expect, it } from 'vitest';
import { advanceSacre } from './clock.js';
import { applySacreAction } from './actions.js';
import { deal, emptyState } from './state.js';
import { redactSacre } from './redact.js';
import type { SacreState } from './types.js';

const start = (players = 4, turnSeconds = 120): SacreState =>
  deal(emptyState('redact-seed', players, turnSeconds), 0);

describe('redactSacre', () => {
  it('shows you your hand and nobody else theirs', () => {
    const view = redactSacre(start(), 1);
    expect(view.yourHand).toHaveLength(10);
    expect(view.seats[1].hand).toHaveLength(10);
    expect(view.seats[0].hand).toBeUndefined();
    expect(view.seats[2].hand).toBeUndefined();
    // The count is public -- you can see how many cards someone holds.
    expect(view.seats[0].cards).toBe(10);
  });

  it('hides the deck until round 8, then shows it to everyone', () => {
    const early = start();
    expect(redactSacre(early, 0).deck).toBeUndefined();
    expect(redactSacre(early, 0).deckCount).toBe(14);

    const last: SacreState = { ...early, round: 8 };
    const view = redactSacre(last, 0);
    expect(view.deck).toHaveLength(14);
    // Every hand, not just the viewer's.
    expect(view.seats.every((s) => s.hand !== undefined)).toBe(true);
  });

  it('shows a spectator nothing', () => {
    const view = redactSacre(start(), null);
    expect(view.yourHand).toEqual([]);
    expect(view.seats.every((s) => s.hand === undefined)).toBe(true);
    expect(view.options).toEqual([]);
  });

  it('keeps Advertise answers from everyone, including until the last one lands', () => {
    let state = start();
    const offer = state.players[0].hand.find((c) => c.rank !== null);
    state = applySacreAction(
      state,
      { type: 'advertise', card: offer?.id as string },
      { slot: 0, nowMs: 0 },
    ).state;

    // One seat answers; two still owe.
    const answer = state.players[1].hand.find(
      (c) => c.rank !== null && (state.pending as { floor: number }).floor <= 10,
    );
    state = applySacreAction(
      state,
      { type: 'respond', card: answer?.id as string },
      { slot: 1, nowMs: 0 },
    ).state;

    // Not even the advertiser sees a response while anyone still owes one.
    expect(redactSacre(state, 0).pending?.responses).toBeUndefined();
    // And never anyone else.
    expect(redactSacre(state, 2).pending?.responses).toBeUndefined();
    // Who still owes IS public, so the table knows who to chase.
    expect(redactSacre(state, 2).pending?.owed.length).toBeGreaterThan(0);
    expect(redactSacre(state, 2).pending?.youOwe).toBe(true);
  });

  it('offers no options to a seat whose turn it is not', () => {
    const state = start();
    expect(redactSacre(state, 0).options.length).toBeGreaterThan(0);
    expect(redactSacre(state, 1).options).toEqual([]);
  });

  it('never offers Cycle in round 8', () => {
    const state: SacreState = { ...start(), round: 8 };
    expect(redactSacre(state, 0).options).not.toContain('cycle');
  });
});

describe('the clock', () => {
  it('fills in a missing Advertise answer rather than stalling the table', () => {
    let state = start(4, 60);
    const offer = state.players[0].hand.find((c) => c.rank !== null);
    state = applySacreAction(
      state,
      { type: 'advertise', card: offer?.id as string },
      { slot: 0, nowMs: 0 },
    ).state;
    expect(state.pending?.owed).toHaveLength(3);

    // Nobody answers and the turn expires.
    const after = advanceSacre(state, 10_000_000);
    expect(after.changed).toBe(true);
    expect(after.state.pending).toBeNull();
    // The turn moved on rather than sitting on an unanswered advertisement.
    expect(after.state.active).not.toBe(0);
  });

  it('settles the moment the last answer lands, without waiting for the clock', () => {
    let state = start(2, 600);
    const offer = state.players[0].hand.find((c) => c.rank !== null);
    state = applySacreAction(
      state,
      { type: 'advertise', card: offer?.id as string },
      { slot: 0, nowMs: 0 },
    ).state;

    const floor = (state.pending as { floor: number }).floor;
    const answer = state.players[1].hand.find(
      (c) => c.rank !== null && (c.rank <= 10 ? c.rank : 10) >= floor,
    );
    if (answer) {
      state = applySacreAction(
        state,
        { type: 'respond', card: answer.id },
        { slot: 1, nowMs: 0 },
      ).state;
      expect(state.pending?.owed).toHaveLength(0);
      const settled = advanceSacre(state, 1000);
      expect(settled.changed).toBe(true);
      expect(settled.state.pending).toBeNull();
    }
  });
});
