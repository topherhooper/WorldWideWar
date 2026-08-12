// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { GameView } from '@www/server/api-types';

import { useGame } from './useGame.js';

vi.mock('./api.js', () => ({
  api: {
    getGame: vi.fn(),
    submitOrders: vi.fn(),
  },
}));

const { api } = await import('./api.js');
const getGame = vi.mocked(api.getGame);
const submitOrders = vi.mocked(api.submitOrders);

const view = (over: Partial<GameView>): GameView =>
  ({
    id: 'g1',
    status: 'active',
    playerCount: 2,
    seats: [],
    turn: 1,
    deadlineAt: null,
    turnMinutes: 60,
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

describe('useGame', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getGame.mockResolvedValue(view({}));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fetches on mount', async () => {
    const { result } = renderHook(() => useGame('g1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getGame).toHaveBeenCalledTimes(1);
    expect(result.current.view?.id).toBe('g1');
  });

  it('polls every 15s while unlocked', async () => {
    renderHook(() => useGame('g1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(getGame).toHaveBeenCalledTimes(2);
  });

  it('tightens to 5s after locking', async () => {
    getGame.mockResolvedValue(view({ myLocked: true }));
    renderHook(() => useGame('g1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(getGame).toHaveBeenCalledTimes(2);
  });

  it('saveOrders installs the response view and returns warnings', async () => {
    const { result } = renderHook(() => useGame('g1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const orders = { slot: 0, pledge: null, deploys: [], units: [] };
    submitOrders.mockResolvedValue({
      warnings: ['bad move'],
      resolved: false,
      view: view({ myOrders: orders }),
    });
    let warnings: string[] = [];
    await act(async () => {
      warnings = await result.current.saveOrders(orders, false);
    });
    expect(warnings).toEqual(['bad move']);
    expect(result.current.view?.myOrders).toEqual(orders);
  });
});
