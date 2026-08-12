import { beforeEach, describe, expect, it } from 'vitest';

import { emulatorDb, clearFirestore } from './testing.js';
import { games } from './store.js';
import { createGame, getView, HttpError, type AuthedUser } from './games.js';

const alice: AuthedUser = { uid: 'u-alice', name: 'Alice', email: 'alice@test.dev' };

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('tiers game creation', () => {
  const db = emulatorDb();
  beforeEach(clearFirestore);

  it('creates a tiers game with a custom cap and shows the lobby topic', async () => {
    const id = await createGame(db, alice, {
      playerCount: 4,
      turnMinutes: 60,
      contest: 'tiers',
      turnCap: 15,
    });
    const view = await getView(db, id, alice);
    expect(view.contest).toBe('tiers');
    expect(view.turnCap).toBe(15);
    expect(view.tiersTopic).not.toBeNull();
    expect(view.lobbyListSlots).toEqual([]);
    const rules = (await games(db).doc(id).get()).get('rules') as { turnCap: number };
    expect(rules.turnCap).toBe(15);
  });

  it('defaults to pact at 25 turns', async () => {
    const id = await createGame(db, alice, { playerCount: 4, turnMinutes: 60 });
    const view = await getView(db, id, alice);
    expect(view.contest).toBe('pact');
    expect(view.turnCap).toBe(25);
    expect(view.tiersTopic).toBeNull();
  });

  it('rejects bad caps and contests', async () => {
    await expect(
      createGame(db, alice, { playerCount: 4, turnMinutes: 60, turnCap: 9 }),
    ).rejects.toThrow(HttpError);
    await expect(
      createGame(db, alice, { playerCount: 4, turnMinutes: 60, turnCap: 51 }),
    ).rejects.toThrow(HttpError);
    await expect(
      createGame(db, alice, {
        playerCount: 4,
        turnMinutes: 60,
        contest: 'dice' as never,
      }),
    ).rejects.toThrow(HttpError);
  });
});
