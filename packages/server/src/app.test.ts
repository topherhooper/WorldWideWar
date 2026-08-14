import { beforeEach, describe, expect, it } from 'vitest';

import { emulatorDb, clearFirestore, stubVerifiers, TEST_UNSUB_SECRET } from './testing.js';
import { unsubSigner } from './unsub.js';
import { LogMailer } from './mailer.js';
import type { AuthedUser } from './games.js';
import { buildApp } from './app.js';

const alice: AuthedUser = { uid: 'u-alice', name: 'Alice', email: 'alice@test.dev' };
const bob: AuthedUser = { uid: 'u-bob', name: 'Bob', email: 'bob@test.dev' };

const H = (t: string) => ({ authorization: `Bearer ${t}` });

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('http app', () => {
  const db = emulatorDb();
  let mailer: LogMailer;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    await clearFirestore();
    mailer = new LogMailer();
    app = buildApp({
      db,
      mailer,
      verifiers: stubVerifiers({ 'tok-a': alice, 'tok-b': bob }),
      baseUrl: 'http://x',
      signer: unsubSigner(TEST_UNSUB_SECRET),
    });
  });

  it('plays a full lifecycle over HTTP', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: H('tok-a'),
      payload: { playerCount: 2, turnMinutes: 60 },
    });
    expect(create.statusCode).toBe(200);
    const { id } = create.json<{ id: string }>();

    const join = await app.inject({
      method: 'POST',
      url: `/api/games/${id}/join`,
      headers: H('tok-b'),
    });
    expect(join.statusCode).toBe(200);
    expect(join.json<{ status: string }>().status).toBe('active');

    const list = await app.inject({ method: 'GET', url: '/api/games', headers: H('tok-a') });
    expect(list.json<{ id: string }[]>().map((g) => g.id)).toContain(id);

    const lockA = await app.inject({
      method: 'PUT',
      url: `/api/games/${id}/orders`,
      headers: H('tok-a'),
      payload: { orders: { slot: 0, pledge: 1, deploys: [], units: [] }, locked: true },
    });
    expect(lockA.statusCode).toBe(200);
    expect(lockA.json<{ resolved: boolean }>().resolved).toBe(false);

    const lockB = await app.inject({
      method: 'PUT',
      url: `/api/games/${id}/orders`,
      headers: H('tok-b'),
      payload: { orders: { slot: 1, pledge: 0, deploys: [], units: [] }, locked: true },
    });
    expect(lockB.json<{ resolved: boolean }>().resolved).toBe(true);

    const report = await app.inject({
      method: 'GET',
      url: `/api/games/${id}/reports/1`,
      headers: H('tok-a'),
    });
    expect(report.statusCode).toBe(200);
    expect(report.json<{ pacts: unknown[] }>().pacts.length).toBeGreaterThan(0);
    expect(report.body).not.toContain('seed');

    const missing = await app.inject({
      method: 'GET',
      url: `/api/games/${id}/reports/7`,
      headers: H('tok-a'),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects unauthenticated requests', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/games' })).statusCode).toBe(401);
  });

  it('guards the tick route', async () => {
    expect((await app.inject({ method: 'POST', url: '/internal/tick' })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/internal/tick', headers: H('tick-ok') });
    expect(ok.statusCode).toBe(200);
  });

  it('serves health', async () => {
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });

  describe('preferences', () => {
    const ALL_ON = { turnResolved: true, gameOver: true, reminder: true };

    it('starts every kind on', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/prefs', headers: H('tok-a') });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(ALL_ON);
    });

    it('round-trips a partial update', async () => {
      const put = await app.inject({
        method: 'PUT',
        url: '/api/prefs',
        headers: H('tok-a'),
        payload: { reminder: false },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json()).toEqual({ ...ALL_ON, reminder: false });

      const get = await app.inject({ method: 'GET', url: '/api/prefs', headers: H('tok-a') });
      expect(get.json()).toEqual({ ...ALL_ON, reminder: false });
    });

    it('keeps one player out of another player’s preferences', async () => {
      await app.inject({
        method: 'PUT',
        url: '/api/prefs',
        headers: H('tok-a'),
        payload: { reminder: false },
      });
      const bobPrefs = await app.inject({ method: 'GET', url: '/api/prefs', headers: H('tok-b') });
      expect(bobPrefs.json()).toEqual(ALL_ON);
    });

    it('rejects unknown keys and non-boolean values', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/prefs',
        headers: H('tok-a'),
        payload: { reminder: 'nope', evil: true },
      });
      expect(res.statusCode).toBe(400);
    });

    it('requires authentication', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/prefs' })).statusCode).toBe(401);
    });
  });

  describe('unsubscribe', () => {
    const sig = unsubSigner(TEST_UNSUB_SECRET).sign(alice.uid);
    const link = `/unsubscribe?u=${alice.uid}&s=${encodeURIComponent(sig)}`;

    const prefsOf = async (token: string) =>
      (await app.inject({ method: 'GET', url: '/api/prefs', headers: H(token) })).json();

    it('turns every kind off on POST, without a login', async () => {
      const res = await app.inject({ method: 'POST', url: link });
      expect(res.statusCode).toBe(200);
      expect(await prefsOf('tok-a')).toEqual({
        turnResolved: false,
        gameOver: false,
        reminder: false,
      });
    });

    it('shows a confirmation page on GET but changes nothing', async () => {
      const res = await app.inject({ method: 'GET', url: link });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Unsubscribe');
      // Mail scanners prefetch every link in an email; a mutating GET would
      // unsubscribe players who never clicked.
      expect(await prefsOf('tok-a')).toEqual({
        turnResolved: true,
        gameOver: true,
        reminder: true,
      });
    });

    it('explains a broken link in HTML, not JSON', async () => {
      // Mail clients wrap and truncate long URLs, so real people land here.
      const res = await app.inject({ method: 'GET', url: '/unsubscribe?u=u-alice&s=truncated' });
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).not.toContain('{"error"');
      expect(res.body).toContain('/settings');
    });

    it('explains a broken POST in HTML too', async () => {
      const res = await app.inject({ method: 'POST', url: '/unsubscribe?u=u-alice&s=truncated' });
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('still answers api routes with json', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/games' });
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.json()).toHaveProperty('error');
    });

    it('rejects a signature that does not match the uid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/unsubscribe?u=${bob.uid}&s=${encodeURIComponent(sig)}`,
      });
      expect(res.statusCode).toBe(400);
      expect(await prefsOf('tok-b')).toEqual({
        turnResolved: true,
        gameOver: true,
        reminder: true,
      });
    });

    it('accepts the form-encoded POST that the confirm page and Gmail send', async () => {
      const res = await app.inject({
        method: 'POST',
        url: link,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'List-Unsubscribe=One-Click',
      });
      expect(res.statusCode).toBe(200);
      expect(await prefsOf('tok-a')).toEqual({
        turnResolved: false,
        gameOver: false,
        reminder: false,
      });
    });

    it('reads credentials from a form-encoded body when the URL has none', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/unsubscribe',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ u: alice.uid, s: sig }).toString(),
      });
      expect(res.statusCode).toBe(200);
      expect(await prefsOf('tok-a')).toEqual({
        turnResolved: false,
        gameOver: false,
        reminder: false,
      });
    });

    it('rejects a missing signature', async () => {
      expect(
        (await app.inject({ method: 'POST', url: `/unsubscribe?u=${alice.uid}` })).statusCode,
      ).toBe(400);
    });
  });
});
