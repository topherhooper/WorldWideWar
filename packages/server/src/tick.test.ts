import { beforeEach, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

import { emulatorDb, clearFirestore, createTestGame, testDeps } from './testing.js';
import { games } from './store.js';
import { LogMailer } from './mailer.js';
import { getView, joinGame, submitOrders, type AuthedUser } from './games.js';
import { runTick } from './tick.js';
import { writePrefs } from './notify.js';

const alice: AuthedUser = { uid: 'u-alice', name: 'Alice', email: 'alice@test.dev' };
const bob: AuthedUser = { uid: 'u-bob', name: 'Bob', email: 'bob@test.dev' };

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('tick', () => {
  const db = emulatorDb();
  let mailer: LogMailer;
  beforeEach(async () => {
    await clearFirestore();
    mailer = new LogMailer();
  });

  async function twoPlayerGame(): Promise<string> {
    const id = await createTestGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await joinGame(db, id, bob);
    return id;
  }

  it('resolves games past their deadline', async () => {
    const id = await twoPlayerGame();
    await games(db)
      .doc(id)
      .update({ deadlineAt: Timestamp.fromMillis(Date.now() - 60_000) });
    const result = await runTick(testDeps(db, mailer), new Date());
    expect(result.resolvedGames).toEqual([id]);
    expect(result.errors).toEqual([]);
    expect((await getView(db, id, alice)).turn).toBe(2);
  });

  it('reminds only unlocked humans, and only once per turn', async () => {
    const id = await twoPlayerGame();
    await games(db)
      .doc(id)
      .update({ deadlineAt: Timestamp.fromMillis(Date.now() + 10 * 60_000) });
    await submitOrders(testDeps(db, mailer), id, alice, {
      orders: { slot: 0, pledge: null, deploys: [], units: [] },
      locked: true,
    });
    const first = await runTick(testDeps(db, mailer), new Date());
    expect(first.remindedGames).toEqual([id]);
    const reminders = mailer.sent.filter((m) => m.subject.includes('Orders due'));
    expect(reminders).toHaveLength(1);
    expect(reminders[0].to).toBe('bob@test.dev');

    const second = await runTick(testDeps(db, mailer), new Date());
    expect(second.remindedGames).toEqual([]);
    expect(mailer.sent.filter((m) => m.subject.includes('Orders due'))).toHaveLength(1);
  });

  it('does not remind a player who turned reminders off', async () => {
    const id = await twoPlayerGame();
    await writePrefs(db, bob.uid, { reminder: false });
    await games(db)
      .doc(id)
      .update({ deadlineAt: Timestamp.fromMillis(Date.now() + 10 * 60_000) });
    await submitOrders(testDeps(db, mailer), id, alice, {
      orders: { slot: 0, pledge: null, deploys: [], units: [] },
      locked: true,
    });
    await runTick(testDeps(db, mailer), new Date());
    expect(mailer.sent.filter((m) => m.subject.includes('Orders due'))).toEqual([]);
  });

  it('still mails a reminders-off player when the turn resolves', async () => {
    const id = await twoPlayerGame();
    await writePrefs(db, bob.uid, { reminder: false });
    await games(db)
      .doc(id)
      .update({ deadlineAt: Timestamp.fromMillis(Date.now() - 60_000) });
    await runTick(testDeps(db, mailer), new Date());
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['alice@test.dev', 'bob@test.dev']);
  });

  it('does not mail a turn report to a player who turned those off', async () => {
    const id = await twoPlayerGame();
    await writePrefs(db, bob.uid, { turnResolved: false });
    await games(db)
      .doc(id)
      .update({ deadlineAt: Timestamp.fromMillis(Date.now() - 60_000) });
    await runTick(testDeps(db, mailer), new Date());
    expect(mailer.sent.map((m) => m.to)).toEqual(['alice@test.dev']);
  });

  it('leaves games far from their deadline alone', async () => {
    const id = await twoPlayerGame();
    const result = await runTick(testDeps(db, mailer), new Date());
    expect(result.resolvedGames).toEqual([]);
    expect(result.remindedGames).toEqual([]);
    expect((await getView(db, id, alice)).turn).toBe(1);
  });
});
