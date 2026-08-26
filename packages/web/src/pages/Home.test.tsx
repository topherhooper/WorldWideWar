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

  // The grid maps over PRESETS, so a preset reaches players the moment it is
  // added -- this asserts the one that carries the cooperative mode is actually
  // on the page and sends its own id, since it is the only route to it.
  it('offers Survival, and creates it by preset id', async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    expect(screen.getByText('Survival')).toBeDefined();
    fireEvent.click(screen.getByTestId('preset-survival'));
    await waitFor(() =>
      expect(vi.mocked(api.createGame)).toHaveBeenCalledWith({ presetId: 'survival' }),
    );
  });

  // Restored from #30, which #31 removed along with the standalone service.
  // A button this time, not an anchor: the party creates a game and lands on
  // /g/:id like every other mode, so it needs no route of its own.
  // One render per card: the first click sets `creating`, which disables the
  // whole grid, so a second click in the same tree is correctly a no-op.
  it.each([
    ['dinner-party', 'traitor'],
    ['bedtime-party', 'together'],
  ])('creates the %s from the same grid, on the ordinary link', async (testId, mode) => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId(testId));
    await waitFor(() =>
      expect(vi.mocked(api.createGame)).toHaveBeenCalledWith({ kind: 'party', mode }),
    );
    cleanup();
  });

  it('creates a card game from the same grid', async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('sacre'));
    await waitFor(() =>
      expect(vi.mocked(api.createGame)).toHaveBeenCalledWith({ kind: 'cards', players: 4 }),
    );
    cleanup();
  });

  // The grid is scanned, not read in order, so a card has to say what game it
  // is on its own. This one is neither a war nor a party, which is the thing a
  // player most needs to know before clicking it.
  it('says what the card game is without leaning on another card', () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    const text = screen.getByTestId('sacre').textContent ?? '';
    expect(text).toContain('S.A.C.R.E.');
    expect(text).toMatch(/players/i);
    expect(text).not.toMatch(/the same|as above|like the other/i);
    cleanup();
  });

  // Each mode is a separate game, so each card has to stand on its own. The
  // bedtime card used to read "the same tale, but nobody here did it", which
  // names no story at all unless you read the card beside it first.
  it.each(['dinner-party', 'bedtime-party'])(
    'describes %s without leaning on another card',
    (testId) => {
      render(
        <MemoryRouter>
          <Home />
        </MemoryRouter>,
      );
      const text = screen.getByTestId(testId).textContent ?? '';
      expect(text).toContain('Sleeping Beauty');
      expect(text).not.toMatch(/the same|as above|like the other/i);
      cleanup();
    },
  );
});
