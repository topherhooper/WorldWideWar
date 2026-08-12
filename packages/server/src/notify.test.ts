import { beforeEach, describe, expect, it } from 'vitest';

import { LogMailer } from './mailer.js';
import { notify, readPrefs, writePrefs, type NotifyDeps } from './notify.js';
import { usersCol } from './store.js';
import { clearFirestore, emulatorDb } from './testing.js';
import { unsubSigner } from './unsub.js';

const alice = { uid: 'u-alice', email: 'alice@test.dev' };
const bob = { uid: 'u-bob', email: 'bob@test.dev' };
const bot = { uid: null, email: null };

const MAIL = { subject: 'Turn 3 resolved', text: 'Something happened.' };

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('notify', () => {
  const db = emulatorDb();
  const signer = unsubSigner('test-secret');
  let mailer: LogMailer;
  let deps: NotifyDeps;

  beforeEach(async () => {
    await clearFirestore();
    mailer = new LogMailer();
    deps = { db, mailer, signer, baseUrl: 'https://www.test' };
  });

  const recipients = (): string[] => mailer.sent.map((m) => m.to);

  it('mails players who have never touched their preferences', async () => {
    await notify(deps, 'turnResolved', [alice, bob], MAIL);
    expect(recipients()).toEqual(['alice@test.dev', 'bob@test.dev']);
  });

  it('skips a player who turned that notification off', async () => {
    await writePrefs(db, 'u-alice', { turnResolved: false });
    await notify(deps, 'turnResolved', [alice, bob], MAIL);
    expect(recipients()).toEqual(['bob@test.dev']);
  });

  it('still mails that player about other kinds', async () => {
    await writePrefs(db, 'u-alice', { turnResolved: false });
    await notify(deps, 'gameOver', [alice], MAIL);
    expect(recipients()).toEqual(['alice@test.dev']);
  });

  it('skips seats with no email, such as bots', async () => {
    await notify(deps, 'reminder', [bot, alice], MAIL);
    expect(recipients()).toEqual(['alice@test.dev']);
  });

  it('sends nothing when no recipient has an email', async () => {
    await notify(deps, 'reminder', [bot], MAIL);
    expect(mailer.sent).toEqual([]);
  });

  it('appends an unsubscribe link the signer accepts', async () => {
    await notify(deps, 'turnResolved', [alice], MAIL);
    const url = /https:\/\/www\.test\/unsubscribe\?u=([^&]+)&s=(\S+)/.exec(mailer.sent[0].text);
    expect(url).not.toBeNull();
    const [, uid, sig] = url as RegExpExecArray;
    expect(uid).toBe('u-alice');
    expect(signer.verify('u-alice', decodeURIComponent(sig))).toBe(true);
  });

  it('keeps the original body above the footer', async () => {
    await notify(deps, 'turnResolved', [alice], MAIL);
    expect(mailer.sent[0].text.startsWith('Something happened.')).toBe(true);
    expect(mailer.sent[0].subject).toBe('Turn 3 resolved');
  });

  it('sets the one-click list-unsubscribe headers', async () => {
    await notify(deps, 'turnResolved', [alice], MAIL);
    const headers = mailer.sent[0].headers ?? {};
    expect(headers['List-Unsubscribe']).toMatch(
      /^<https:\/\/www\.test\/unsubscribe\?u=u-alice&s=\S+>$/,
    );
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('prefs', () => {
  const db = emulatorDb();
  beforeEach(clearFirestore);

  it('reads all-on for a user with no stored preferences', async () => {
    expect(await readPrefs(db, 'u-nobody')).toEqual({
      turnResolved: true,
      gameOver: true,
      reminder: true,
    });
  });

  it('round-trips a partial update, leaving other kinds on', async () => {
    await writePrefs(db, 'u-alice', { reminder: false });
    expect(await readPrefs(db, 'u-alice')).toEqual({
      turnResolved: true,
      gameOver: true,
      reminder: false,
    });
  });

  it('does not lose one of two concurrent updates', async () => {
    // The settings page and an unsubscribe click can land together; a
    // read-then-write pair lets the later write clobber the earlier one.
    await Promise.all([
      writePrefs(db, 'u-alice', { reminder: false }),
      writePrefs(db, 'u-alice', { gameOver: false }),
    ]);
    expect(await readPrefs(db, 'u-alice')).toEqual({
      turnResolved: true,
      gameOver: false,
      reminder: false,
    });
  });

  it('preserves fields the user doc already had', async () => {
    await usersCol(db)
      .doc('u-alice')
      .set({ name: 'Alice', gameIds: ['g1'] });
    await writePrefs(db, 'u-alice', { reminder: false });
    const doc = (await usersCol(db).doc('u-alice').get()).data();
    expect(doc?.name).toBe('Alice');
    expect(doc?.gameIds).toEqual(['g1']);
  });
});
