/** Emulator helpers for integration tests. Never imported by production code. */

import type { Firestore } from 'firebase-admin/firestore';

import type { Verifiers } from './auth.js';
import { HttpError, type AuthedUser } from './games.js';
import { initFirestore } from './store.js';

const EMULATOR_PROJECT = 'demo-www';

export function emulatorDb(): Firestore {
  return initFirestore(EMULATOR_PROJECT);
}

export async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
  const res = await fetch(
    `http://${host}/emulator/v1/projects/${EMULATOR_PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(`failed to clear firestore emulator: ${res.status}`);
}

/** Sign up a throwaway user in the Auth emulator and return their ID token. */
export async function emulatorToken(email: string, name: string): Promise<string> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099';
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'password1',
        displayName: name,
        returnSecureToken: true,
      }),
    },
  );
  if (!res.ok) throw new Error(`auth emulator signUp failed: ${res.status}`);
  return ((await res.json()) as { idToken: string }).idToken;
}

/** Token-string-keyed verifiers for route tests; 'tick-ok' authorizes the tick. */
export function stubVerifiers(users: Record<string, AuthedUser>): Verifiers {
  return {
    async verifyUser(header): Promise<AuthedUser> {
      const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
      const user = token === undefined ? undefined : users[token];
      if (user === undefined) throw new HttpError(401, 'unknown test token');
      return user;
    },
    async verifyTick(header): Promise<void> {
      if (header !== 'Bearer tick-ok') throw new HttpError(401, 'bad tick token');
    },
  };
}
