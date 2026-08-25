// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { addGuest, createPartyState, redactParty } from '@www/engine/party';
import type { PartyGameView } from '@www/server/api-types';

import { PartyLobby } from './PartyLobby.js';

/** A host and two other grown-ups, still in the lobby with nothing dealt. */
function lobbyView(over: Partial<PartyGameView> = {}): PartyGameView {
  const state = createPartyState(0, { mode: 'traitor' });
  for (let slot = 0; slot < 3; slot++) {
    addGuest(state, { name: `Grown ${slot}`, young: false, slot, broughtBy: null });
  }
  return {
    kind: 'party',
    id: 'p1',
    status: 'lobby',
    tale: 'sleeping-beauty',
    seats: state.guests.map((g) => ({
      slot: g.slot,
      name: g.name,
      taken: true,
      isHost: g.slot === 0,
      dependents: [],
    })),
    maxSeats: 20,
    mySlot: 0,
    isHost: true,
    phaseEndsAt: null,
    party: redactParty(state, 0),
    note: null,
    ...over,
  };
}

const props = (view: PartyGameView, onConfig: (patch: object) => void) => ({
  view,
  busy: false,
  error: null,
  onSeat: vi.fn(),
  onDrop: vi.fn(),
  onConfig,
  onDeal: vi.fn(),
});

describe('the host dials', () => {
  afterEach(cleanup);

  // The bug: both dials were controlled off the server view with the change
  // handler firing a config request per keystroke, so clearing the box sent
  // candles: 0, the server rejected it, and the old number came straight back.
  it('lets the host clear a dial and type a new number', () => {
    const onConfig = vi.fn();
    render(<PartyLobby {...props(lobbyView(), onConfig)} />);
    const candles = screen.getByLabelText(/candles/i) as HTMLInputElement;

    fireEvent.change(candles, { target: { value: '' } });
    expect(candles.value).toBe(''); // the box stays empty while it is being typed
    expect(onConfig).not.toHaveBeenCalled(); // and nothing is sent mid-edit

    fireEvent.change(candles, { target: { value: '7' } });
    expect(candles.value).toBe('7');
    fireEvent.blur(candles);
    expect(onConfig).toHaveBeenCalledTimes(1);
    expect(onConfig).toHaveBeenCalledWith({ candles: 7 });
  });

  it('commits minutes a round on Enter', () => {
    const onConfig = vi.fn();
    render(<PartyLobby {...props(lobbyView(), onConfig)} />);
    const minutes = screen.getByLabelText(/minutes a round/i);

    fireEvent.change(minutes, { target: { value: '12' } });
    fireEvent.keyDown(minutes, { key: 'Enter' });
    expect(onConfig).toHaveBeenCalledWith({ roundMinutes: 12 });

    // Leaving the field afterwards must not send it a second time: the view
    // still reads 5 until the round-trip lands.
    fireEvent.blur(minutes);
    expect(onConfig).toHaveBeenCalledTimes(1);
  });

  it('clamps an out-of-range number instead of letting the server reject it', () => {
    const onConfig = vi.fn();
    render(<PartyLobby {...props(lobbyView(), onConfig)} />);
    const minutes = screen.getByLabelText(/minutes a round/i) as HTMLInputElement;

    fireEvent.change(minutes, { target: { value: '90' } });
    fireEvent.blur(minutes);
    expect(onConfig).toHaveBeenCalledWith({ roundMinutes: 60 });
    expect(minutes.value).toBe('60');
  });

  it('puts the dial back when the host blurs an empty box', () => {
    const onConfig = vi.fn();
    const view = lobbyView();
    render(<PartyLobby {...props(view, onConfig)} />);
    const candles = screen.getByLabelText(/candles/i) as HTMLInputElement;

    fireEvent.change(candles, { target: { value: '' } });
    fireEvent.blur(candles);
    expect(onConfig).not.toHaveBeenCalled();
    expect(candles.value).toBe(String(view.party.candles));
  });

  it('sends nothing when the typed number is the one already set', () => {
    const onConfig = vi.fn();
    const view = lobbyView();
    render(<PartyLobby {...props(view, onConfig)} />);
    const candles = screen.getByLabelText(/candles/i);

    fireEvent.change(candles, { target: { value: String(view.party.candles) } });
    fireEvent.blur(candles);
    expect(onConfig).not.toHaveBeenCalled();
  });

  it('hides the dials from a guest who is not the host', () => {
    render(<PartyLobby {...props(lobbyView({ isHost: false, mySlot: 1 }), vi.fn())} />);
    expect(screen.queryByLabelText(/candles/i)).toBeNull();
    expect(screen.getByText(/waiting for the host/i)).toBeDefined();
  });
});
