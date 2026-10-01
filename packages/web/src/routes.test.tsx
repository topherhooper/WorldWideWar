// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => {
  let authCallback: ((user: unknown) => void) | null = null;
  return {
    getAuth: vi.fn(() => ({})),
    connectAuthEmulator: vi.fn(),
    GoogleAuthProvider: class {},
    onAuthStateChanged: vi.fn((_auth: unknown, cb: (user: unknown) => void) => {
      authCallback = cb;
      return () => {};
    }),
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
    getRedirectResult: vi.fn(() => Promise.resolve(null)),
    signOut: vi.fn(),
    __setUser: (user: unknown) => authCallback?.(user),
  };
});
vi.mock('./push.js', () => ({
  disablePush: vi.fn(() => Promise.resolve()),
  enablePush: vi.fn(() => Promise.resolve()),
  pushStatus: vi.fn(() => new Promise(() => {})),
}));
vi.mock('./api.js', () => ({
  api: {
    listGames: vi.fn().mockResolvedValue([]),
    pastMembers: vi.fn().mockResolvedValue([]),
    joinPoll: vi.fn(() => new Promise(() => {})),
    getPrefs: vi.fn(() => new Promise(() => {})),
  },
  ApiError: class ApiError extends Error {},
}));

const firebaseAuth = await import('firebase/auth');
const setUser = (firebaseAuth as unknown as { __setUser: (u: unknown) => void }).__setUser;
const { AuthProvider } = await import('./auth.js');
const { routes } = await import('./routes.js');

const SIGNED_IN = { uid: 'u1', displayName: 'Bob', email: 'bob@test.dev' };

function renderAt(path: string, user: unknown) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  act(() => setUser(user));
}

describe('routes', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders /p/new as the new-poll form, not the poll gate', async () => {
    renderAt('/p/new', SIGNED_IN);
    expect(await screen.findByRole('heading', { name: 'New poll' })).toBeTruthy();
  });

  it('still puts every other route behind the sign-in card when signed out', async () => {
    for (const path of ['/', '/settings', '/p', '/p/new', '/g/abc']) {
      renderAt(path, null);
      expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeTruthy();
      expect(screen.getByText(/simultaneous secret orders/i)).toBeTruthy();
      cleanup();
    }
  });

  it('shows a signed-out friend what they are signing in for, on the poll link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            title: 'Board games',
            organizerName: 'Alice',
            memberCount: 2,
            status: 'open',
          }),
      }),
    );
    renderAt('/p/abc', null);
    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(screen.getByText('Board games')).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/polls/abc/preview');
  });

  it('says a cancelled or missing poll is gone, signed out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    renderAt('/p/gone', null);
    expect(await screen.findByText(/cancelled or doesn.t exist/i)).toBeTruthy();
  });

  it('labels the top bar Quorum on poll routes and the game elsewhere, and hides the user bar signed out', async () => {
    renderAt('/p/new', SIGNED_IN);
    expect(await screen.findByRole('link', { name: 'Quorum' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Polls' })).toBeTruthy();
    cleanup();
    renderAt('/settings', SIGNED_IN);
    expect(await screen.findByRole('link', { name: 'World Wide War' })).toBeTruthy();
    cleanup();
    renderAt('/p/abc', null);
    await screen.findByRole('button', { name: /sign in with google/i });
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
  });
});
