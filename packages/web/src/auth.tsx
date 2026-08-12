import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
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
      await signInWithPopup(auth, new GoogleAuthProvider());
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
  if (user === undefined) return <div className="center-card">Loading…</div>;
  if (user === null) {
    return (
      <div className="center-card">
        <h1>World Wide War</h1>
        <p>Simultaneous secret orders. Blind pacts. Public betrayal.</p>
        <button onClick={() => void signIn()}>Sign in with Google</button>
      </div>
    );
  }
  return <>{children}</>;
}
