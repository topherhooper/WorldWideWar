import { beforeEach, describe, expect, it } from 'vitest';

import type { TurnReport } from '@www/engine';

import { emulatorDb, clearFirestore, createTestGame, testDeps } from './testing.js';
import { games, reportsCol } from './store.js';
import { LogMailer } from './mailer.js';
import {
  getView,
  joinGame,
  startGame,
  submitLobbyList,
  submitOrders,
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
    const id = await createTestGame(db, alice, {
      presetId: 'tiers',
      playerCount: 4,
      turnMinutes: 60,
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

  it('defaults to pact at its preset cap', async () => {
    const id = await createTestGame(db, alice, { playerCount: 4, turnMinutes: 60 });
    const view = await getView(db, id, alice);
    expect(view.contest).toBe('pact');
    // Every preset targets a 5-10 turn game; 25 turns at a turn a day was a
    // month of real time. See docs/design/coop-survival.md.
    expect(view.turnCap).toBe(10);
    expect(view.tiersTopic).toBeNull();
  });

  // Bad turnCap and bad contest ids are no longer creation-time concerns: the
  // preset fixes the contest (see games.test.ts "rejects unknown presets"),
  // and the cap is lobby-editable via updateConfig (see games.test.ts
  // "updateConfig > rejects non-creators, non-lobby games, and out-of-bounds
  // values", which already exercises turnCap 9 and 51).
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('tiers lobby lists', () => {
  const db = emulatorDb();
  beforeEach(clearFirestore);

  const makeGame = () =>
    createTestGame(db, alice, { presetId: 'tiers', playerCount: 2, turnMinutes: 60 });

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
    const id = await createTestGame(db, alice, {
      presetId: 'tiers',
      playerCount: 3,
      turnMinutes: 60,
    });
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
    const pactId = await createTestGame(db, alice, { playerCount: 2, turnMinutes: 60 });
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
    const id = await createTestGame(db, alice, {
      presetId: 'tiers',
      playerCount: 2,
      turnMinutes: 60,
    });
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
    const id = await createTestGame(db, alice, {
      presetId: 'tiers',
      playerCount: 3,
      turnMinutes: 60,
    });
    await submitLobbyList(db, id, alice, LIST);
    await startGame(db, id, alice);
    const res = await submitOrders(testDeps(db, mailer), id, alice, {
      orders: { slot: 0, pledge: null, deploys: [], units: [] },
      locked: true,
    });
    expect(res.warnings.some((w) => w.includes('tier list'))).toBe(true);
  });
});

/**
 * Cooperative Survival: the landless keep contesting.
 *
 * The engine has scored an eliminated co-op player's reads into the coalition
 * pool since the mode was written, but the order route answered 403 to anyone
 * whose status was not 'active', so nothing ever reached it. These pin the
 * route open — and pin it shut in a competitive game, where the same player
 * genuinely is finished.
 */
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('co-op keeps the landless playing', () => {
  const db = emulatorDb();
  beforeEach(clearFirestore);

  /** Start a two-hander on the given preset and take slot 1's last province. */
  const eliminatedBob = async (presetId: 'survival' | 'tiers'): Promise<string> => {
    const id = await createTestGame(db, alice, { presetId, playerCount: 2, turnMinutes: 60 });
    await joinGame(db, id, bob);
    await submitLobbyList(db, id, alice, LIST);
    // The last list on a full table auto-starts the game; calling startGame
    // after that is a 409.
    const started = await submitLobbyList(db, id, bob, LIST2);
    expect(started.status).toBe('active');

    const snap = await games(db).doc(id).get();
    const state = JSON.parse(snap.get('stateJson') as string) as {
      status: string[];
      owner: (number | null)[];
      eliminatedTurn: (number | null)[];
    };
    // Take Bob's ground the way the storm would, rather than resolving turns
    // until it happens: what is under test is the gate, not the elimination.
    state.owner = state.owner.map((slot) => (slot === 1 ? null : slot));
    state.status[1] = 'eliminated';
    state.eliminatedTurn[1] = 1;
    await games(db)
      .doc(id)
      .update({ stateJson: JSON.stringify(state) });
    return id;
  };

  it('accepts a landless player’s tier orders, and drops the armies they no longer have', async () => {
    const mailer = new LogMailer();
    const id = await eliminatedBob('survival');

    const res = await submitOrders(testDeps(db, mailer), id, bob, {
      orders: {
        slot: 1,
        pledge: null,
        deploys: [{ to: 0, count: 1 }],
        units: [],
        tiers: { list: LIST2, guesses: [{ target: 0, order: [0, 1, 2, 3, 4, 5] }] },
      },
      locked: true,
    });

    // The read is banked; the deploy onto ground they do not own degrades to a
    // warning rather than a rejected turn.
    expect(res.warnings.some((w) => w.includes('not held'))).toBe(true);
    const view = await getView(db, id, bob);
    expect(view.myLocked).toBe(true);
    expect(view.myOrders?.tiers?.guesses).toHaveLength(1);
  });

  it('still shuts the door on an eliminated player in a competitive game', async () => {
    const mailer = new LogMailer();
    const id = await eliminatedBob('tiers');

    await expect(
      submitOrders(testDeps(db, mailer), id, bob, {
        orders: { slot: 1, pledge: null, deploys: [], units: [] },
        locked: false,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
