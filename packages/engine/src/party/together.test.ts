import { describe, expect, it } from 'vitest';

import { applyPartyAction } from './actions.js';
import { advanceParty } from './clock.js';
import { QUICK_CANDLES, QUICK_ROUND_MINUTES, TOGETHER_SUSPECTS } from './constants.js';
import { redactParty } from './redact.js';
import { atTable, canVote, grownUps, guestAt, hasWon, suspects, totalVoices } from './rules.js';
import { addGuest, createPartyState } from './state.js';
import { duosFor } from './tale.js';
import type { PartyAction, PartyContext, PartyState } from './types.js';

const T0 = 1_700_000_000_000;

/**
 * The party this mode exists for: two parents, a four-year-old and a
 * one-and-a-half-year-old, ten minutes before bedtime.
 */
function family(): PartyState {
  const state = createPartyState(0, {
    mode: 'together',
    candles: QUICK_CANDLES,
    roundMinutes: QUICK_ROUND_MINUTES,
  });
  const mum = addGuest(state, { name: 'Mum', young: false, slot: 0, broughtBy: null });
  addGuest(state, { name: 'Robin', young: true, slot: 0, broughtBy: mum.id });
  const dad = addGuest(state, { name: 'Dad', young: false, slot: 1, broughtBy: null });
  addGuest(state, { name: 'Wren', young: true, slot: 1, broughtBy: dad.id });
  return state;
}

const ctx = (slot: number, nowMs = T0, seed = 'family'): PartyContext => ({
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

function refuse(state: PartyState, action: PartyAction, c: PartyContext): string {
  const out = applyPartyAction(state, action, c);
  expect(out.rejected).not.toBeNull();
  expect(out.state).toBe(state);
  return out.rejected!;
}

/** Dealt and rung in. */
const started = (seed = 'family'): PartyState => {
  const dealt = act(family(), { kind: 'deal' }, ctx(0, T0, seed));
  return act(dealt, { kind: 'bell' }, ctx(0, T0, seed));
};

describe('a party of four, before bedtime', () => {
  it('deals with only two grown-ups, which a hunt cannot', () => {
    const dealt = act(family(), { kind: 'deal' }, ctx(0));
    expect(dealt.phase).toBe('invited');
    expect(grownUps(dealt)).toHaveLength(2);
    expect(atTable(dealt)).toHaveLength(4);
  });

  it('puts the curse on a courtier who went home, never on anyone at the table', () => {
    for (let s = 0; s < 50; s++) {
      const dealt = act(family(), { kind: 'deal' }, ctx(0, T0, `who-${s}`));
      const culprit = guestAt(dealt, dealt.culprit!)!;
      expect(culprit.absent).toBe(true);
      expect(suspects(dealt)).toHaveLength(TOGETHER_SUSPECTS);
      expect(suspects(dealt).every((g) => g.absent)).toBe(true);
      // Nobody in the room is on the curser's side.
      for (const guest of atTable(dealt)) expect(guest.lies).toBe(0);
    }
  });

  it('deals nobody a falsehood, and no ability that can never fire', () => {
    const dealt = act(family(), { kind: 'deal' }, ctx(0));
    expect(dealt.lieBudget).toBe(0);
    // The Godmother sees falsehoods and the Huntsman smells liars. With no liar
    // both are a promise to a four-year-old that never comes true.
    expect(
      duosFor('together')
        .map((d) => d.id)
        .sort(),
    ).toEqual(['nursemaid', 'spinner']);
    for (const guest of dealt.guests) {
      expect(guest.duoId === 'godmother' || guest.duoId === 'huntsman').toBe(false);
    }
    // Two children, two workable characters — both pairs get one.
    const kids = dealt.guests.filter((g) => g.young);
    expect(kids).toHaveLength(2);
    expect(kids.every((k) => k.duoId !== null)).toBe(true);
  });

  it('gives the youngest a real part, a favour and a duo like any other child', () => {
    const dealt = act(family(), { kind: 'deal' }, ctx(0));
    const wren = dealt.guests.find((g) => g.name === 'Wren')!;
    expect(wren.part).not.toBeNull();
    expect(wren.favour).not.toBeNull();
    expect(wren.duoId).not.toBeNull();
    expect(wren.costume).not.toBeNull();
  });

  it('is solvable: exactly one courtier fits the three pinning clues', () => {
    for (let s = 0; s < 100; s++) {
      const dealt = act(family(), { kind: 'deal' }, ctx(0, T0, `solve-${s}`));
      const c = guestAt(dealt, dealt.culprit!)!.costume!;
      const texts = new Set(dealt.deck.map((p) => p.text));
      expect(texts.has(`The one who cursed her wore ${c.gown}.`)).toBe(true);
      expect(texts.has(`The one who cursed her brought ${c.gift}.`)).toBe(true);
      expect(texts.has(`The one who cursed her stood ${c.place}.`)).toBe(true);
      const fits = dealt.guests.filter(
        (g) =>
          g.costume!.gown === c.gown && g.costume!.gift === c.gift && g.costume!.place === c.place,
      );
      expect(fits.map((g) => g.id)).toEqual([dealt.culprit]);
    }
  });

  it('spends its clues on suspects, never on an alibi for Mum', () => {
    const dealt = act(family(), { kind: 'deal' }, ctx(0));
    const alibis = dealt.deck.filter((p) => p.text.includes('never left the hall'));
    expect(alibis.length).toBeGreaterThan(0);
    for (const name of ['Mum', 'Dad', 'Robin', 'Wren']) {
      expect(alibis.some((p) => p.text.startsWith(name))).toBe(false);
    }
  });

  it("lets the grown-ups mingle with each other and with each other's children", () => {
    let state = started();
    const mum = state.guests.find((g) => g.name === 'Mum')!;
    const wren = state.guests.find((g) => g.name === 'Wren')!;
    const before = guestAt(state, mum.id)!.pieces.length;

    state = act(state, { kind: 'meet', actor: mum.id, target: wren.id, lie: false }, ctx(0));
    state = act(state, { kind: 'confirm', about: wren.id, claimant: mum.id }, ctx(1));
    expect(guestAt(state, mum.id)!.pieces.length).toBe(before + 1);
    // The child's crown count is the whole of their scoreboard, and it moved.
    expect(guestAt(state, wren.id)!.curtsies).toContain(mum.id);
  });

  it('will not let anyone meet a courtier who went home', () => {
    const state = started();
    const mum = state.guests.find((g) => g.name === 'Mum')!;
    const courtier = state.guests.find((g) => g.absent)!;
    expect(
      refuse(state, { kind: 'meet', actor: mum.id, target: courtier.id, lie: false }, ctx(0)),
    ).toMatch(/went home/);
    // And offers nobody absent as somebody to meet.
    const card = redactParty(state, 0).cards[0];
    expect(card.canMeet.every((m) => !state.guests[m.id].absent)).toBe(true);
    expect(card.canMeet.map((m) => m.name).sort()).toEqual(['Dad', 'Wren']);
  });

  it('settles a guess on the spot — there is nobody to vote against', () => {
    let state = act(started('guess'), { kind: 'bell' }, ctx(0, T0, 'guess'));
    expect(state.phase).toBe('vote');
    const mum = state.guests.find((g) => g.name === 'Mum')!;
    expect(refuse(state, { kind: 'vote', actor: mum.id, yes: true }, ctx(0))).toMatch(
      /naming a courtier is the guess/,
    );

    const wrong = suspects(state).find((g) => g.id !== state.culprit)!;
    const candles = state.candles;
    state = act(state, { kind: 'nominate', actor: mum.id, suspect: wrong.id }, ctx(0, T0, 'guess'));
    // Wrong, so a candle goes — but that courtier is struck off, which is progress.
    expect(state.candles).toBe(candles - 1);
    expect(guestAt(state, wrong.id)!.banished).toBe(true);
    expect(state.nomination).toBeNull();
    expect(state.phase).toBe('mingle');
    expect(suspects(state).filter((g) => !g.banished)).toHaveLength(TOGETHER_SUSPECTS - 1);

    // A wrong guess costs the round, not just the candle: the hall goes back to
    // mingling and has to earn its way to the floor again before guessing.
    expect(refuse(state, { kind: 'nominate', actor: mum.id, suspect: wrong.id }, ctx(0))).toMatch(
      /nobody is naming anyone yet/,
    );
    state = act(state, { kind: 'bell' }, ctx(0, T0, 'guess'));
    expect(refuse(state, { kind: 'nominate', actor: mum.id, suspect: wrong.id }, ctx(0))).toMatch(
      /already ruled out/,
    );
  });

  it('breaks the curse when they name the right courtier, and everyone wins', () => {
    let state = act(started('win'), { kind: 'bell' }, ctx(0, T0, 'win'));
    const mum = state.guests.find((g) => g.name === 'Mum')!;
    state = act(
      state,
      { kind: 'nominate', actor: mum.id, suspect: state.culprit! },
      ctx(0, T0, 'win'),
    );
    expect(state.phase).toBe('over');
    expect(state.outcome).toMatch(/the curse is broken/);
    expect(state.candles).toBeGreaterThan(0);
    for (const guest of atTable(state)) expect(hasWon(state, guest)).toBe(true);
    // Nobody at the table was ever on the curser's side.
    const view = redactParty(state, 0);
    expect(view.cursed).toEqual([state.culprit]);
  });

  it('loses together when the last candle goes out', () => {
    let state = started('lose');
    // Nobody guesses; the clock runs the three candles down.
    state = advanceParty(state, T0 + 60 * 60_000).state;
    expect(state.phase).toBe('over');
    expect(state.candles).toBe(0);
    for (const guest of atTable(state)) expect(hasWon(state, guest)).toBe(false);
  });

  it('runs in about ten minutes on the quick dials', () => {
    const state = family();
    expect(state.candles).toBe(QUICK_CANDLES);
    expect(state.roundMinutes).toBe(QUICK_ROUND_MINUTES);
    // Three candles at two-minute rounds plus three ninety-second floors.
    const worstCase =
      state.candles * state.roundMinutes * 60_000 + state.candles * state.voteSeconds * 1000;
    expect(worstCase).toBeLessThanOrEqual(11 * 60_000);
  });

  it('counts no courtier as a voice, and gives them no card', () => {
    const state = started();
    for (const courtier of state.guests.filter((g) => g.absent)) {
      expect(canVote(courtier)).toBe(false);
      expect(courtier.pieces).toEqual([]);
      expect(courtier.favour).toBeNull();
    }
    // Two duos among two grown-ups: two voices each, though nothing votes here.
    expect(totalVoices(state)).toBe(4);
    // Seat 0 is handed Mum and Robin, and nobody else.
    expect(redactParty(state, 0).cards.map((c) => c.name)).toEqual(['Mum', 'Robin']);
    // A courtier's slot belongs to no seat, so no seat can be handed their card.
    expect(redactParty(state, -1).cards).toEqual([]);
  });

  it('shows the courtiers on the roster — they are the whole suspect list', () => {
    const view = redactParty(started(), 0);
    const absent = view.roster.filter((r) => r.absent);
    expect(absent).toHaveLength(TOGETHER_SUSPECTS);
    expect(absent.every((r) => r.costume !== null && r.name.length > 0)).toBe(true);
    expect(view.mode).toBe('together');
  });
});

describe('the cast a together party deals', () => {
  it('never gives a courtier a name a duo half is wearing', () => {
    // A second Spinner across the room is unreadable — doubly so when one of
    // them is a suspect the hall is meant to be able to name.
    for (let s = 0; s < 200; s++) {
      const dealt = act(family(), { kind: 'deal' }, ctx(0, T0, `cast-${s}`));
      const parts = dealt.guests.map((g) => g.part!);
      expect(new Set(parts).size).toBe(parts.length);
    }
  });

  it('counts the candles it lit, so the row does not shrink as they burn', () => {
    let state = started('candles');
    const view0 = redactParty(state, 0);
    expect(view0.candles).toBe(QUICK_CANDLES);
    expect(view0.maxCandles).toBe(QUICK_CANDLES);

    // Let the clock burn one, and the total must not move with it.
    state = advanceParty(state, T0 + 30 * 60_000).state;
    const view1 = redactParty(state, 0);
    expect(view1.maxCandles).toBe(QUICK_CANDLES);
    expect(view1.candles).toBeLessThan(QUICK_CANDLES);
  });
});
