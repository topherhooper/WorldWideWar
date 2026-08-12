import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';

const useEmulators = import.meta.env.VITE_USE_EMULATORS === '1';

const app = initializeApp(
  useEmulators
    ? { apiKey: 'fake', projectId: 'demo-www', authDomain: 'localhost' }
    : {
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
      },
);

export const auth = getAuth(app);
if (useEmulators) connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });

/** Environments where a popup cannot work and the redirect flow can. */
function popupUnavailable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/operation-not-supported-in-this-environment'
  );
}

function describeAuthError(err: unknown): string {
  const { code, message } = (err as { code?: string; message?: string } | null) ?? {};
  if (code === 'auth/popup-closed-by-user') {
    return 'The sign-in window was closed before finishing — try again.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error during sign-in — check your connection and try again.';
  }
  return message ?? 'Sign-in failed — try again.';
}

interface AuthState {
  /** undefined = still restoring the session. */
  user: User | null | undefined;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const value: AuthState = {
    user,
    signIn: async () => {
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        // Popup-hostile environments (mobile browsers, strict blockers) get
        // the full-page redirect flow instead of a button that does nothing.
        if (!popupUnavailable(err)) throw err;
        await signInWithRedirect(auth, provider);
      }
    },
    signOut: () => fbSignOut(auth),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // A failed redirect round-trip lands back here; surface it like popup errors.
  useEffect(() => {
    getRedirectResult(auth).catch((err: unknown) => setError(describeAuthError(err)));
  }, []);

  if (user === undefined) return <div className="center-card">Loading…</div>;
  if (user === null) {
    return (
      <div className="center-card">
        <h1>World Wide War</h1>
        <p>Simultaneous secret orders. Blind pacts. Public betrayal.</p>
        <button
          onClick={() => {
            setError(null);
            void signIn().catch((err: unknown) => setError(describeAuthError(err)));
          }}
        >
          Sign in with Google
        </button>
        {error !== null && <p className="error">{error}</p>}
        <p className="muted">
          Opened this link from a chat app? If sign-in fails, open the page in your browser (Safari
          or Chrome) and try again.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
