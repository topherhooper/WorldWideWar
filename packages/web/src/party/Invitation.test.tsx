// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  addGuest,
  applyPartyAction,
  createPartyState,
  guestAt,
  redactParty,
} from '@www/engine/party';
import type { PartyState } from '@www/engine/party';

import { Invitation } from './Invitation.js';
import { KidView } from './KidView.js';

/** Four grown-ups, the first two with a child, so duos and a curser exist. */
function hall(mode: 'traitor' | 'together' = 'traitor'): PartyState {
  const state = createPartyState(0, { mode });
  for (let slot = 0; slot < 4; slot++) {
    const adult = addGuest(state, { name: `Grown ${slot}`, young: false, slot, broughtBy: null });
    if (slot < 2) {
      addGuest(state, { name: `Kid ${slot}`, young: true, slot, broughtBy: adult.id });
    }
  }
  const out = applyPartyAction(
    state,
    { kind: 'deal' },
    { seed: 'invite', nowMs: 0, slot: 0, isHost: true },
  );
  expect(out.rejected).toBeNull();
  return out.state;
}

describe('the invitation', () => {
  afterEach(cleanup);

  it('gives a guest their character, their costume and the cast', () => {
    const state = hall();
    const view = redactParty(state, 0);
    render(<Invitation view={view} cards={view.cards} onBegin={null} />);

    const me = view.cards[0];
    expect(screen.getByText('Sleeping Beauty')).toBeDefined();
    expect(screen.getAllByText(me.part!).length).toBeGreaterThan(0);
    expect(screen.getByText(me.costume!.gown)).toBeDefined();
    // Costumes are public, so the whole cast is on the card.
    for (const guest of view.roster) {
      expect(screen.getAllByText(guest.name).length).toBeGreaterThan(0);
    }
  });

  it('tells exactly one guest they laid the curse', () => {
    const state = hall();
    const culpritSlot = guestAt(state, state.culprit!)!.slot;

    let told = 0;
    for (let slot = 0; slot < 4; slot++) {
      const view = redactParty(state, slot);
      const { unmount } = render(<Invitation view={view} cards={view.cards} onBegin={null} />);
      if (screen.queryByText(/You laid the curse/) !== null) {
        told += 1;
        expect(slot).toBe(culpritSlot);
      }
      unmount();
    }
    expect(told).toBe(1);
  });

  it('tells nobody they laid it when nobody at the table did', () => {
    const view = redactParty(hall('together'), 0);
    render(<Invitation view={view} cards={view.cards} onBegin={null} />);
    expect(screen.queryByText(/You laid the curse/)).toBeNull();
    expect(screen.getByText(/Nobody here laid the curse/)).toBeDefined();
  });

  it("puts the child's card beside their grown-up's, because one phone carries both", () => {
    const view = redactParty(hall(), 0);
    expect(view.cards).toHaveLength(2);
    render(<Invitation view={view} cards={view.cards} onBegin={null} />);
    // Each name appears twice over: once on their own card, once in the cast.
    expect(screen.getAllByText('Grown 0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kid 0').length).toBeGreaterThan(0);
  });
});

describe("a child's screen", () => {
  afterEach(cleanup);

  it('shows a part, a price and the candles — and never a clue', () => {
    const view = redactParty(hall(), 0);
    const kid = view.cards.find((c) => c.young)!;
    render(<KidView card={kid} view={view} />);

    expect(screen.getByText(kid.part!)).toBeDefined();
    expect(screen.getByText(/Nobody has bowed to you yet/)).toBeDefined();
    // The redactor deals a child no pieces at all; nothing here can leak one.
    expect(kid.pieces).toEqual([]);
    for (const piece of view.roster) {
      expect(screen.queryByText(new RegExp(`cursed her`))).toBeNull();
      expect(piece).toBeDefined();
    }
  });
});
