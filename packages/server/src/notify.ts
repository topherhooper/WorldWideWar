import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import type { NotifyKind, NotifyPrefs } from './api-types.js';
import type { Mailer } from './mailer.js';
import type { Pusher } from './pusher.js';
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
  /** Optional: absent means email only. */
  pusher?: Pusher;
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

/** Text up to the first blank line, trimmed and capped for a lock screen. */
function firstParagraph(text: string): string {
  const para = text.split(/\n\s*\n/)[0].trim();
  return para.length > 180 ? `${para.slice(0, 179)}…` : para;
}

/** Remove token strings FCM reported dead. Never throws. */
export async function pruneTokens(db: Firestore, uid: string, dead: string[]): Promise<void> {
  if (dead.length === 0) return;
  try {
    await usersCol(db)
      .doc(uid)
      .update({ pushTokens: FieldValue.arrayRemove(...dead) });
  } catch (err) {
    console.error(`[push] could not prune tokens for ${uid}:`, err);
  }
}

/**
 * The one door mail and pushes leave by. Every notification is gated on the
 * recipient's preferences here rather than at the call sites, so a new trigger
 * cannot forget to check — the same switches cover both channels, and every
 * email carries a working unsubscribe link.
 */
export async function notify(
  deps: NotifyDeps,
  kind: NotifyKind,
  recipients: Recipient[],
  mail: { subject: string; text: string; link?: string },
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

    const tokens = (snaps[i].data() as UserDoc | undefined)?.pushTokens ?? [];
    if (deps.pusher !== undefined && tokens.length > 0) {
      const { deadTokens } = await deps.pusher.send(tokens, {
        // The leading "[WWW] " tag is for inbox filters; it is noise on a lock screen.
        title: mail.subject.replace(/^\[[^\]]*\]\s*/, ''),
        body: firstParagraph(mail.text),
        link: mail.link ?? deps.baseUrl,
      });
      await pruneTokens(deps.db, recipient.uid, deadTokens);
    }
  }
}
