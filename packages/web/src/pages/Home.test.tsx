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
});
