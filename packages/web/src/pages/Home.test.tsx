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
const { Home } = await import('./Home.js');

describe('Home', () => {
  // No global cleanup is configured, so each render must unmount its own tree or
  // `screen` matches every test's DOM at once.
  afterEach(cleanup);

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

  // /party is a Hosting rewrite to a separate Cloud Run service, so this has to stay a
  // real anchor with a real href -- a react-router <Link> would keep the navigation
  // inside the SPA and land on the catch-all instead.
  it('offers the dinner party as a plain link out of the app', () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    const link = screen.getByTestId('dinner-party');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/party');
  });
});
