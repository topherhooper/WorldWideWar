import { beforeEach, describe, expect, it } from 'vitest';

import { emulatorDb, clearFirestore } from './testing.js';
import { games } from './store.js';
import { LogMailer } from './mailer.js';
import {
  createGame,
  deleteGame,
  getView,
  joinGame,
  listGames,
  startGame,
  submitOrders,
  HttpError,
  type AuthedUser,
} from './games.js';

const alice: AuthedUser = { uid: 'u-alice', name: 'Alice', email: 'alice@test.dev' };
const bob: AuthedUser = { uid: 'u-bob', name: 'Bob', email: 'bob@test.dev' };

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('games service', () => {
  const db = emulatorDb();
  beforeEach(clearFirestore);

  it('creates a lobby game with creator in seat 0', async () => {
    const id = await createGame(db, alice, { playerCount: 4, turnMinutes: 60 });
    const view = await getView(db, id, alice);
    expect(view.status).toBe('lobby');
    expect(view.mySlot).toBe(0);
    expect(view.seats.filter((s) => s.taken)).toHaveLength(1);
    expect(view.state).toBeNull();
    expect(view.map.playerCount).toBe(4);
    const seed = (await games(db).doc(id).get()).get('seed') as string;
    expect(JSON.stringify(view)).not.toContain(seed);
  });

  it('rejects bad player counts', async () => {
    await expect(createGame(db, alice, { playerCount: 1, turnMinutes: 60 })).rejects.toThrow(
      HttpError,
    );
    await expect(createGame(db, alice, { playerCount: 4, turnMinutes: 0 })).rejects.toThrow(
      HttpError,
    );
  });

  it('auto-starts when the last seat fills', async () => {
    const id = await createGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    const view = await joinGame(db, id, bob);
    expect(view.status).toBe('active');
    expect(view.state).not.toBeNull();
    expect(view.deadlineAt).not.toBeNull();
    expect(view.mySlot).toBe(1);
  });

  it('rejects joining twice', async () => {
    const id = await createGame(db, alice, { playerCount: 3, turnMinutes: 60 });
    await expect(joinGame(db, id, alice)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('creator starts early; empty seats become bots', async () => {
    const id = await createGame(db, alice, { playerCount: 4, turnMinutes: 60 });
    await joinGame(db, id, bob);
    const view = await startGame(db, id, alice);
    expect(view.status).toBe('active');
    expect(view.seats.filter((s) => s.isBot)).toHaveLength(2);
    expect(view.seats.every((s) => s.taken)).toBe(true);
  });

  it('only the creator starts', async () => {
    const id = await createGame(db, alice, { playerCount: 4, turnMinutes: 60 });
    await joinGame(db, id, bob);
    await expect(startGame(db, id, bob)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('stores draft orders and reports warnings without blocking', async () => {
    const mailer = new LogMailer();
    const id = await createGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await joinGame(db, id, bob);
    const bad = { slot: 0, pledge: null, deploys: [{ to: 9999, count: 1 }], units: [] };
    const res = await submitOrders(db, mailer, 'http://x', id, alice, {
      orders: bad,
      locked: false,
    });
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.resolved).toBe(false);
    expect(res.view.myOrders).toEqual(bad);
    expect(res.view.lockedSlots).toEqual([]);
  });

  it('resolves early when the last human locks', async () => {
    const mailer = new LogMailer();
    const id = await createGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await joinGame(db, id, bob);
    const a = await submitOrders(db, mailer, 'http://x', id, alice, {
      orders: { slot: 0, pledge: null, deploys: [], units: [] },
      locked: true,
    });
    expect(a.resolved).toBe(false);
    expect(a.view.lockedSlots).toEqual([0]);
    const b = await submitOrders(db, mailer, 'http://x', id, bob, {
      orders: { slot: 1, pledge: null, deploys: [], units: [] },
      locked: true,
    });
    expect(b.resolved).toBe(true);
    expect(b.view.turn).toBe(2);
    expect(b.view.latestReport?.turn).toBe(1);
  });

  it('rejects orders from non-players', async () => {
    const mailer = new LogMailer();
    const id = await createGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await joinGame(db, id, bob);
    const carol: AuthedUser = { uid: 'u-carol', name: 'Carol', email: null };
    await expect(
      submitOrders(db, mailer, 'http://x', id, carol, {
        orders: { slot: 0, pledge: null, deploys: [], units: [] },
        locked: false,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('lists my games', async () => {
    const id = await createGame(db, alice, { playerCount: 4, turnMinutes: 60 });
    expect((await listGames(db, alice)).map((g) => g.id)).toContain(id);
    expect(await listGames(db, bob)).toEqual([]);
  });

  it('only the creator deletes a game, and it vanishes for everyone', async () => {
    const mailer = new LogMailer();
    const id = await createGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await joinGame(db, id, bob); // auto-starts; both players now list it
    await submitOrders(db, mailer, 'http://x', id, alice, {
      orders: { slot: 0, pledge: null, deploys: [], units: [] },
      locked: false,
    });

    await expect(deleteGame(db, id, bob)).rejects.toMatchObject({ statusCode: 403 });
    await deleteGame(db, id, alice);

    expect((await games(db).doc(id).get()).exists).toBe(false);
    expect(await listGames(db, alice)).toEqual([]);
    expect(await listGames(db, bob)).toEqual([]);
    await expect(getView(db, id, alice)).rejects.toMatchObject({ statusCode: 404 });
    await expect(deleteGame(db, id, alice)).rejects.toMatchObject({ statusCode: 404 });
  });
});
