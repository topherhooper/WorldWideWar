import { beforeEach, describe, expect, it } from 'vitest';

import { emulatorDb, clearFirestore, createTestGame, testDeps } from './testing.js';
import { games } from './store.js';
import { LogMailer } from './mailer.js';
import {
  createGame,
  deleteGame,
  getView,
  joinGame,
  listGames,
  resolveNow,
  startGame,
  submitOrders,
  updateConfig,
  HttpError,
  type AuthedUser,
} from './games.js';

const alice: AuthedUser = { uid: 'u-alice', name: 'Alice', email: 'alice@test.dev' };
const bob: AuthedUser = { uid: 'u-bob', name: 'Bob', email: 'bob@test.dev' };
const carol: AuthedUser = { uid: 'u-carol', name: 'Carol', email: null };

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('games service', () => {
  const db = emulatorDb();
  beforeEach(clearFirestore);

  it('creates a lobby game from a preset', async () => {
    const id = await createGame(db, alice, { presetId: 'tiers-v2' });
    const view = await getView(db, id, alice);
    expect(view.status).toBe('lobby');
    expect(view.mySlot).toBe(0);
    expect(view.playerCount).toBe(4);
    expect(view.turnMinutes).toBe(60);
    expect(view.turnCap).toBe(8);
    expect(view.contest).toBe('tiers');
    expect(view.presetId).toBe('tiers-v2');
    expect(view.presetName).toBe('Tiers v2');
    expect(view.rules.tiersPayout).toBe('income');
    expect(view.rules.plunderIncome).toBe(2); // blitz presets run the hotter economy
    expect(view.rules.neutralGrowthInterval).toBe(0);
    const seed = (await games(db).doc(id).get()).get('seed') as string;
    expect(JSON.stringify(view)).not.toContain(seed);
  });

  it('rejects unknown presets', async () => {
    await expect(createGame(db, alice, { presetId: 'ranked' })).rejects.toThrow(HttpError);
  });

  // The API deploys ahead of the web bundle, and a loaded tab keeps its old
  // JS until someone reloads. A client from before presets sends `contest`
  // and no presetId, so rejecting that payload would break "create game" for
  // every player who had not reloaded yet.
  it('accepts a pre-preset client payload, mapping contest to its preset', async () => {
    const id = await createGame(db, alice, { contest: 'tiers' });
    const view = await getView(db, id, alice);
    expect(view.presetId).toBe('tiers');
    expect(view.contest).toBe('tiers');
  });

  it('defaults a payload with neither presetId nor contest to pact', async () => {
    const id = await createGame(db, alice, {});
    const view = await getView(db, id, alice);
    expect(view.presetId).toBe('pact');
  });

  it('auto-starts when the last seat fills', async () => {
    const id = await createTestGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    const view = await joinGame(db, id, bob);
    expect(view.status).toBe('active');
    expect(view.state).not.toBeNull();
    expect(view.deadlineAt).not.toBeNull();
    expect(view.mySlot).toBe(1);
  });

  it('rejects joining twice', async () => {
    const id = await createTestGame(db, alice, { playerCount: 3, turnMinutes: 60 });
    await expect(joinGame(db, id, alice)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('creator starts early; empty seats become bots', async () => {
    const id = await createTestGame(db, alice, { playerCount: 4, turnMinutes: 60 });
    await joinGame(db, id, bob);
    const view = await startGame(db, id, alice);
    expect(view.status).toBe('active');
    expect(view.seats.filter((s) => s.isBot)).toHaveLength(2);
    expect(view.seats.every((s) => s.taken)).toBe(true);
  });

  it('only the creator starts', async () => {
    const id = await createTestGame(db, alice, { playerCount: 4, turnMinutes: 60 });
    await joinGame(db, id, bob);
    await expect(startGame(db, id, bob)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('stores draft orders and reports warnings without blocking', async () => {
    const mailer = new LogMailer();
    const id = await createTestGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await joinGame(db, id, bob);
    const bad = { slot: 0, pledge: null, deploys: [{ to: 9999, count: 1 }], units: [] };
    const res = await submitOrders(testDeps(db, mailer), id, alice, {
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
    const id = await createTestGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await joinGame(db, id, bob);
    const a = await submitOrders(testDeps(db, mailer), id, alice, {
      orders: { slot: 0, pledge: null, deploys: [], units: [] },
      locked: true,
    });
    expect(a.resolved).toBe(false);
    expect(a.view.lockedSlots).toEqual([0]);
    const b = await submitOrders(testDeps(db, mailer), id, bob, {
      orders: { slot: 1, pledge: null, deploys: [], units: [] },
      locked: true,
    });
    expect(b.resolved).toBe(true);
    expect(b.view.turn).toBe(2);
    expect(b.view.latestReport?.turn).toBe(1);
  });

  it('a locked player can unlock and edit until the turn resolves', async () => {
    const mailer = new LogMailer();
    const id = await createTestGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await joinGame(db, id, bob);
    const orders = { slot: 0, pledge: null, deploys: [], units: [] };
    const lockedRes = await submitOrders(testDeps(db, mailer), id, alice, {
      orders,
      locked: true,
    });
    expect(lockedRes.view.lockedSlots).toEqual([0]);

    const unlocked = await submitOrders(testDeps(db, mailer), id, alice, {
      orders,
      locked: false,
    });
    expect(unlocked.resolved).toBe(false);
    expect(unlocked.view.myLocked).toBe(false);
    expect(unlocked.view.lockedSlots).toEqual([]);
    expect(unlocked.view.turn).toBe(1);

    // Re-locking still resolves once the whole table is in.
    await submitOrders(testDeps(db, mailer), id, alice, { orders, locked: true });
    const b = await submitOrders(testDeps(db, mailer), id, bob, {
      orders: { slot: 1, pledge: null, deploys: [], units: [] },
      locked: true,
    });
    expect(b.resolved).toBe(true);
    expect(b.view.turn).toBe(2);
  });

  it('creator resolves the turn early; unlocked drafts still count', async () => {
    const mailer = new LogMailer();
    const id = await createTestGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await joinGame(db, id, bob);
    await submitOrders(testDeps(db, mailer), id, alice, {
      orders: { slot: 0, pledge: null, deploys: [], units: [] },
      locked: false,
    });
    const view = await resolveNow(testDeps(db, mailer), id, alice);
    expect(view.turn).toBe(2);
    expect(view.latestReport?.turn).toBe(1);
  });

  it('only the creator resolves early, and only while active', async () => {
    const mailer = new LogMailer();
    const id = await createTestGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await expect(resolveNow(testDeps(db, mailer), id, alice)).rejects.toMatchObject({
      statusCode: 409,
    });
    await joinGame(db, id, bob);
    await expect(resolveNow(testDeps(db, mailer), id, bob)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('rejects orders from non-players', async () => {
    const mailer = new LogMailer();
    const id = await createTestGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await joinGame(db, id, bob);
    const carol: AuthedUser = { uid: 'u-carol', name: 'Carol', email: null };
    await expect(
      submitOrders(testDeps(db, mailer), id, carol, {
        orders: { slot: 0, pledge: null, deploys: [], units: [] },
        locked: false,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('lists my games', async () => {
    const id = await createTestGame(db, alice, { playerCount: 4, turnMinutes: 60 });
    expect((await listGames(db, alice)).map((g) => g.id)).toContain(id);
    expect(await listGames(db, bob)).toEqual([]);
  });

  it('only the creator deletes a game, and it vanishes for everyone', async () => {
    const mailer = new LogMailer();
    const id = await createTestGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await joinGame(db, id, bob); // auto-starts; both players now list it
    await submitOrders(testDeps(db, mailer), id, alice, {
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

  describe('updateConfig', () => {
    it('creator retunes players, turn length and cap; rules and map follow', async () => {
      const id = await createTestGame(db, alice, { playerCount: 4, turnMinutes: 60 });
      const view = await updateConfig(db, id, alice, {
        playerCount: 6,
        turnMinutes: 45,
        turnCap: 15,
      });
      expect(view.playerCount).toBe(6);
      expect(view.turnMinutes).toBe(45);
      expect(view.turnCap).toBe(15);
      expect(view.rules.stormFirstWave).toBe(6); // rebuilt for the new cap
      expect(view.map.playerCount).toBe(6); // map regenerated
      expect(view.seats).toHaveLength(6);
      expect(view.seats[0].taken).toBe(true); // creator kept their seat
    });

    it('rejects non-creators, non-lobby games, and out-of-bounds values', async () => {
      const id = await createTestGame(db, alice, { playerCount: 2, turnMinutes: 60 });
      await expect(updateConfig(db, id, bob, { turnCap: 15 })).rejects.toThrow(HttpError);
      await expect(updateConfig(db, id, alice, { playerCount: 1 })).rejects.toThrow(HttpError);
      await expect(updateConfig(db, id, alice, { playerCount: 13 })).rejects.toThrow(HttpError);
      await expect(updateConfig(db, id, alice, { turnMinutes: 4 })).rejects.toThrow(HttpError);
      await expect(updateConfig(db, id, alice, { turnCap: 4 })).rejects.toThrow(HttpError);
      await expect(updateConfig(db, id, alice, { turnCap: 51 })).rejects.toThrow(HttpError);
      await joinGame(db, id, bob); // fills the last seat — game activates
      await expect(updateConfig(db, id, alice, { turnCap: 15 })).rejects.toThrow(HttpError);
    });

    it('never unseats anyone: shrinking below an occupied index is refused', async () => {
      const id = await createTestGame(db, alice, { playerCount: 4, turnMinutes: 60 });
      await joinGame(db, id, bob); // seat 1
      await joinGame(db, id, carol); // seat 2
      await expect(updateConfig(db, id, alice, { playerCount: 2 })).rejects.toThrow(HttpError);
      const view = await updateConfig(db, id, alice, { playerCount: 3 });
      expect(view.seats.map((s) => s.taken)).toEqual([true, true, true]);
    });
  });
});
