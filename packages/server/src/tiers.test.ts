import { beforeEach, describe, expect, it } from 'vitest';

import type { TurnReport } from '@www/engine';

import { emulatorDb, clearFirestore, testDeps } from './testing.js';
import { games, reportsCol } from './store.js';
import { LogMailer } from './mailer.js';
import {
  createGame,
  getView,
  joinGame,
  startGame,
  submitLobbyList,
  submitOrders,
  HttpError,
  type AuthedUser,
} from './games.js';

const alice: AuthedUser = { uid: 'u-alice', name: 'Alice', email: 'alice@test.dev' };
const bob: AuthedUser = { uid: 'u-bob', name: 'Bob', email: 'bob@test.dev' };

const LIST = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
const LIST2 = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];

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

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('tiers lobby lists', () => {
  const db = emulatorDb();
  beforeEach(clearFirestore);

  const makeGame = () =>
    createGame(db, alice, { playerCount: 2, turnMinutes: 60, contest: 'tiers' });

  it('a full table does not start until every human list is in', async () => {
    const id = await makeGame();
    let view = await joinGame(db, id, bob);
    expect(view.status).toBe('lobby'); // seats full, lists missing
    view = await submitLobbyList(db, id, alice, LIST);
    expect(view.status).toBe('lobby');
    expect(view.lobbyListSlots).toEqual([0]);
    view = await submitLobbyList(db, id, bob, LIST2);
    expect(view.status).toBe('active'); // last list activates
    expect(view.state).not.toBeNull();
    // Both lobby lists are installed and redacted for the viewer (bob sees his own order).
    expect(view.state?.tiersLists.filter((l) => l !== null)).toHaveLength(2);
    expect(view.state?.tiersLists[1]?.items).toEqual(LIST2);
  });

  it('start-with-bots fills bot lists but insists on human lists', async () => {
    const id = await createGame(db, alice, { playerCount: 3, turnMinutes: 60, contest: 'tiers' });
    await expect(startGame(db, id, alice)).rejects.toMatchObject({ statusCode: 409 });
    await submitLobbyList(db, id, alice, LIST);
    const view = await startGame(db, id, alice);
    expect(view.status).toBe('active');
    expect(view.state?.tiersLists.every((l) => l !== null)).toBe(true);
  });

  it('rejects malformed lists, non-tiers games and started games', async () => {
    const id = await makeGame();
    await expect(
      submitLobbyList(db, id, alice, ['only', 'five', 'items', 'in', 'list']),
    ).rejects.toMatchObject({ statusCode: 400 });
    const pactId = await createGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await expect(submitLobbyList(db, pactId, alice, LIST)).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(submitLobbyList(db, id, bob, LIST)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('tiers turn resolution', () => {
  const db = emulatorDb();
  const mailer = new LogMailer();
  beforeEach(clearFirestore);

  it('resolves a human-vs-bot tiers turn with scored guesses in the report', async () => {
    const id = await createGame(db, alice, { playerCount: 2, turnMinutes: 60, contest: 'tiers' });
    await submitLobbyList(db, id, alice, LIST);
    const view = await startGame(db, id, alice);
    expect(view.status).toBe('active');
    // The bot's lobby list is guessable: reorder its public items as shown.
    const botList = view.state?.tiersLists[1];
    expect(botList).not.toBeNull();

    const res = await submitOrders(testDeps(db, mailer), id, alice, {
      orders: {
        slot: 0,
        pledge: null,
        deploys: [],
        units: [],
        tiers: { list: LIST2, guesses: [{ target: 1, order: [0, 1, 2, 3, 4, 5] }] },
      },
      locked: true,
    });
    expect(res.resolved).toBe(true);
    const report = JSON.parse(
      (await reportsCol(db, id).doc('1').get()).get('reportJson') as string,
    ) as TurnReport;
    expect(report.tiers.length).toBeGreaterThan(0);
    expect(report.tiers[0].guesses[0]?.target).toBe(1);
    expect(report.revealedTopic).not.toBeNull();
    // The human's new list is installed for turn 2.
    expect(res.view.state?.tiersLists[0]?.items).toEqual(LIST2);
  });

  it('warns on a locked submission with a broken tier list', async () => {
    const id = await createGame(db, alice, { playerCount: 3, turnMinutes: 60, contest: 'tiers' });
    await submitLobbyList(db, id, alice, LIST);
    await startGame(db, id, alice);
    const res = await submitOrders(testDeps(db, mailer), id, alice, {
      orders: { slot: 0, pledge: null, deploys: [], units: [] },
      locked: true,
    });
    expect(res.warnings.some((w) => w.includes('tier list'))).toBe(true);
  });
});
