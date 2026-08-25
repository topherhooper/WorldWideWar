import { describe, expect, it } from 'vitest';

import { MAX_PARTY_GUESTS } from './constants.js';
import { guestAt } from './rules.js';
import { addGuest, createPartyState } from './state.js';
import { DUOS, GROWN_PARTS, KID_PARTS, dealTale, lieBudget, makeLie } from './tale.js';
import type { Costume, PartyState } from './types.js';

/**
 * A party of `grown` seats, the first `pairs` of which brought a child. One
 * seat per grown-up, which is the shape a real evening takes; children ride on
 * the seat that brought them.
 */
function party(grown: number, pairs = 0): PartyState {
  const state = createPartyState(0);
  for (let slot = 0; slot < grown; slot++) {
    const adult = addGuest(state, {
      name: `Grown ${slot}`,
      young: false,
      slot,
      broughtBy: null,
    });
    if (slot < pairs) {
      addGuest(state, { name: `Kid ${slot}`, young: true, slot, broughtBy: adult.id });
    }
  }
  return state;
}

const costumeKey = (c: Costume): string => `${c.gown}|${c.gift}|${c.place}`;

/** Everyone whose costume survives all three pinning clues. */
function solve(state: PartyState): number[] {
  const culprit = guestAt(state, state.culprit ?? -1);
  if (culprit === null || culprit.costume === null) return [];
  const pinning = [
    `The one who cursed her wore ${culprit.costume.gown}.`,
    `The one who cursed her brought ${culprit.costume.gift}.`,
    `The one who cursed her stood ${culprit.costume.place}.`,
  ];
  const texts = new Set(state.deck.map((p) => p.text));
  if (!pinning.every((clue) => texts.has(clue))) return [];
  return state.guests
    .filter(
      (g) =>
        g.costume !== null &&
        g.costume.gown === culprit.costume!.gown &&
        g.costume.gift === culprit.costume!.gift &&
        g.costume.place === culprit.costume!.place,
    )
    .map((g) => g.id);
}

describe('dealing the tale', () => {
  it('is solvable by construction, over 3600 parties from 3 to 20 guests', () => {
    // The prototype's headline claim, re-run as a seeded sweep. An earlier
    // version sliced the clue pool per player and could slice the pinning
    // clues out, leaving a puzzle with no answer and no way to notice.
    let dealtCount = 0;
    for (let grown = 3; grown <= MAX_PARTY_GUESTS; grown++) {
      const maxPairs = Math.min(grown - 2, 6);
      for (let pairs = 0; pairs <= maxPairs; pairs++) {
        for (let s = 0; s < 35; s++) {
          const state = dealTale(party(grown, pairs), `sweep-${grown}-${pairs}-${s}`);
          dealtCount++;

          // Distinct costumes are what make a pinned costume name one guest.
          const keys = state.guests.map((g) => costumeKey(g.costume!));
          expect(new Set(keys).size).toBe(keys.length);

          // The three pinning clues are present, and they name exactly one guest.
          expect(solve(state)).toEqual([state.culprit]);

          // A child never laid the curse.
          expect(guestAt(state, state.culprit!)!.young).toBe(false);
        }
      }
    }
    expect(dealtCount).toBeGreaterThanOrEqual(3600);
  });

  it('deals the same tale twice from one seed, and different tales from two', () => {
    const a = dealTale(party(8, 3), 'seed-a');
    const b = dealTale(party(8, 3), 'seed-a');
    const c = dealTale(party(8, 3), 'seed-b');
    expect(b).toEqual(a);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it('gives every guest a distinct part, and no soloist a part a duo is wearing', () => {
    for (let s = 0; s < 60; s++) {
      const state = dealTale(party(14, 5), `parts-${s}`);
      const parts = state.guests.map((g) => g.part);
      expect(parts.every((p) => p !== null)).toBe(true);
      expect(new Set(parts).size).toBe(parts.length);

      // Several duo halves — the Huntsman, the Spinner — also appear in the
      // ordinary cast, and a second Huntsman across the room is unreadable.
      const duoNames = new Set(DUOS.flatMap((d) => [d.grown, d.kid]));
      for (const guest of state.guests) {
        if (guest.duoId === null) expect(duoNames.has(guest.part!)).toBe(false);
      }
    }
  });

  it('deals at most four duos, one per grown-up, and only to pairs', () => {
    const state = dealTale(party(12, 6), 'duos');
    const withDuo = state.guests.filter((g) => g.duoId !== null);
    // Four characters, two halves each.
    expect(withDuo.length).toBe(DUOS.length * 2);
    const grownWithDuo = withDuo.filter((g) => !g.young);
    expect(new Set(grownWithDuo.map((g) => g.id)).size).toBe(DUOS.length);
    for (const guest of withDuo) {
      const partner = guest.young
        ? guestAt(state, guest.broughtBy!)
        : state.guests.find((g) => g.broughtBy === guest.id && g.young);
      expect(partner?.duoId).toBe(guest.duoId);
    }
  });

  it('gives a grown-up who brought two children one duo, not two', () => {
    const state = createPartyState(0);
    for (let slot = 0; slot < 4; slot++) {
      addGuest(state, { name: `Grown ${slot}`, young: false, slot, broughtBy: null });
    }
    addGuest(state, { name: 'Kid A', young: true, slot: 0, broughtBy: 0 });
    addGuest(state, { name: 'Kid B', young: true, slot: 0, broughtBy: 0 });
    const dealt = dealTale(state, 'two-kids');
    const kids = dealt.guests.filter((g) => g.young);
    expect(kids.filter((k) => k.duoId !== null)).toHaveLength(1);
    // The second child plays an ordinary part rather than nothing at all.
    const spare = kids.find((k) => k.duoId === null)!;
    expect(KID_PARTS).toContain(spare.part);
  });

  it('degrades rather than throwing when twenty grown-ups outrun the cast', () => {
    const state = dealTale(party(MAX_PARTY_GUESTS, 4), 'crowded');
    const parts = state.guests.map((g) => g.part!);
    expect(parts.every((p) => p.length > 0)).toBe(true);
    expect(new Set(parts).size).toBe(parts.length);
    // Some guests draw an overflow name; every one of them is still readable.
    expect(parts.filter((p) => GROWN_PARTS.includes(p)).length).toBeGreaterThan(0);
  });

  it('scales the falsehood budget with the hall', () => {
    expect(lieBudget(4)).toBe(2);
    expect(lieBudget(11)).toBe(2);
    expect(lieBudget(12)).toBe(3);
    expect(lieBudget(20)).toBe(3);
    expect(dealTale(party(6, 1), 'small').lieBudget).toBe(2);
    expect(dealTale(party(14, 2), 'big').lieBudget).toBe(3);
  });
});

describe('falsehoods', () => {
  it('are always actually false — never a true clue already in the deck', () => {
    // The deck holds *every* true statement of these five grammars: the three
    // that pin the culprit's costume, and one exclusion for every attribute
    // they did not wear. So "matches a deck grammar but is not in the deck" is
    // exactly "is false", which is what makes this two-line check a proof.
    //
    // The regression it pins: the prototype's sixth variant produced
    // "<innocent> never left the hall", which is true and *is* in the deck for
    // every innocent. Spending a falsehood to hand somebody a real clue is a
    // self-report, so that variant is gone.
    const GRAMMARS = [
      /^The one who cursed her wore .+\.$/,
      /^The one who cursed her brought .+\.$/,
      /^The one who cursed her stood .+\.$/,
      /^Whoever cursed her, it was not the one in .+\.$/,
      /^No one who brought .+ laid the curse\.$/,
    ];
    for (let s = 0; s < 300; s++) {
      const state = dealTale(party(9, 3), `form-${s}`);
      const lie = makeLie(state, `form-${s}`);
      expect(lie).not.toBeNull();
      expect(GRAMMARS.some((g) => g.test(lie!))).toBe(true);
      expect(state.deck.some((p) => p.text === lie)).toBe(false);
    }
  });

  it('never name a guest, so they cannot be aimed at the recipient', () => {
    for (let s = 0; s < 200; s++) {
      const state = dealTale(party(7, 2), `frame-${s}`);
      const lie = makeLie(state, `frame-${s}`)!;
      for (const guest of state.guests) expect(lie).not.toContain(guest.name);
    }
  });
});
