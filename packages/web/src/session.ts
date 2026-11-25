import type { User } from 'firebase/auth';

/**
 * The browser half of the shared sign-in across topherhooper.com sites; the server half and
 * the reasoning are in packages/server/src/session.ts.
 *
 * Every call here is best-effort. A failure leaves the player signed in (or out) on this site
 * exactly as before, which is the right fallback for a convenience feature.
 */

const HINT_COOKIE = 'th_session';

/** True when the readable hint says a shared session cookie exists for this browser. */
export function hasSharedSession(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${HINT_COOKIE}=1`));
}

/** A custom token for the user behind the shared cookie, or null if there is none. */
export async function sharedSessionToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/session/token', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return null;
    const { token } = (await res.json()) as { token?: unknown };
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

let sharing: { uid: string; done: Promise<void> } | null = null;

/**
 * Make sure a signed-in user also has the shared cookie, so sibling sites see them. The auth
 * listener and the /signin hand-off both ask at once; they share one request.
 */
export function shareSession(user: User): Promise<void> {
  if (hasSharedSession()) return Promise.resolve();
  if (sharing?.uid !== user.uid) sharing = { uid: user.uid, done: postSession(user) };
  return sharing.done;
}

async function postSession(user: User): Promise<void> {
  try {
    // Forced refresh: the server only accepts a token minted in the last few minutes.
    const idToken = await user.getIdToken(true);
    await fetch('/api/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
  } catch {
    // Signed in here regardless; the other sites just won't know yet.
  }
}

export async function endSharedSession(): Promise<void> {
  sharing = null;
  try {
    await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' });
  } catch {
    // Nothing to undo if the server is unreachable.
  }
}

/**
 * Where /signin and /signout may send the browser afterwards: only https pages on
 * topherhooper.com or a subdomain of it, so the routes cannot be used as an open redirect.
 */
export function safeReturnUrl(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname;
    const ours = host === 'topherhooper.com' || host.endsWith('.topherhooper.com');
    return url.protocol === 'https:' && ours ? url.toString() : null;
  } catch {
    return null;
  }
}
