import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { HttpError } from './games.js';
import { readCookie, realSessions, registerSessionRoutes, type Sessions } from './session.js';
import { emulatorDb, emulatorToken } from './testing.js';

/** 'fresh' is a good ID token; a cookie value is `cookie:<uid>`; tokens are `custom:<uid>`. */
const stub: Sessions = {
  async create(idToken) {
    if (idToken !== 'fresh') throw new HttpError(401, 'invalid token');
    return 'cookie:u-alice';
  },
  async verify(cookie) {
    if (cookie !== 'cookie:u-alice') throw new HttpError(401, 'no session');
    return { uid: 'u-alice', name: 'Alice', email: 'alice@test.dev' };
  },
  async mintToken(uid) {
    return `custom:${uid}`;
  },
};

function app(domain?: string) {
  const a = Fastify();
  a.setErrorHandler((err, _req, reply) => {
    void reply.status(err instanceof HttpError ? err.statusCode : 500).send({});
  });
  registerSessionRoutes(a, stub, domain);
  return a;
}

describe('shared session routes', () => {
  it('sets a parent-domain cookie for a fresh ID token', async () => {
    const res = await app('topherhooper.com').inject({
      method: 'POST',
      url: '/api/session',
      payload: { idToken: 'fresh' },
    });
    expect(res.statusCode).toBe(200);
    const [session, hint] = res.headers['set-cookie'] as string[];
    expect(session).toContain('__session=cookie%3Au-alice');
    expect(session).toContain('Domain=topherhooper.com');
    expect(session).toContain('HttpOnly');
    expect(session).toContain('Secure');
    // The hint is readable by page scripts and says nothing but "a session exists".
    expect(hint).toContain('th_session=1');
    expect(hint).toContain('Domain=topherhooper.com');
    expect(hint).not.toContain('HttpOnly');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('keeps the cookie host-only when no domain is configured', async () => {
    const res = await app().inject({
      method: 'POST',
      url: '/api/session',
      payload: { idToken: 'fresh' },
    });
    expect(String(res.headers['set-cookie'])).not.toContain('Domain=');
  });

  it('refuses a bad ID token and sets nothing', async () => {
    const res = await app().inject({
      method: 'POST',
      url: '/api/session',
      payload: { idToken: 'stale' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('says who is signed in and mints a token from the cookie', async () => {
    const a = app();
    const headers = { cookie: 'other=1; __session=cookie%3Au-alice' };
    const me = await a.inject({ method: 'GET', url: '/api/session/me', headers });
    expect(me.json()).toEqual({ name: 'Alice', email: 'alice@test.dev' });
    const tok = await a.inject({ method: 'POST', url: '/api/session/token', headers });
    expect(tok.json()).toEqual({ token: 'custom:u-alice' });
  });

  it('answers 401 with no cookie', async () => {
    const a = app();
    expect((await a.inject({ method: 'GET', url: '/api/session/me' })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: '/api/session/token' })).statusCode).toBe(401);
  });

  it('signing out expires the cookie on the same domain', async () => {
    const res = await app('topherhooper.com').inject({ method: 'DELETE', url: '/api/session' });
    const [session, hint] = res.headers['set-cookie'] as string[];
    expect(session).toContain('__session=;');
    expect(hint).toContain('th_session=;');
    for (const c of [session, hint]) {
      expect(c).toContain('Max-Age=0');
      expect(c).toContain('Domain=topherhooper.com');
    }
  });

  it('reads one cookie out of a header', () => {
    expect(readCookie('a=1; b=two%3D; c=3', 'b')).toBe('two=');
    expect(readCookie('a=1', 'b')).toBeUndefined();
    expect(readCookie(undefined, 'b')).toBeUndefined();
  });
});

describe.skipIf(!process.env.FIREBASE_AUTH_EMULATOR_HOST)(
  'real sessions against the emulator',
  () => {
    emulatorDb(); // ensures the admin app is initialized
    const sessions = realSessions();

    it('round-trips ID token → cookie → user → custom token', async () => {
      const idToken = await emulatorToken('dana@test.dev', 'Dana');
      const cookie = await sessions.create(idToken, 60 * 60 * 1000);
      const user = await sessions.verify(cookie);
      expect(user).toMatchObject({ name: 'Dana', email: 'dana@test.dev' });
      expect(await sessions.mintToken(user.uid)).toBeTruthy();
    });

    it('rejects a garbage cookie and a garbage ID token', async () => {
      await expect(sessions.verify('garbage')).rejects.toMatchObject({ statusCode: 401 });
      await expect(sessions.create('garbage', 60_000)).rejects.toMatchObject({ statusCode: 401 });
    });
  },
);
