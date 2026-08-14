// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../api.js', () => ({
  api: {
    listGames: vi.fn().mockResolvedValue([]),
    createGame: vi.fn().mockResolvedValue({ id: 'g9' }),
  },
  ApiError: class extends Error {},
}));

const { api } = await import('../api.js');
const { PRESETS } = await import('@www/engine');
const { Home } = await import('./Home.js');

// Vitest runs without `globals`, so testing-library never registers its own.
afterEach(cleanup);

describe('Home', () => {
  it('creates a game from a preset card', async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    expect(screen.getByText('Pact Blitz')).toBeDefined();
    expect(screen.getByText('Tiers v2')).toBeDefined();
    fireEvent.click(screen.getByTestId('preset-tiers-v2'));
    await waitFor(() =>
      expect(vi.mocked(api.createGame)).toHaveBeenCalledWith({ presetId: 'tiers-v2' }),
    );
  });

  it('cards only the preset of the day, and only on its day', () => {
    const today = new Date().toISOString().slice(0, 10);
    const dailies = PRESETS.filter((p) => p.featuredOn !== undefined);
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    for (const daily of dailies) {
      const card = screen.queryByTestId(`preset-${daily.id}`);
      if (daily.featuredOn === today) expect(card).not.toBeNull();
      else expect(card).toBeNull();
    }
    // One pill at most, whether or not the routine has run for today.
    expect(screen.queryAllByText('Preset of the day')).toHaveLength(
      dailies.some((p) => p.featuredOn === today) ? 1 : 0,
    );
  });
});
