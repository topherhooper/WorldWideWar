import { beforeEach, describe, expect, it } from 'vitest';

import { emulatorDb, clearFirestore } from './testing.js';
import { LogMailer } from './mailer.js';
import { createGame, getView, startGame, type AuthedUser } from './games.js';
import { resolveGameTurn } from './resolve.js';

const alice: AuthedUser = { uid: 'u-alice', name: 'Alice', email: 'alice@test.dev' };

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('turn resolution', () => {
  const db = emulatorDb();
  let mailer: LogMailer;
  beforeEach(async () => {
    await clearFirestore();
    mailer = new LogMailer();
  });

  async function activeGame(playerCount: number): Promise<string> {
    const id = await createGame(db, alice, { playerCount, turnMinutes: 60 });
    await startGame(db, id, alice);
    return id;
  }

  it('resolves a turn and advances state', async () => {
    const id = await activeGame(4);
    const out = await resolveGameTurn(db, mailer, 'http://x', id, 1);
    expect(out.resolved).toBe(true);
    expect(out.report?.turn).toBe(1);
    const view = await getView(db, id, alice);
    expect(view.turn).toBe(2);
    expect(view.latestReport?.turn).toBe(1);
    expect(view.deadlineAt).not.toBeNull();
    expect(mailer.sent.some((m) => m.subject.includes('Turn 1 resolved'))).toBe(true);
    expect(mailer.sent.every((m) => m.to === 'alice@test.dev')).toBe(true);
  });

  it('is idempotent under the resolution race', async () => {
    const id = await activeGame(4);
    const results = await Promise.all([
      resolveGameTurn(db, mailer, 'http://x', id, 1),
      resolveGameTurn(db, mailer, 'http://x', id, 1),
    ]);
    expect(results.filter((r) => r.resolved)).toHaveLength(1);
    expect((await getView(db, id, alice)).turn).toBe(2);
  });

  it('plays a bot game to completion', async () => {
    const id = await activeGame(2);
    for (let turn = 1; turn <= 40; turn++) {
      const out = await resolveGameTurn(db, mailer, 'http://x', id, turn);
      if (!out.resolved || out.finished) break;
    }
    const view = await getView(db, id, alice);
    expect(view.result).not.toBeNull();
    expect(view.status).toBe('finished');
    expect(view.deadlineAt).toBeNull();
    expect(mailer.sent.some((m) => m.subject.includes('Game over'))).toBe(true);
  }, 120_000);
});
