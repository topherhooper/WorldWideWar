// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { NotifyPrefs } from '@www/server/api-types';

import type { PushStatus } from '../push.js';

const getPrefs = vi.fn<() => Promise<NotifyPrefs>>();
const updatePrefs = vi.fn<(patch: Partial<NotifyPrefs>) => Promise<NotifyPrefs>>();
const testPush = vi.fn<() => Promise<{ sent: number }>>();
const pushStatus = vi.fn<() => Promise<PushStatus>>();
const enablePush = vi.fn<() => Promise<PushStatus>>();
const disablePush = vi.fn<() => Promise<PushStatus>>();

vi.mock('../api.js', () => ({
  api: {
    getPrefs: (...args: []) => getPrefs(...args),
    updatePrefs: (...args: [Partial<NotifyPrefs>]) => updatePrefs(...args),
    testPush: () => testPush(),
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../push.js', () => ({
  pushStatus: () => pushStatus(),
  enablePush: () => enablePush(),
  disablePush: () => disablePush(),
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
    pushStatus.mockResolvedValue('off');
    testPush.mockResolvedValue({ sent: 1 });
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

  describe('phone notifications', () => {
    it('says what the switches cover', async () => {
      render(<Settings />);
      expect(await screen.findByText(/each switch covers email and phone/i)).toBeTruthy();
    });

    it.each([
      ['unsupported', /can.t receive notifications/i],
      ['needs-install', /add to home screen/i],
      ['blocked', /blocked for this site/i],
      ['off', /turn on notifications on this device/i],
      ['on', /notifications are on for this device/i],
    ] as const)('renders the %s state', async (status, text) => {
      pushStatus.mockResolvedValue(status);
      render(<Settings />);
      expect(await screen.findByText(text)).toBeTruthy();
    });

    it('turns notifications on from the button', async () => {
      enablePush.mockResolvedValue('on');
      render(<Settings />);
      const button = await screen.findByRole('button', { name: /turn on notifications/i });
      await act(async () => {
        button.click();
      });
      expect(enablePush).toHaveBeenCalledTimes(1);
      expect(await screen.findByText(/notifications are on for this device/i)).toBeTruthy();
    });

    it('sends a test and says so', async () => {
      pushStatus.mockResolvedValue('on');
      render(<Settings />);
      const button = await screen.findByRole('button', { name: /send a test/i });
      await act(async () => {
        button.click();
      });
      expect(testPush).toHaveBeenCalledTimes(1);
      expect(await screen.findByText(/it should arrive in a few seconds/i)).toBeTruthy();
    });

    it('reports a failed test', async () => {
      pushStatus.mockResolvedValue('on');
      testPush.mockRejectedValue(new Error('no devices registered'));
      render(<Settings />);
      const button = await screen.findByRole('button', { name: /send a test/i });
      await act(async () => {
        button.click();
      });
      expect(await screen.findByText(/no devices registered/i)).toBeTruthy();
    });
  });
});
