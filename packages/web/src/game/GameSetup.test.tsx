// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { GameView } from '@www/server/api-types';
import { rulesFor } from '@www/engine';

vi.mock('../api.js', () => ({
  api: { updateConfig: vi.fn() },
  ApiError: class extends Error {},
}));

const { api } = await import('../api.js');
const { GameSetup } = await import('./GameSetup.js');

const view = (over: Partial<GameView>): GameView =>
  ({
    id: 'g1',
    status: 'lobby',
    playerCount: 4,
    seats: [],
    turn: 1,
    deadlineAt: null,
    turnMinutes: 60,
    contest: 'pact',
    turnCap: 15,
    rules: rulesFor(4, 15, 'pact'),
    presetId: 'pact-blitz',
    presetName: 'Pact Blitz',
    tiersTopic: null,
    lobbyListSlots: [],
    map: {} as GameView['map'],
    state: null,
    mySlot: 0,
    myOrders: null,
    myLocked: false,
    lockedSlots: [],
    latestReport: null,
    result: null,
    ...over,
  }) as GameView;

describe('GameSetup', () => {
  afterEach(cleanup);

  it('creator edits player count', async () => {
    vi.mocked(api.updateConfig).mockResolvedValue(view({}));
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<GameSetup view={view({})} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText(/players/i), { target: { value: '6' } });
    await waitFor(() =>
      expect(vi.mocked(api.updateConfig)).toHaveBeenCalledWith('g1', { playerCount: 6 }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('turn length edits convert units to minutes on blur', async () => {
    vi.mocked(api.updateConfig).mockResolvedValue(view({}));
    render(<GameSetup view={view({ turnMinutes: 60 })} onChanged={vi.fn().mockResolvedValue(0)} />);
    const value = screen.getByLabelText(/^turn length$/i); // exact — the unit select is named 'turn length unit'
    fireEvent.change(value, { target: { value: '2' } }); // unit is 'hours' for 60m
    fireEvent.blur(value);
    await waitFor(() =>
      expect(vi.mocked(api.updateConfig)).toHaveBeenCalledWith('g1', { turnMinutes: 120 }),
    );
  });

  it('non-creators see settings read-only', () => {
    render(<GameSetup view={view({ mySlot: 1 })} onChanged={vi.fn()} />);
    expect(screen.queryByLabelText(/players/i)).toBeNull();
    expect(screen.getByText(/4 players/i)).toBeDefined();
    expect(screen.getByText(/15 turns/i)).toBeDefined();
  });
});
