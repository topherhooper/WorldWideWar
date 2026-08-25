import { describe, expect, it } from 'vitest';

import { applyPartyAction } from './actions.js';
import { grownUps, guestAt } from './rules.js';
import { redactParty } from './redact.js';
import { addGuest, createPartyState } from './state.js';
import type { PartyAction, PartyContext, PartyState } from './types.js';

const T0 = 1_700_000_000_000;

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

const ctx = (slot: number, seed = 'redact'): PartyContext => ({
  seed,
  nowMs: T0,
  slot,
  isHost: slot === 0,
});

function act(state: PartyState, action: PartyAction, c: PartyContext): PartyState {
  const out = applyPartyAction(state, action, c);
  expect(out.rejected).toBeNull();
  return out.state;
}

function mingling(grown = 8, pairs = 4, seed = 'redact'): PartyState {
  const dealt = act(seated(grown, pairs), { kind: 'deal' }, ctx(0, seed));
  return act(dealt, { kind: 'bell' }, ctx(0, seed));
}

/** Every string anywhere in a redacted view, for the leak sweeps. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) strings(v, out);
  }
  return out;
}

describe('what a guest is allowed to see', () => {
  it('gives a spectator the public evening and no card at all', () => {
    const state = mingling();
    const view = redactParty(state, null);
    expect(view.cards).toEqual([]);
    expect(view.culprit).toBeNull();
    expect(view.cursed).toBeNull();
    // Costumes stay public: the puzzle is the culprit's costume, so the guests
    // have to be readable or there is nothing to deduce.
    expect(view.roster.every((r) => r.costume !== null)).toBe(true);
  });

  it('gives a seat exactly its own guests, in order', () => {
    const state = mingling();
    const view = redactParty(state, 0);
    expect(view.cards.map((c) => c.name)).toEqual(['Grown 0', 'Kid 0']);
    expect(redactParty(state, 5).cards.map((c) => c.name)).toEqual(['Grown 5']);
  });

  it('never names the culprit before the night is over', () => {
    const state = mingling();
    const culprit = guestAt(state, state.culprit!)!;
    for (const slot of [null, 0, 1, 2, 3, 4, 5, 6, 7]) {
      const view = redactParty(state, slot);
      expect(view.culprit).toBeNull();
      expect(view.cursed).toBeNull();
    }
    // And the roster gives no tell: the culprit looks like everybody else.
    const entry = redactParty(state, 3).roster.find((r) => r.id === culprit.id)!;
    const other = redactParty(state, 3).roster.find((r) => r.id !== culprit.id && !r.young)!;
    expect(Object.keys(entry).sort()).toEqual(Object.keys(other).sort());
  });

  it('tells only the curser about a falsehood budget', () => {
    const state = mingling();
    for (const guest of state.guests) {
      const card = redactParty(state, guest.slot).cards.find((c) => c.id === guest.id)!;
      expect(card.lies).toBe(guest.id === state.culprit ? state.lieBudget : 0);
    }
  });

  it('flags a falsehood to the Godmother and to nobody else', () => {
    let state = mingling(8, 4, 'godmother');
    const godmother = state.guests.find((g) => g.duoId === 'godmother' && !g.young);
    expect(godmother).toBeDefined();
    const culpritId = state.culprit!;
    expect(godmother!.id).not.toBe(culpritId);

    // The curser lies to the Godmother, and to somebody else.
    const other = state.guests.find(
      (g) => !g.young && g.id !== culpritId && g.id !== godmother!.id,
    )!;
    for (const victim of [godmother!, other]) {
      state = act(
        state,
        { kind: 'meet', actor: culpritId, target: victim.id, lie: true },
        ctx(guestAt(state, culpritId)!.slot, 'godmother'),
      );
      state = act(
        state,
        { kind: 'confirm', about: victim.id, claimant: culpritId },
        ctx(victim.slot, 'godmother'),
      );
    }

    const hers = redactParty(state, godmother!.slot).cards.find((c) => c.id === godmother!.id)!;
    expect(hers.pieces.some((p) => p.fake === true)).toBe(true);
    expect(hers.pieces.every((p) => p.fake !== null)).toBe(true);

    // The other victim holds a falsehood and is told nothing about it.
    const theirs = redactParty(state, other.slot).cards.find((c) => c.id === other.id)!;
    expect(guestAt(state, other.id)!.pieces.some((p) => p.fake)).toBe(true);
    expect(theirs.pieces.every((p) => p.fake === null)).toBe(true);
  });

  it('shows the hall graph to the Nursemaid and to nobody else', () => {
    let state = mingling(8, 4, 'nursemaid');
    const nursemaid = state.guests.find((g) => g.duoId === 'nursemaid' && !g.young);
    expect(nursemaid).toBeDefined();

    const a = state.guests.find((g) => !g.young && g.id !== nursemaid!.id)!;
    const b = state.guests.find((g) => !g.young && g.id !== nursemaid!.id && g.id !== a.id)!;
    state = act(
      state,
      { kind: 'meet', actor: a.id, target: b.id, lie: false },
      ctx(a.slot, 'nursemaid'),
    );
    state = act(state, { kind: 'confirm', about: b.id, claimant: a.id }, ctx(b.slot, 'nursemaid'));

    const hers = redactParty(state, nursemaid!.slot).cards.find((c) => c.id === nursemaid!.id)!;
    expect(hers.hall).not.toBeNull();
    expect(hers.hall!.some((h) => h.id === a.id && h.met.includes(b.id))).toBe(true);

    for (const guest of state.guests) {
      if (guest.id === nursemaid!.id) continue;
      const card = redactParty(state, guest.slot).cards.find((c) => c.id === guest.id)!;
      expect(card.hall).toBeNull();
    }
  });

  it("never leaks a piece into somebody else's view", () => {
    let state = mingling();
    // Give the hall a few encounters so everyone is holding something.
    const pairsToMeet: [number, number][] = [
      [0, 2],
      [2, 4],
      [4, 6],
    ];
    for (const [a, b] of pairsToMeet) {
      state = act(
        state,
        { kind: 'meet', actor: a, target: b, lie: false },
        ctx(guestAt(state, a)!.slot),
      );
      state = act(state, { kind: 'confirm', about: b, claimant: a }, ctx(guestAt(state, b)!.slot));
    }

    for (const viewer of state.guests) {
      const view = redactParty(state, viewer.slot);
      const seen = new Set(view.cards.flatMap((c) => c.pieces.map((p) => p.text)));
      const entitled = new Set(
        state.guests
          .filter((g) => g.slot === viewer.slot)
          .flatMap((g) => g.pieces.map((p) => p.text)),
      );
      for (const text of seen) expect(entitled.has(text)).toBe(true);
    }
  });

  it("never puts a pending claim's falsehood on the wire", () => {
    // A lie in flight lives on the claim, unseen, until the encounter is
    // confirmed. Nothing anywhere in any view may carry it before then.
    let state = mingling();
    const culpritId = state.culprit!;
    const victim = state.guests.find((g) => !g.young && g.id !== culpritId)!;
    state = act(
      state,
      { kind: 'meet', actor: culpritId, target: victim.id, lie: true },
      ctx(guestAt(state, culpritId)!.slot),
    );
    const lie = guestAt(state, victim.id)!.claims.find((c) => c.from === culpritId)!.lie!;
    expect(lie).toBeTruthy();

    for (const slot of [null, 0, 1, 2, 3, 4, 5, 6, 7]) {
      expect(strings(redactParty(state, slot))).not.toContain(lie);
    }
  });

  it("puts no piece on a child's card at all", () => {
    // Their screen carries a character, a price, a crown count and the candles.
    // Nothing on it is load-bearing text, and it is rendered on a grown-up's
    // phone — so a child's half must never carry the adults' puzzle.
    let state = mingling();
    const kid = state.guests.find((g) => g.young)!;
    const visitor = state.guests.find((g) => !g.young && g.id !== kid.broughtBy)!;
    state = act(
      state,
      { kind: 'meet', actor: visitor.id, target: kid.id, lie: false },
      ctx(visitor.slot),
    );
    state = act(state, { kind: 'confirm', about: kid.id, claimant: visitor.id }, ctx(kid.slot));
    expect(guestAt(state, kid.id)!.pieces.length).toBeGreaterThan(0);

    const card = redactParty(state, kid.slot).cards.find((c) => c.id === kid.id)!;
    expect(card.pieces).toEqual([]);
    expect(card.favour).not.toBeNull();
    expect(card.curtsies).toContain(visitor.id);
  });

  it('offers nobody to meet outside a mingle round', () => {
    const dealt = act(seated(6, 2), { kind: 'deal' }, ctx(0));
    expect(redactParty(dealt, 0).cards[0].canMeet).toEqual([]);
    const floor = act(act(dealt, { kind: 'bell' }, ctx(0)), { kind: 'bell' }, ctx(0));
    expect(redactParty(floor, 0).cards[0].canMeet).toEqual([]);
  });

  it('withholds the tale until the roles are dealt', () => {
    const lobby = seated(4, 1);
    expect(redactParty(lobby, 0).tale).toBeNull();
    const dealt = act(lobby, { kind: 'deal' }, ctx(0));
    expect(redactParty(dealt, 0).tale).toMatchObject({ title: 'Sleeping Beauty' });
  });

  it('names the culprit once it is over, and settles who won', () => {
    let state = mingling(4, 0, 'ending');
    state = act(state, { kind: 'bell' }, ctx(0, 'ending'));
    const culpritId = state.culprit!;
    const accuser = grownUps(state).find((g) => g.id !== culpritId)!;
    state = act(
      state,
      { kind: 'nominate', actor: accuser.id, suspect: culpritId },
      ctx(accuser.slot, 'ending'),
    );
    for (const guest of grownUps(state)) {
      if (state.phase !== 'vote') break;
      state = act(state, { kind: 'vote', actor: guest.id, yes: true }, ctx(guest.slot, 'ending'));
    }
    expect(state.phase).toBe('over');

    const view = redactParty(state, accuser.slot);
    expect(view.culprit).toBe(culpritId);
    expect(view.cursed).toContain(culpritId);
    expect(view.cards[0].won).toBe(true);
    expect(redactParty(state, guestAt(state, culpritId)!.slot).cards[0].won).toBe(false);
  });
});
