import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getAuth } from 'firebase-admin/auth';

import { HttpError } from './games.js';

/**
 * One sign-in across topherhooper.com and its subdomains.
 *
 * Firebase Auth keeps its session per origin, so signing in on play. does nothing for the
 * front page or garden. This bridges that with a Firebase session cookie scoped to the parent
 * domain: play. trades a fresh ID token for the cookie, and any sibling site (whose Hosting
 * config rewrites `/api/session/**` here) can read who is signed in or trade the cookie back
 * for a custom token and sign its own Firebase client in as the same user.
 *
 * The cookie is named `__session` because it is the only cookie Firebase Hosting forwards
 * to a Cloud Run rewrite; any other name is stripped before it reaches this server.
 */
export const SESSION_COOKIE = '__session';
/**
 * A readable companion to the HttpOnly session cookie, with the same scope and lifetime. It
 * carries nothing secret; it only tells page scripts that a shared session exists, so a
 * signed-out visitor costs no request and a signed-in one is not left waiting on one.
 */
export const HINT_COOKIE = 'th_session';
const SESSION_DAYS = 14;
/** A token older than this is refused for minting a cookie, which limits replaying a leaked one. */
const FRESH_TOKEN_SECONDS = 5 * 60;

export interface SessionUser {
  uid: string;
  name: string;
  email: string | null;
}

export interface Sessions {
  /** Trade a fresh Firebase ID token for a session cookie value. Throws HttpError(401). */
  create(idToken: string, expiresInMs: number): Promise<string>;
  /** The user behind a session cookie value. Throws HttpError(401) if expired or revoked. */
  verify(cookie: string): Promise<SessionUser>;
  /** A custom token that signs a Firebase client in as this user. */
  mintToken(uid: string): Promise<string>;
}

export function realSessions(): Sessions {
  return {
    async create(idToken, expiresInMs) {
      try {
        const decoded = await getAuth().verifyIdToken(idToken);
        if (Date.now() / 1000 - decoded.iat > FRESH_TOKEN_SECONDS) {
          throw new HttpError(401, 'stale token');
        }
        return await getAuth().createSessionCookie(idToken, { expiresIn: expiresInMs });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(401, 'invalid token');
      }
    },
    async verify(cookie) {
      try {
        const decoded = await getAuth().verifySessionCookie(cookie, true);
        return {
          uid: decoded.uid,
          name: (decoded.name as string | undefined) ?? decoded.email ?? 'Player',
          email: decoded.email ?? null,
        };
      } catch {
        throw new HttpError(401, 'no session');
      }
    },
    // Signing needs iam.serviceAccounts.signBlob on the runtime service account; see
    // docs/deployment.md "Shared sign-in".
    mintToken: (uid) => getAuth().createCustomToken(uid),
  };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

function cookieHeader(
  name: string,
  value: string,
  maxAgeSeconds: number,
  domain: string | undefined,
  httpOnly: boolean,
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    ...(domain !== undefined && domain !== '' ? [`Domain=${domain}`] : []),
    'Secure',
    ...(httpOnly ? ['HttpOnly'] : []),
    'SameSite=Lax',
  ].join('; ');
}

/** How long a browser remembers that it signed out, so other sites drop their own sign-in. */
const SIGNED_OUT_SECONDS = 400 * 24 * 60 * 60;

function signedInCookies(value: string, maxAgeSeconds: number, domain: string | undefined) {
  return [
    cookieHeader(SESSION_COOKIE, value, maxAgeSeconds, domain, true),
    cookieHeader(HINT_COOKIE, '1', maxAgeSeconds, domain, false),
  ];
}

/**
 * Signing out leaves the hint behind as `0` rather than removing it. Each site keeps its own
 * Firebase sign-in in the browser, and a missing hint cannot tell "signed out on another
 * site" from "has not shared a session yet"; `0` can, so a sign-out anywhere reaches them all.
 */
function signedOutCookies(domain: string | undefined) {
  return [
    cookieHeader(SESSION_COOKIE, '', 0, domain, true),
    cookieHeader(HINT_COOKIE, '0', SIGNED_OUT_SECONDS, domain, false),
  ];
}

/**
 * Never let the Hosting CDN cache a response that depends on who is asking. Hosting keys its
 * cache on `__session`, but `no-store` makes that moot rather than something to rely on.
 */
function noStore(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', 'private, no-store');
}

async function sessionUser(sessions: Sessions, req: FastifyRequest): Promise<SessionUser> {
  const cookie = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (cookie === undefined || cookie === '') throw new HttpError(401, 'no session');
  return sessions.verify(cookie);
}

/**
 * `cookieDomain` is the parent domain the cookie is scoped to (`topherhooper.com` in
 * production). Unset, the cookie is host-only, which is right for the test host and local dev:
 * a test session must not leak into the live site.
 */
export function registerSessionRoutes(
  app: FastifyInstance,
  sessions: Sessions,
  cookieDomain: string | undefined,
): void {
  app.post('/api/session', async (req, reply) => {
    noStore(reply);
    const { idToken } = (req.body ?? {}) as { idToken?: unknown };
    if (typeof idToken !== 'string' || idToken === '') throw new HttpError(400, 'idToken required');
    const expiresIn = SESSION_DAYS * 24 * 60 * 60 * 1000;
    const cookie = await sessions.create(idToken, expiresIn);
    void reply.header('set-cookie', signedInCookies(cookie, expiresIn / 1000, cookieDomain));
    return { ok: true };
  });

  app.delete('/api/session', async (_req, reply) => {
    noStore(reply);
    void reply.header('set-cookie', signedOutCookies(cookieDomain));
    return { ok: true };
  });

  app.get('/api/session/me', async (req, reply) => {
    noStore(reply);
    const { name, email } = await sessionUser(sessions, req);
    return { name, email };
  });

  app.post('/api/session/token', async (req, reply) => {
    noStore(reply);
    const { uid } = await sessionUser(sessions, req);
    return { token: await sessions.mintToken(uid) };
  });
}
