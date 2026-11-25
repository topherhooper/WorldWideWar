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
    signInWithCustomToken: vi.fn(),
    getRedirectResult: vi.fn(() => Promise.resolve(null)),
    signOut: vi.fn(),
    __setUser: (user: unknown) => authCallback?.(user),
  };
});

const firebaseAuth = await import('firebase/auth');
const signInWithPopup = vi.mocked(firebaseAuth.signInWithPopup);
const signInWithRedirect = vi.mocked(firebaseAuth.signInWithRedirect);
const signInWithCustomToken = vi.mocked(firebaseAuth.signInWithCustomToken);
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

describe('shared sign-in from another topherhooper.com site', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.cookie = 'th_session=; max-age=0';
  });

  it('signs in from the shared cookie instead of showing the sign-in card', async () => {
    document.cookie = 'th_session=1';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => ({ token: 'custom-1' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AuthProvider>
        <RequireAuth>
          <div>app-content</div>
        </RequireAuth>
      </AuthProvider>,
    );
    await act(async () => setUser(null));
    expect(fetchMock).toHaveBeenCalledWith('/api/session/token', expect.anything());
    expect(signInWithCustomToken).toHaveBeenCalledWith(expect.anything(), 'custom-1');
    expect(screen.queryByRole('button', { name: /sign in with google/i })).toBeNull();
  });

  it('signs out here after a sign-out on another site', async () => {
    document.cookie = 'th_session=0';
    vi.stubGlobal('fetch', vi.fn());
    render(
      <AuthProvider>
        <RequireAuth>
          <div>app-content</div>
        </RequireAuth>
      </AuthProvider>,
    );
    await act(async () => setUser({ uid: 'u1', displayName: 'Al' }));
    expect(firebaseAuth.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('app-content')).toBeNull();
  });

  it('asks the server nothing when there is no shared session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderSignedOut();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(signInButton()).toBeTruthy();
  });
});
