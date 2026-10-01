import { beforeEach, describe, expect, it } from 'vitest';

import { LogMailer } from './mailer.js';
import { LogPusher } from './pusher.js';
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

  describe('push', () => {
    let pusher: LogPusher;
    const tokensOf = async (uid: string): Promise<string[] | undefined> =>
      (await usersCol(db).doc(uid).get()).data()?.pushTokens;

    beforeEach(() => {
      pusher = new LogPusher();
      deps = { ...deps, pusher };
    });

    it('pushes to every token of an opted-in recipient', async () => {
      await usersCol(db)
        .doc('u-alice')
        .set({ pushTokens: ['t1', 't2'] }, { merge: true });
      await notify(deps, 'turnResolved', [alice, bob], { ...MAIL, link: 'https://www.test/g/1' });
      expect(pusher.sent).toHaveLength(1);
      expect(pusher.sent[0].tokens).toEqual(['t1', 't2']);
      expect(pusher.sent[0].msg).toEqual({
        title: 'Turn 3 resolved',
        body: 'Something happened.',
        link: 'https://www.test/g/1',
      });
    });

    it('does not push to a recipient who turned that kind off', async () => {
      await usersCol(db)
        .doc('u-alice')
        .set({ pushTokens: ['t1'] }, { merge: true });
      await writePrefs(db, 'u-alice', { turnResolved: false });
      await notify(deps, 'turnResolved', [alice], MAIL);
      expect(pusher.sent).toEqual([]);
    });

    it('still emails a recipient whose doc has no pushTokens, and pushes nothing', async () => {
      await notify(deps, 'turnResolved', [alice], MAIL);
      expect(recipients()).toEqual(['alice@test.dev']);
      expect(pusher.sent).toEqual([]);
    });

    it('removes tokens the pusher reports dead', async () => {
      await usersCol(db)
        .doc('u-alice')
        .set({ pushTokens: ['live', 'gone'] }, { merge: true });
      pusher.dead.add('gone');
      await notify(deps, 'turnResolved', [alice], MAIL);
      expect(await tokensOf('u-alice')).toEqual(['live']);
    });

    it('behaves exactly as before with no pusher in deps', async () => {
      await usersCol(db)
        .doc('u-alice')
        .set({ pushTokens: ['t1'] }, { merge: true });
      const { pusher: _unused, ...bare } = deps;
      await notify(bare, 'turnResolved', [alice], MAIL);
      expect(recipients()).toEqual(['alice@test.dev']);
      expect(pusher.sent).toEqual([]);
    });

    it('strips a leading bracketed tag from the title', async () => {
      await usersCol(db)
        .doc('u-alice')
        .set({ pushTokens: ['t1'] }, { merge: true });
      await notify(deps, 'turnResolved', [alice], { ...MAIL, subject: '[WWW] Turn 3 resolved' });
      expect(pusher.sent[0].msg.title).toBe('Turn 3 resolved');
    });

    it('sends only the first paragraph, capped at 180 characters', async () => {
      await usersCol(db)
        .doc('u-alice')
        .set({ pushTokens: ['t1'] }, { merge: true });
      await notify(deps, 'turnResolved', [alice], {
        subject: 'S',
        text: `${'x'.repeat(400)}\n\nSecond paragraph.`,
      });
      const { body } = pusher.sent[0].msg;
      expect(body.length).toBeLessThanOrEqual(180);
      expect(body).not.toContain('Second');
    });

    it('falls back to the base URL when the call site gives no link', async () => {
      await usersCol(db)
        .doc('u-alice')
        .set({ pushTokens: ['t1'] }, { merge: true });
      await notify(deps, 'turnResolved', [alice], MAIL);
      expect(pusher.sent[0].msg.link).toBe('https://www.test');
    });
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
