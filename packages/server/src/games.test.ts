import { beforeEach, describe, expect, it } from 'vitest';

import { emulatorDb, clearFirestore } from './testing.js';
import { games } from './store.js';
import {
  createGame,
  getView,
  joinGame,
  listGames,
  startGame,
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

  it('lists my games', async () => {
    const id = await createGame(db, alice, { playerCount: 4, turnMinutes: 60 });
    expect((await listGames(db, alice)).map((g) => g.id)).toContain(id);
    expect(await listGames(db, bob)).toEqual([]);
  });
});
