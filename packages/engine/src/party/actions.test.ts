import { beforeEach, describe, expect, it } from 'vitest';

import { applyPartyAction } from './actions.js';
import { advanceParty } from './clock.js';
import { canVote, cursedSide, guestAt, grownUps, totalVoices, weightOf } from './rules.js';
import { addGuest, createPartyState, removeSeat } from './state.js';
import type { PartyAction, PartyContext, PartyGuest, PartyState } from './types.js';

const T0 = 1_700_000_000_000;
const SEED = 'party-seed';

/** `grown` seats, the first `pairs` of which brought a child. */
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

/** The seat that speaks for a guest. Ids and slots diverge as soon as anyone brings a child. */
const slotOf = (state: PartyState, id: number): number => guestAt(state, id)!.slot;

const ctx = (slot: number, over: Partial<PartyContext> = {}): PartyContext => ({
  seed: SEED,
  nowMs: T0,
  slot,
  isHost: slot === 0,
  ...over,
});

/** Apply and expect it to land. */
function act(state: PartyState, action: PartyAction, c: PartyContext): PartyState {
  const out = applyPartyAction(state, action, c);
  expect(out.rejected).toBeNull();
  expect(out.changed).toBe(true);
  return out.state;
}

/** Apply and expect it to be turned away, with the state untouched. */
function refuse(state: PartyState, action: PartyAction, c: PartyContext): string {
  const out = applyPartyAction(state, action, c);
  expect(out.rejected).not.toBeNull();
  expect(out.changed).toBe(false);
  expect(out.state).toBe(state);
  return out.rejected!;
}

/** A party dealt and rung in, mingling in round 1. */
function mingling(grown = 6, pairs = 2, seed = SEED): PartyState {
  let state = seated(grown, pairs);
  state = act(state, { kind: 'deal' }, { ...ctx(0), seed });
  return act(state, { kind: 'bell' }, { ...ctx(0), seed });
}

/** Walk a full encounter: A claims B, B's speaker confirms. */
function encounter(state: PartyState, a: number, b: number, lie = false): PartyState {
  const actor = guestAt(state, a)!;
  const about = guestAt(state, b)!;
  const next = act(state, { kind: 'meet', actor: a, target: b, lie }, ctx(actor.slot));
  return act(next, { kind: 'confirm', about: b, claimant: a }, ctx(about.slot));
}

describe('dealing', () => {
  it('refuses a hall with only one grown-up — one of them did it', () => {
    const state = seated(1, 1);
    expect(refuse(state, { kind: 'deal' }, ctx(0))).toMatch(/two grown-ups/);
  });

  it("is the host's to do, and only once", () => {
    const state = seated(4, 1);
    expect(refuse(state, { kind: 'deal' }, ctx(2))).toMatch(/only the host/);
    const dealt = act(state, { kind: 'deal' }, ctx(0));
    expect(dealt.phase).toBe('invited');
    expect(refuse(dealt, { kind: 'deal' }, ctx(0))).toMatch(/already dealt/);
  });

  it('leaves the night unstarted — an invitation can sit for days', () => {
    const dealt = act(seated(4, 1), { kind: 'deal' }, ctx(0));
    expect(dealt.phase).toBe('invited');
    expect(dealt.phaseEndsAt).toBeNull();
    expect(dealt.round).toBe(0);
    // A week passes and nothing has happened, because nothing should.
    expect(advanceParty(dealt, T0 + 7 * 86_400_000).changed).toBe(false);
  });

  it('gives the falsehoods to the curser and nobody else', () => {
    const dealt = act(seated(6, 2), { kind: 'deal' }, ctx(0));
    for (const guest of dealt.guests) {
      expect(guest.lies).toBe(guest.id === dealt.culprit ? dealt.lieBudget : 0);
    }
  });
});

describe('the bell', () => {
  it('starts the night, then closes each round early', () => {
    const dealt = act(seated(5, 1), { kind: 'deal' }, ctx(0));
    const round1 = act(dealt, { kind: 'bell' }, ctx(0));
    expect(round1.phase).toBe('mingle');
    expect(round1.round).toBe(1);
    expect(round1.phaseEndsAt).toBe(T0 + round1.roundMinutes * 60_000);

    const floor = act(round1, { kind: 'bell' }, ctx(0));
    expect(floor.phase).toBe('vote');
    expect(floor.phaseEndsAt).toBe(T0 + floor.voteSeconds * 1000);
    expect(refuse(floor, { kind: 'bell' }, ctx(0))).toMatch(/already rung/);
  });

  it("is the host's alone", () => {
    const dealt = act(seated(5, 1), { kind: 'deal' }, ctx(0));
    expect(refuse(dealt, { kind: 'bell' }, ctx(3))).toMatch(/only the host/);
  });
});

describe('mingling', () => {
  let state: PartyState;
  beforeEach(() => {
    state = mingling();
  });

  it('pays both sides a piece on a confirmed encounter, unattributed', () => {
    const before = [guestAt(state, 0)!.pieces.length, guestAt(state, 2)!.pieces.length];
    const after = encounter(state, 0, 2);
    expect(guestAt(after, 0)!.pieces.length).toBe(before[0] + 1);
    expect(guestAt(after, 2)!.pieces.length).toBe(before[1] + 1);
    // Nothing anywhere records who a piece came from.
    for (const guest of after.guests) {
      for (const piece of guest.pieces) {
        expect(Object.keys(piece).sort()).toEqual(['fake', 'text']);
      }
    }
    expect(guestAt(after, 0)!.met).toContain(2);
    expect(guestAt(after, 2)!.met).toContain(0);
  });

  it('drops the claim on a denial, and pays nobody', () => {
    const claimed = act(state, { kind: 'meet', actor: 0, target: 2, lie: false }, ctx(0));
    expect(guestAt(claimed, 2)!.claims).toHaveLength(1);
    const denied = act(claimed, { kind: 'deny', about: 2, claimant: 0 }, ctx(slotOf(state, 2)));
    expect(guestAt(denied, 2)!.claims).toHaveLength(0);
    expect(guestAt(denied, 0)!.met).toHaveLength(0);
    expect(guestAt(denied, 0)!.pieces).toEqual(guestAt(state, 0)!.pieces);
  });

  it("lets only a child's own grown-up answer for them", () => {
    // Guest 1 is Kid 0, on seat 0. Guest 2 is Grown 1.
    const kid = guestAt(state, 1)!;
    expect(kid.young).toBe(true);
    const visitorSlot = slotOf(state, 2);
    const claimed = act(state, { kind: 'meet', actor: 2, target: 1, lie: false }, ctx(visitorSlot));
    // The claimant cannot vouch for their own claim, and nor can any other seat.
    expect(refuse(claimed, { kind: 'confirm', about: 1, claimant: 2 }, ctx(visitorSlot))).toMatch(
      /only Grown 0 can answer for Kid 0/,
    );
    const confirmed = act(claimed, { kind: 'confirm', about: 1, claimant: 2 }, ctx(0));
    // The child banks a curtsy: the grown-up knelt, so the clue is unsealed.
    expect(guestAt(confirmed, 1)!.curtsies).toContain(2);
  });

  it('refuses meeting yourself, your own guest, or the same guest twice', () => {
    expect(refuse(state, { kind: 'meet', actor: 0, target: 0, lie: false }, ctx(0))).toMatch(
      /cannot meet yourself/,
    );
    expect(refuse(state, { kind: 'meet', actor: 0, target: 1, lie: false }, ctx(0))).toMatch(
      /came with you/,
    );
    const met = encounter(state, 0, 2);
    expect(refuse(met, { kind: 'meet', actor: 0, target: 2, lie: false }, ctx(0))).toMatch(
      /already met/,
    );
  });

  it('refuses a second claim while the first is still waiting', () => {
    const claimed = act(state, { kind: 'meet', actor: 0, target: 2, lie: false }, ctx(0));
    expect(refuse(claimed, { kind: 'meet', actor: 0, target: 2, lie: false }, ctx(0))).toMatch(
      /already waiting/,
    );
  });

  it("will not let a seat move somebody else's guest", () => {
    // Guest 2 sits on another seat; seat 0 has no business moving them.
    expect(slotOf(state, 2)).not.toBe(0);
    expect(refuse(state, { kind: 'meet', actor: 2, target: 4, lie: false }, ctx(0))).toMatch(
      /not your guest/,
    );
  });

  it('closes once the bell rings', () => {
    const floor = act(state, { kind: 'bell' }, ctx(0));
    expect(refuse(floor, { kind: 'meet', actor: 0, target: 2, lie: false }, ctx(0))).toMatch(
      /the hall is voting/,
    );
  });
});

describe('falsehoods', () => {
  it('are spent one at a time, and refused past the budget', () => {
    let state = mingling(8, 2);
    const culpritId = state.culprit!;
    const culprit = guestAt(state, culpritId)!;
    const budget = state.lieBudget;
    expect(budget).toBeGreaterThan(0);

    const targets = state.guests
      .filter((g) => g.id !== culpritId && g.broughtBy !== culpritId)
      .map((g) => g.id);

    for (let i = 0; i < budget; i++) {
      state = act(
        state,
        { kind: 'meet', actor: culpritId, target: targets[i], lie: true },
        ctx(culprit.slot),
      );
      expect(guestAt(state, culpritId)!.lies).toBe(budget - i - 1);
    }
    expect(
      refuse(
        state,
        { kind: 'meet', actor: culpritId, target: targets[budget], lie: true },
        ctx(culprit.slot),
      ),
    ).toMatch(/no falsehoods left/);
  });

  it("reach the answerer as a fake piece, and the claimant's piece stays true", () => {
    const state = mingling(8, 2);
    const culpritId = state.culprit!;
    const victim = state.guests.find((g) => g.id !== culpritId && g.broughtBy !== culpritId)!;

    const after = encounter(state, culpritId, victim.id, true);
    expect(guestAt(after, victim.id)!.pieces.some((p) => p.fake)).toBe(true);
    // The curser's own new piece is an honest one — the lie travels one way.
    expect(guestAt(after, culpritId)!.pieces.every((p) => !p.fake)).toBe(true);
  });

  it('are refused to anyone who is not the curser', () => {
    const state = mingling(6, 2);
    const innocent = grownUps(state).find((g) => g.id !== state.culprit)!;
    const target = state.guests.find((g) => g.id !== innocent.id && g.broughtBy !== innocent.id)!;
    expect(
      refuse(
        state,
        { kind: 'meet', actor: innocent.id, target: target.id, lie: true },
        ctx(innocent.slot),
      ),
    ).toMatch(/no falsehoods left/);
  });
});

describe('the duo abilities', () => {
  it("runs the Spinner's thread both ways, as a copy", () => {
    // Find a seed whose Spinner child can be met by somebody.
    let state = mingling(8, 4, 'spinner-seed');
    const kid = state.guests.find((g) => g.duoId === 'spinner' && g.young);
    // Four pairs and four duo characters, so every pair draws one — assert it
    // rather than bailing, or a changed seed would silently stop testing this.
    expect(kid).toBeDefined();
    const grown = guestAt(state, kid!.broughtBy!)!;
    const visitor = state.guests.find((g) => !g.young && g.id !== grown.id)!;
    const grownBefore = grown.pieces.length;

    state = encounter(state, visitor.id, kid!.id);
    const kidAfter = guestAt(state, kid!.id)!;
    const grownAfter = guestAt(state, grown.id)!;
    expect(kidAfter.pieces.length).toBe(kid!.pieces.length + 1);
    // A copy: the child keeps theirs, and the grown-up gains one too.
    expect(grownAfter.pieces.length).toBe(grownBefore + 1);
    const newest = kidAfter.pieces[kidAfter.pieces.length - 1];
    expect(grownAfter.pieces.some((p) => p.text === newest.text)).toBe(true);
  });

  it('gives the Huntsman one sniff, and only during the party', () => {
    const dealt = act(seated(8, 4), { kind: 'deal' }, { ...ctx(0), seed: 'huntsman-seed' });
    const hunter = dealt.guests.find((g) => g.duoId === 'huntsman' && !g.young)!;
    const target = dealt.guests.find((g) => !g.young && g.id !== hunter.id)!;

    // Dealt on Tuesday: the cub must not be able to sniff before anyone can lie.
    expect(
      refuse(dealt, { kind: 'sniff', actor: hunter.id, target: target.id }, ctx(hunter.slot)),
    ).toMatch(/once the party has started/);

    const night = act(dealt, { kind: 'bell' }, { ...ctx(0), seed: 'huntsman-seed' });
    const sniffed = act(
      night,
      { kind: 'sniff', actor: hunter.id, target: target.id },
      { ...ctx(hunter.slot), seed: 'huntsman-seed' },
    );
    expect(guestAt(sniffed, hunter.id)!.sniff).toEqual({ target: target.id, lied: false });
    expect(
      refuse(sniffed, { kind: 'sniff', actor: hunter.id, target: target.id }, ctx(hunter.slot)),
    ).toMatch(/already sniffed/);
  });

  it('smells a curser who has actually spent a falsehood, and not one who has not', () => {
    let state = mingling(14, 4, 'sniff-seed');
    const hunter = state.guests.find((g) => g.duoId === 'huntsman' && !g.young)!;
    const culpritId = state.culprit!;
    // This seed deals them apart; pin it, so a reseed fails rather than skips.
    expect(hunter.id).not.toBe(culpritId);

    // Before any lie is told, the curser smells clean — the ledger is honest.
    const early = applyPartyAction(
      state,
      { kind: 'sniff', actor: hunter.id, target: culpritId },
      ctx(hunter.slot),
    );
    expect(early.state.guests[hunter.id].sniff).toEqual({ target: culpritId, lied: false });

    // Now they lie, and the cub can smell it.
    const victim = state.guests.find(
      (g) => g.id !== culpritId && g.broughtBy !== culpritId && g.id !== hunter.id,
    )!;
    state = act(
      state,
      { kind: 'meet', actor: culpritId, target: victim.id, lie: true },
      ctx(guestAt(state, culpritId)!.slot),
    );
    const late = act(
      state,
      { kind: 'sniff', actor: hunter.id, target: culpritId },
      ctx(hunter.slot),
    );
    expect(guestAt(late, hunter.id)!.sniff).toEqual({ target: culpritId, lied: true });
  });

  it('refuses the sniff to anyone who is not the Huntsman', () => {
    const state = mingling(8, 4, 'huntsman-seed');
    const plain = state.guests.find((g) => !g.young && g.duoId !== 'huntsman')!;
    const target = state.guests.find((g) => !g.young && g.id !== plain.id)!;
    expect(
      refuse(state, { kind: 'sniff', actor: plain.id, target: target.id }, ctx(plain.slot)),
    ).toMatch(/not your character/);
  });
});

describe('the floor', () => {
  it('takes one nomination at a time, and never a child', () => {
    const floor = act(mingling(6, 2), { kind: 'bell' }, ctx(0));
    const kid = floor.guests.find((g) => g.young)!;
    expect(refuse(floor, { kind: 'nominate', actor: 0, suspect: kid.id }, ctx(0))).toMatch(
      /no child laid that curse/,
    );
    expect(refuse(floor, { kind: 'nominate', actor: kid.id, suspect: 2 }, ctx(kid.slot))).toMatch(
      /grown-up has to say it out loud/,
    );
    const nominated = act(floor, { kind: 'nominate', actor: 0, suspect: 2 }, ctx(0));
    expect(nominated.nomination).toMatchObject({ suspect: 2, by: 0 });
    expect(
      refuse(nominated, { kind: 'nominate', actor: 4, suspect: 6 }, ctx(slotOf(nominated, 4))),
    ).toMatch(/already on the floor/);
  });

  it('weighs a duo at two voices and a soloist at one', () => {
    const state = mingling(8, 4, 'weights');
    for (const guest of state.guests) {
      if (guest.young) expect(weightOf(guest)).toBe(0);
      else expect(weightOf(guest)).toBe(guest.duoId === null ? 1 : 2);
    }
    // Four duos among eight grown-ups: 4*2 + 4*1.
    expect(totalVoices(state)).toBe(12);
  });

  it('carries on a strict majority of every voice in the room, not of those who spoke', () => {
    // A hall where half the guests never press anything cannot banish somebody.
    let state = act(mingling(6, 0, 'majority'), { kind: 'bell' }, ctx(0));
    state = act(state, { kind: 'nominate', actor: 0, suspect: 1 }, ctx(0));
    state = act(state, { kind: 'vote', actor: 0, yes: true }, ctx(0));
    state = act(state, { kind: 'vote', actor: 2, yes: true }, ctx(2));
    // Two yes out of six voices: 2 * 2 > 6 is false, so nothing has carried yet.
    expect(state.nomination?.tally).toBeNull();
    expect(guestAt(state, 1)!.banished).toBe(false);
  });

  it('settles the moment every remaining voice has spoken', () => {
    let state = act(mingling(4, 0, 'settle'), { kind: 'bell' }, ctx(0));
    const innocent = grownUps(state).find((g) => g.id !== state.culprit)!;
    state = act(
      state,
      { kind: 'nominate', actor: state.culprit!, suspect: innocent.id },
      ctx(guestAt(state, state.culprit!)!.slot),
    );
    const candlesBefore = state.candles;
    for (const guest of grownUps(state)) {
      state = act(state, { kind: 'vote', actor: guest.id, yes: true }, ctx(guest.slot));
    }
    expect(guestAt(state, innocent.id)!.banished).toBe(true);
    // A wrongful banishment costs two candles: the round's, and the mistake's.
    expect(state.candles).toBe(candlesBefore - 2);
    expect(state.lastResult?.tally.carried).toBe(true);
    // And the hall rolls straight into the next round.
    expect(state.phase).toBe('mingle');
    expect(state.round).toBe(2);
  });

  it('refuses a second vote from the same guest', () => {
    let state = act(mingling(6, 0, 'twice'), { kind: 'bell' }, ctx(0));
    state = act(state, { kind: 'nominate', actor: 0, suspect: 1 }, ctx(0));
    state = act(state, { kind: 'vote', actor: 0, yes: true }, ctx(0));
    expect(refuse(state, { kind: 'vote', actor: 0, yes: false }, ctx(0))).toMatch(/already spoken/);
  });

  it("spends a ghost's last voice on the next vote they cast, not the one that banished them", () => {
    let state = act(mingling(4, 0, 'ghost'), { kind: 'bell' }, ctx(0));
    const innocent = grownUps(state).find((g) => g.id !== state.culprit)!;
    const nominator = grownUps(state).find((g) => g.id !== innocent.id)!;
    state = act(
      state,
      { kind: 'nominate', actor: nominator.id, suspect: innocent.id },
      ctx(nominator.slot),
    );
    for (const guest of grownUps(state)) {
      state = act(state, { kind: 'vote', actor: guest.id, yes: true }, ctx(guest.slot));
    }
    // Banished by that vote — they were alive when they spoke, so they keep a voice.
    const ghost = guestAt(state, innocent.id)!;
    expect(ghost.banished).toBe(true);
    expect(ghost.lastVoteSpent).toBe(false);
    expect(canVote(ghost)).toBe(true);

    // The next vote is their last.
    state = act(state, { kind: 'bell' }, ctx(0));
    const nextSuspect = grownUps(state).find((g) => !g.banished && g.id !== nominator.id)!;
    state = act(
      state,
      { kind: 'nominate', actor: nominator.id, suspect: nextSuspect.id },
      ctx(nominator.slot),
    );
    for (const guest of grownUps(state).filter(canVote)) {
      if (state.phase !== 'vote') break;
      state = act(state, { kind: 'vote', actor: guest.id, yes: true }, ctx(guest.slot));
    }
    expect(guestAt(state, innocent.id)!.lastVoteSpent).toBe(true);
    expect(canVote(guestAt(state, innocent.id)!)).toBe(false);
  });
});

describe('how the night ends', () => {
  it('breaks the curse when the hall names the one who laid it', () => {
    let state = act(mingling(4, 0, 'caught'), { kind: 'bell' }, ctx(0));
    const culpritId = state.culprit!;
    const accuser = grownUps(state).find((g) => g.id !== culpritId)!;
    state = act(
      state,
      { kind: 'nominate', actor: accuser.id, suspect: culpritId },
      ctx(accuser.slot),
    );
    for (const guest of grownUps(state)) {
      if (state.phase !== 'vote') break;
      state = act(state, { kind: 'vote', actor: guest.id, yes: true }, ctx(guest.slot));
    }
    expect(state.phase).toBe('over');
    expect(state.outcome).toMatch(/the curse is broken/);
    expect(state.candles).toBeGreaterThan(0);
    expect(state.phaseEndsAt).toBeNull();
  });

  it("drags the curser's own child onto their side of the ledger", () => {
    const state = act(seated(6, 3), { kind: 'deal' }, { ...ctx(0), seed: 'sides' });
    const side = cursedSide(state);
    expect(side[0]).toBe(state.culprit);
    const kids = state.guests.filter((g) => g.broughtBy === state.culprit);
    for (const kid of kids) expect(side).toContain(kid.id);
  });
});

describe('un-seating a no-show', () => {
  it('renumbers cleanly and keeps every pairing intact', () => {
    const state = seated(4, 4);
    expect(state.guests).toHaveLength(8);
    const dropped = removeSeat(state, 1);
    expect(dropped.guests).toHaveLength(6);
    expect(dropped.guests.map((g) => g.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(dropped.guests.some((g) => g.name === 'Grown 1' || g.name === 'Kid 1')).toBe(false);
    for (const guest of dropped.guests) {
      if (guest.broughtBy === null) continue;
      const parent = dropped.guests[guest.broughtBy] as PartyGuest | undefined;
      expect(parent?.slot).toBe(guest.slot);
      expect(parent?.young).toBe(false);
    }
  });

  it('refuses once the roles are dealt — half the state points at guests by id', () => {
    const dealt = act(seated(4, 1), { kind: 'deal' }, ctx(0));
    expect(removeSeat(dealt, 1)).toBe(dealt);
  });
});
