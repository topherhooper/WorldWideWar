// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import {
  QUICK_CANDLES,
  QUICK_ROUND_MINUTES,
  addGuest,
  applyPartyAction,
  createPartyState,
  redactParty,
} from '@www/engine/party';
import type { PartyContext, PartyState } from '@www/engine/party';
import type { PartyGameView } from '@www/server/api-types';

vi.mock('../api.js', () => ({
  api: {
    deleteGame: vi.fn().mockResolvedValue({ ok: true }),
    partyAct: vi.fn(),
    takePartySeat: vi.fn(),
    dropPartySeat: vi.fn(),
    updatePartyConfig: vi.fn(),
  },
  ApiError: class extends Error {},
}));

const { api } = await import('../api.js');
const { PartyGame } = await import('./PartyGame.js');

const T0 = 1_700_000_000_000;
const ctx = (slot: number): PartyContext => ({
  seed: 'family',
  nowMs: T0,
  slot,
  isHost: slot === 0,
});

/** Two parents and two children, dealt and rung in — a bedtime party underway. */
function started(): PartyState {
  const state = createPartyState(0, {
    mode: 'together',
    candles: QUICK_CANDLES,
    roundMinutes: QUICK_ROUND_MINUTES,
  });
  const mum = addGuest(state, { name: 'Mum', young: false, slot: 0, broughtBy: null });
  addGuest(state, { name: 'Robin', young: true, slot: 0, broughtBy: mum.id });
  const dad = addGuest(state, { name: 'Dad', young: false, slot: 1, broughtBy: null });
  addGuest(state, { name: 'Wren', young: true, slot: 1, broughtBy: dad.id });
  const dealt = applyPartyAction(state, { kind: 'deal' }, ctx(0));
  return applyPartyAction(dealt.state, { kind: 'bell' }, ctx(0)).state;
}

function nightView(slot: number): PartyGameView {
  return {
    kind: 'party',
    id: 'p1',
    status: 'active',
    tale: 'sleeping-beauty',
    seats: [
      {
        slot: 0,
        name: 'Mum',
        taken: true,
        isHost: true,
        dependents: [{ name: 'Robin', young: true }],
      },
      {
        slot: 1,
        name: 'Dad',
        taken: true,
        isHost: false,
        dependents: [{ name: 'Wren', young: true }],
      },
    ],
    maxSeats: 20,
    mySlot: slot,
    isHost: slot === 0,
    phaseEndsAt: null,
    party: redactParty(started(), slot),
    note: null,
  };
}

const renderGame = (view: PartyGameView) =>
  render(
    <MemoryRouter>
      <PartyGame view={view} act={() => Promise.resolve()} id="p1" />
    </MemoryRouter>,
  );

/**
 * The delete button had to reach past the lobby too: the party most likely to
 * want deleting is the one dealt to the wrong people, which is exactly the
 * point at which the lobby screen is gone for good.
 */
describe('ending a party already underway', () => {
  afterEach(cleanup);

  it('lets the host delete a dealt party', async () => {
    renderGame(nightView(0));
    fireEvent.click(screen.getByText(/delete this party/i));
    fireEvent.click(screen.getByText(/really delete/i));
    await waitFor(() => expect(vi.mocked(api.deleteGame)).toHaveBeenCalledWith('p1'));
  });

  it('offers no delete to a guest', () => {
    renderGame(nightView(1));
    expect(screen.queryByText(/delete this party/i)).toBeNull();
  });
});
