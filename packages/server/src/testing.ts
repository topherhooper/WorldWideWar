/** Emulator helpers for integration tests. Never imported by production code. */

import type { Firestore } from 'firebase-admin/firestore';

import { initFirestore } from './store.js';

export const EMULATOR_PROJECT = 'demo-www';

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
