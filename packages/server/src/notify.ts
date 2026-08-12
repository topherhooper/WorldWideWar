import type { Firestore } from 'firebase-admin/firestore';

import type { NotifyKind, NotifyPrefs } from './api-types.js';
import type { Mailer } from './mailer.js';
import { usersCol, type UserDoc } from './store.js';
import type { UnsubSigner } from './unsub.js';

export type { NotifyKind, NotifyPrefs };

/** Silence is consent: a user doc without prefs gets every notification. */
export const DEFAULT_PREFS: NotifyPrefs = {
  turnResolved: true,
  gameOver: true,
  reminder: true,
};

export const NOTIFY_KINDS = Object.keys(DEFAULT_PREFS) as NotifyKind[];

/** A seat, structurally — bots and empty seats arrive as nulls and are dropped. */
export interface Recipient {
  uid: string | null;
  email: string | null;
}

export interface NotifyDeps {
  db: Firestore;
  mailer: Mailer;
  signer: UnsubSigner;
  baseUrl: string;
}

export async function readPrefs(db: Firestore, uid: string): Promise<NotifyPrefs> {
  const snap = await usersCol(db).doc(uid).get();
  return { ...DEFAULT_PREFS, ...((snap.data() as UserDoc | undefined)?.notify ?? {}) };
}

/**
 * Transactional because the settings page and an unsubscribe click can land at
 * the same moment, and a read-then-write pair silently drops the earlier one.
 */
export async function writePrefs(
  db: Firestore,
  uid: string,
  patch: Partial<NotifyPrefs>,
): Promise<NotifyPrefs> {
  const ref = usersCol(db).doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const merged = {
      ...DEFAULT_PREFS,
      ...((snap.data() as UserDoc | undefined)?.notify ?? {}),
      ...patch,
    };
    tx.set(ref, { notify: merged }, { merge: true });
    return merged;
  });
}

const unsubUrl = (deps: NotifyDeps, uid: string): string =>
  `${deps.baseUrl}/unsubscribe?u=${encodeURIComponent(uid)}&s=${encodeURIComponent(
    deps.signer.sign(uid),
  )}`;

/**
 * The one door mail leaves by. Every notification is gated on the recipient's
 * preferences here rather than at the call sites, so a new trigger cannot
 * forget to check — and every message carries a working unsubscribe link.
 */
export async function notify(
  deps: NotifyDeps,
  kind: NotifyKind,
  recipients: Recipient[],
  mail: { subject: string; text: string },
): Promise<void> {
  const addressable = recipients.filter(
    (r): r is { uid: string; email: string } => r.uid !== null && r.email !== null,
  );
  // getAll() rejects an empty ref list, and an all-bot game reaches here often.
  if (addressable.length === 0) return;

  const snaps = await deps.db.getAll(...addressable.map((r) => usersCol(deps.db).doc(r.uid)));

  for (const [i, recipient] of addressable.entries()) {
    const prefs = (snaps[i].data() as UserDoc | undefined)?.notify ?? {};
    if ((prefs[kind] ?? DEFAULT_PREFS[kind]) === false) continue;

    const url = unsubUrl(deps, recipient.uid);
    await deps.mailer.send({
      to: recipient.email,
      subject: mail.subject,
      text:
        `${mail.text}\n\n—\n` +
        `Choose which emails you get: ${deps.baseUrl}/settings\n` +
        `Unsubscribe from all World Wide War email: ${url}\n`,
      headers: {
        'List-Unsubscribe': `<${url}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  }
}
