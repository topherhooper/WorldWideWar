import { describe, expect, it } from 'vitest';

import { applyPartyAction } from './actions.js';
import { advanceParty } from './clock.js';
import { grownUps, guestAt } from './rules.js';
import { addGuest, createPartyState } from './state.js';
import type { PartyAction, PartyContext, PartyState } from './types.js';

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;

function seated(grown: number, pairs = 0): PartyState {
  const state = createPartyState(0);
  for (let slot = 0; slot < grown; slot++) {
    const adult = addGuest(state, { name: `Grown ${slot}`, young: false, slot, broughtBy: null });
    if (slot < pairs) {
      addGuest(state, { name: `Kid ${slot}`, young: true, slot, broughtBy: adult.id });
    }
  }
  return state;
}

const ctx = (slot: number, nowMs = T0, seed = 'clock'): PartyContext => ({
  seed,
  nowMs,
  slot,
  isHost: slot === 0,
});

function act(state: PartyState, action: PartyAction, c: PartyContext): PartyState {
  const out = applyPartyAction(state, action, c);
  expect(out.rejected).toBeNull();
  return out.state;
}

/** Dealt and rung in, mingling in round 1 at T0. */
function mingling(grown = 6, seed = 'clock'): PartyState {
  const dealt = act(seated(grown), { kind: 'deal' }, ctx(0, T0, seed));
  return act(dealt, { kind: 'bell' }, ctx(0, T0, seed));
}

describe('noticing what time it is', () => {
  it('does nothing before the deadline, and nothing at all without one', () => {
    const state = mingling();
    expect(advanceParty(state, T0).changed).toBe(false);
    expect(advanceParty(state, state.phaseEndsAt! - 1).changed).toBe(false);

    const lobby = seated(4);
    expect(advanceParty(lobby, T0 + 99 * MINUTE).changed).toBe(false);
  });

  it('rings the bell when the mingle round runs out', () => {
    const state = mingling();
    const { state: after, changed } = advanceParty(state, state.phaseEndsAt!);
    expect(changed).toBe(true);
    expect(after.phase).toBe('vote');
    // The floor opens at the moment the bell rang, not at the moment somebody
    // happened to poll — otherwise a late sweep silently extends the window.
    expect(after.phaseEndsAt).toBe(state.phaseEndsAt! + after.voteSeconds * 1000);
  });

  it('costs the hall a candle when the floor closes on silence', () => {
    const state = mingling();
    const bellAt = state.phaseEndsAt!;
    const floor = advanceParty(state, bellAt).state;
    const after = advanceParty(floor, floor.phaseEndsAt!).state;
    expect(after.candles).toBe(state.candles - 1);
    expect(after.snuffed).toBe('the hall said nothing');
    expect(after.phase).toBe('mingle');
    expect(after.round).toBe(2);
  });

  it('settles a nomination left on the floor when the clock runs out', () => {
    let state = mingling(4);
    state = advanceParty(state, state.phaseEndsAt!).state;
    const innocent = grownUps(state).find((g) => g.id !== state.culprit)!;
    const accuser = grownUps(state).find((g) => g.id !== innocent.id)!;
    state = act(
      state,
      { kind: 'nominate', actor: accuser.id, suspect: innocent.id },
      ctx(accuser.slot, state.phaseEndsAt! - 1000),
    );
    // One yes out of four voices never carries: 1 * 2 > 4 is false.
    state = act(
      state,
      { kind: 'vote', actor: accuser.id, yes: true },
      ctx(accuser.slot, state.phaseEndsAt! - 500),
    );
    const settled = advanceParty(state, state.phaseEndsAt!).state;
    expect(settled.lastResult?.tally).toEqual({ yes: 1, total: 4, carried: false });
    expect(guestAt(settled, innocent.id)!.banished).toBe(false);
    expect(settled.candles).toBe(state.candles - 1);
    expect(settled.phase).toBe('mingle');
  });

  it('walks a long-abandoned party forward one phase at a time', () => {
    // Everyone pocketed their phones on round 1. Every candle they owe still
    // has to burn, or the party would jump to the end owing four.
    const state = mingling();
    const abandoned = advanceParty(state, T0 + 365 * 24 * 60 * MINUTE);
    expect(abandoned.changed).toBe(true);
    expect(abandoned.state.phase).toBe('over');
    expect(abandoned.state.candles).toBe(0);
    expect(abandoned.state.outcome).toMatch(/the last candle went out/);
    expect(abandoned.state.phaseEndsAt).toBeNull();
    // Five candles, one per silent floor, so five rounds happened.
    expect(abandoned.state.round).toBe(state.candles);
  });

  it('is idempotent — a second pass at the same moment changes nothing', () => {
    const state = mingling();
    const once = advanceParty(state, state.phaseEndsAt! + 5).state;
    const twice = advanceParty(once, state.phaseEndsAt! + 5);
    expect(twice.changed).toBe(false);
    expect(twice.state).toBe(once);
  });

  it('leaves the original state untouched — the caller keeps what it had', () => {
    const state = mingling();
    const before = JSON.stringify(state);
    advanceParty(state, T0 + 999 * MINUTE);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('stops sweeping once the night is over', () => {
    const state = mingling();
    const over = advanceParty(state, T0 + 365 * 24 * 60 * MINUTE).state;
    expect(advanceParty(over, T0 + 999 * 24 * 60 * MINUTE).changed).toBe(false);
  });
});
