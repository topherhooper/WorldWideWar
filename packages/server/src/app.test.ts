import { beforeEach, describe, expect, it } from 'vitest';

import { emulatorDb, clearFirestore, stubVerifiers } from './testing.js';
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
});
