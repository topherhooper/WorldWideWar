// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

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

const firebaseAuth = await import('firebase/auth');
const signInWithPopup = vi.mocked(firebaseAuth.signInWithPopup);
const signInWithRedirect = vi.mocked(firebaseAuth.signInWithRedirect);
const setUser = (firebaseAuth as unknown as { __setUser: (user: unknown) => void }).__setUser;

const { AuthProvider, RequireAuth } = await import('./auth.js');

function renderSignedOut() {
  const result = render(
    <AuthProvider>
      <RequireAuth>
        <div>app-content</div>
      </RequireAuth>
    </AuthProvider>,
  );
  act(() => setUser(null));
  return result;
}

const signInButton = () => screen.getByRole('button', { name: /sign in with google/i });

describe('first-time sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('falls back to a full-page redirect when the popup is blocked', async () => {
    signInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked', message: 'blocked' });
    signInWithRedirect.mockResolvedValueOnce(undefined as never);
    renderSignedOut();
    await act(async () => {
      signInButton().click();
    });
    expect(signInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('shows a message instead of failing silently when sign-in errors', async () => {
    signInWithPopup.mockRejectedValueOnce({
      code: 'auth/popup-closed-by-user',
      message: 'closed',
    });
    renderSignedOut();
    await act(async () => {
      signInButton().click();
    });
    expect(signInWithRedirect).not.toHaveBeenCalled();
    expect(await screen.findByText(/closed before finishing/i)).toBeTruthy();
  });

  it('surfaces unexpected sign-in failures', async () => {
    signInWithPopup.mockRejectedValueOnce({
      code: 'auth/internal-error',
      message: 'auth/internal-error',
    });
    renderSignedOut();
    await act(async () => {
      signInButton().click();
    });
    expect(await screen.findByText(/auth\/internal-error/i)).toBeTruthy();
  });

  it('renders the app once signed in', () => {
    renderSignedOut();
    act(() => setUser({ uid: 'u1', displayName: 'Al' }));
    expect(screen.getByText('app-content')).toBeTruthy();
  });
});
