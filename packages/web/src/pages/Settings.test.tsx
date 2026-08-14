// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { NotifyPrefs } from '@www/server/api-types';

const getPrefs = vi.fn<() => Promise<NotifyPrefs>>();
const updatePrefs = vi.fn<(patch: Partial<NotifyPrefs>) => Promise<NotifyPrefs>>();

vi.mock('../api.js', () => ({
  api: {
    getPrefs: (...args: []) => getPrefs(...args),
    updatePrefs: (...args: [Partial<NotifyPrefs>]) => updatePrefs(...args),
  },
  ApiError: class ApiError extends Error {},
}));

const { Settings } = await import('./Settings.js');

const ALL_ON: NotifyPrefs = { turnResolved: true, gameOver: true, reminder: true };

const box = (name: RegExp): HTMLInputElement =>
  screen.getByRole('checkbox', { name }) as HTMLInputElement;

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPrefs.mockResolvedValue({ ...ALL_ON });
    updatePrefs.mockImplementation((patch) => Promise.resolve({ ...ALL_ON, ...patch }));
  });
  afterEach(cleanup);

  it('shows each notification kind checked when all are on', async () => {
    render(<Settings />);
    await waitFor(() => expect(box(/turn/i).checked).toBe(true));
    expect(box(/game ends/i).checked).toBe(true);
    expect(box(/deadline/i).checked).toBe(true);
  });

  it('reflects a kind the player has already turned off', async () => {
    getPrefs.mockResolvedValue({ ...ALL_ON, reminder: false });
    render(<Settings />);
    await waitFor(() => expect(box(/deadline/i).checked).toBe(false));
    expect(box(/turn/i).checked).toBe(true);
  });

  it('saves only the toggled kind', async () => {
    render(<Settings />);
    await waitFor(() => expect(box(/deadline/i)).toBeTruthy());
    await act(async () => {
      box(/deadline/i).click();
    });
    expect(updatePrefs).toHaveBeenCalledWith({ reminder: false });
    await waitFor(() => expect(box(/deadline/i).checked).toBe(false));
  });

  it('restores the checkbox and explains when saving fails', async () => {
    updatePrefs.mockRejectedValue(new Error('offline'));
    render(<Settings />);
    await waitFor(() => expect(box(/deadline/i)).toBeTruthy());
    await act(async () => {
      box(/deadline/i).click();
    });
    // A checkbox that stays flipped after a failed save is a lie about server state.
    await waitFor(() => expect(box(/deadline/i).checked).toBe(true));
    expect(screen.getByText(/could not save/i)).toBeTruthy();
  });

  it('reports a failure to load rather than showing every kind as on', async () => {
    getPrefs.mockRejectedValue(new Error('offline'));
    render(<Settings />);
    expect(await screen.findByText(/could not load/i)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
