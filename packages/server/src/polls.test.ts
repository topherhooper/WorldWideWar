import { beforeEach, describe, expect, it } from 'vitest';

import type { CreatePollRequest, PollView } from './api-types.js';
import { HttpError, type AuthedUser } from './games.js';
import {
  answerPoll,
  cancelPoll,
  createPoll,
  getPollPreview,
  getPollView,
  joinPoll,
  listPolls,
  lockPoll,
  pastMembers,
} from './polls.js';
import { clearFirestore, emulatorDb } from './testing.js';

const alice: AuthedUser = { uid: 'u-alice', name: 'Alice', email: 'alice@test.dev' };
const bob: AuthedUser = { uid: 'u-bob', name: 'Bob', email: 'bob@test.dev' };
const carol: AuthedUser = { uid: 'u-carol', name: 'Carol', email: 'carol@test.dev' };

const HOUR = 60 * 60 * 1000;
const iso = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();
/** A valid candidate `days` from now, four hours long. */
const slot = (days: number) => ({
  startsAt: iso(days * 24 * HOUR),
  endsAt: iso(days * 24 * HOUR + 4 * HOUR),
});
const valid = (over: Partial<CreatePollRequest> = {}): CreatePollRequest => ({
  title: 'Board games',
  candidates: [slot(2), slot(3), slot(4)],
  ...over,
});

const statusOf = async (p: Promise<unknown>): Promise<number | null> => {
  try {
    await p;
    return null;
  } catch (err) {
    return err instanceof HttpError ? err.statusCode : -1;
  }
};

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('polls', () => {
  const db = emulatorDb();
  beforeEach(clearFirestore);

  const make = async (over: Partial<CreatePollRequest> = {}): Promise<string> =>
    (await createPoll(db, alice, valid(over))).id;
  const answerAll = (view: PollView, value: 'yes' | 'no') =>
    Object.fromEntries(view.candidates.map((c) => [c.id, value]));

  describe('createPoll validation', () => {
    it.each([
      ['an empty title', { title: '   ' }],
      ['an 81-character title', { title: 'x'.repeat(81) }],
      ['one candidate', { candidates: [slot(2)] }],
      ['seven candidates', { candidates: [1, 2, 3, 4, 5, 6, 7].map(slot) }],
      [
        'a malformed instant',
        { candidates: [slot(2), { startsAt: 'soon', endsAt: iso(3 * 24 * HOUR) }] },
      ],
      [
        'a candidate in the past',
        { candidates: [slot(2), { startsAt: iso(-HOUR), endsAt: iso(HOUR) }] },
      ],
      [
        'an end at the start',
        { candidates: [slot(2), { startsAt: iso(3 * 24 * HOUR), endsAt: iso(3 * 24 * HOUR) }] },
      ],
      [
        'a candidate over 24 hours',
        {
          candidates: [
            slot(2),
            { startsAt: iso(3 * 24 * HOUR), endsAt: iso(3 * 24 * HOUR + 25 * HOUR) },
          ],
        },
      ],
      ['duplicate candidates', { candidates: [slot(2), slot(2)] }],
      ['a deadline in the past', { deadlineAt: iso(-HOUR) }],
      ['a deadline after the last candidate', { deadlineAt: iso(10 * 24 * HOUR) }],
      ['a stranger in addUids', { addUids: ['u-nobody'] }],
    ])('rejects %s', async (_name, over) => {
      expect(await statusOf(createPoll(db, alice, valid(over as Partial<CreatePollRequest>)))).toBe(
        400,
      );
    });

    it('sorts candidates by start and gives each an id', async () => {
      const id = await make({ candidates: [slot(4), slot(2), slot(3)] });
      const view = await getPollView(db, id, alice);
      const starts = view.candidates.map((c) => c.startsAt);
      expect([...starts].sort()).toEqual(starts);
      expect(new Set(view.candidates.map((c) => c.id)).size).toBe(3);
    });

    it('makes the organizer the first member, with no answer yet', async () => {
      const view = await getPollView(db, await make(), alice);
      expect(view.members).toHaveLength(1);
      expect(view.members[0]).toMatchObject({ uid: alice.uid, answeredAt: null, answers: {} });
      expect(view.status).toBe('open');
    });

    it('accepts a candidate ending exactly 24 hours later', async () => {
      const startsAt = iso(2 * 24 * HOUR);
      const endsAt = new Date(new Date(startsAt).getTime() + 24 * HOUR).toISOString();
      const id = await make({ candidates: [slot(3), { startsAt, endsAt }] });
      expect(id).toBeTruthy();
    });
  });

  describe('joining and viewing', () => {
    it('is idempotent', async () => {
      const id = await make();
      await joinPoll(db, id, bob);
      const again = await joinPoll(db, id, bob);
      expect(again.members.map((m) => m.uid)).toEqual([alice.uid, bob.uid]);
    });

    it('turns away the 21st member with 409, but lets an existing one back in', async () => {
      const id = await make();
      for (let i = 0; i < 19; i++) {
        await joinPoll(db, id, { uid: `u-${i}`, name: `P${i}`, email: null });
      }
      expect(await statusOf(joinPoll(db, id, carol))).toBe(409);
      expect(await statusOf(joinPoll(db, id, { uid: 'u-3', name: 'P3', email: null }))).toBeNull();
    });

    it('is 404 for a missing poll and 409 for a cancelled one', async () => {
      expect(await statusOf(joinPoll(db, 'nope', bob))).toBe(404);
      const id = await make();
      await cancelPoll(db, id, alice);
      expect(await statusOf(joinPoll(db, id, bob))).toBe(409);
    });

    it('still lets someone join a locked poll, to see the result', async () => {
      const id = await make();
      const view = await getPollView(db, id, alice);
      await lockPoll(db, id, alice, { candidateId: view.candidates[0].id });
      expect((await joinPoll(db, id, bob)).status).toBe('locked');
    });

    it('is 403 to view a poll you have not joined', async () => {
      expect(await statusOf(getPollView(db, await make(), bob))).toBe(403);
    });

    it('lists the organizer first, then members by when they joined', async () => {
      const id = await make();
      await joinPoll(db, id, bob);
      await joinPoll(db, id, carol);
      const view = await getPollView(db, id, carol);
      expect(view.members.map((m) => m.uid)).toEqual([alice.uid, bob.uid, carol.uid]);
      expect(view.me).toBe(carol.uid);
    });
  });

  describe('answering', () => {
    it('stores one answer per candidate and shows who is still a holdout', async () => {
      const id = await make();
      const view = await joinPoll(db, id, bob);
      const answers = { ...answerAll(view, 'yes'), [view.candidates[1].id]: 'no' as const };
      const after = await answerPoll(db, id, bob, { answers });
      const me = after.members.find((m) => m.uid === bob.uid);
      expect(me?.answers).toEqual(answers);
      expect(me?.answeredAt).not.toBeNull();
      expect(after.members.find((m) => m.uid === alice.uid)?.answeredAt).toBeNull();
    });

    it.each([
      ['a missing candidate', (v: PollView) => ({ [v.candidates[0].id]: 'yes' })],
      [
        'an extra candidate',
        (v: PollView) => ({
          ...Object.fromEntries(v.candidates.map((c) => [c.id, 'yes'])),
          zzz: 'yes',
        }),
      ],
      [
        'an invalid value',
        (v: PollView) => Object.fromEntries(v.candidates.map((c) => [c.id, 'maybe'])),
      ],
      ['no answers at all', () => ({})],
    ])('rejects %s', async (_name, build) => {
      const id = await make();
      const view = await getPollView(db, id, alice);
      expect(await statusOf(answerPoll(db, id, alice, { answers: build(view) as never }))).toBe(
        400,
      );
    });

    it('lets a member change their answer while open', async () => {
      const id = await make();
      const view = await getPollView(db, id, alice);
      await answerPoll(db, id, alice, { answers: answerAll(view, 'yes') });
      const after = await answerPoll(db, id, alice, { answers: answerAll(view, 'no') });
      expect(Object.values(after.members[0].answers)).toEqual(['no', 'no', 'no']);
    });

    it('is 403 for a non-member and 409 once the poll is not open', async () => {
      const id = await make();
      const view = await getPollView(db, id, alice);
      expect(await statusOf(answerPoll(db, id, bob, { answers: answerAll(view, 'yes') }))).toBe(
        403,
      );
      await lockPoll(db, id, alice, { candidateId: view.candidates[0].id });
      expect(await statusOf(answerPoll(db, id, alice, { answers: answerAll(view, 'yes') }))).toBe(
        409,
      );
    });
  });

  describe('locking and cancelling', () => {
    it('lets only the organizer lock, and only a known time', async () => {
      const id = await make();
      await joinPoll(db, id, bob);
      const view = await getPollView(db, id, alice);
      const first = view.candidates[0].id;
      expect(await statusOf(lockPoll(db, id, bob, { candidateId: first }))).toBe(403);
      expect(await statusOf(lockPoll(db, id, alice, { candidateId: 'nope' }))).toBe(400);
      const locked = await lockPoll(db, id, alice, { candidateId: first });
      expect(locked).toMatchObject({ status: 'locked', lockedCandidateId: first });
      expect(await statusOf(lockPoll(db, id, alice, { candidateId: first }))).toBe(409);
    });

    it('lets only the organizer cancel, and keeps the poll readable as cancelled', async () => {
      const id = await make();
      await joinPoll(db, id, bob);
      expect(await statusOf(cancelPoll(db, id, bob))).toBe(403);
      await cancelPoll(db, id, alice);
      expect((await getPollView(db, id, alice)).status).toBe('cancelled');
    });
  });

  describe('preview', () => {
    it('shows the title and organizer and never a member name or answer', async () => {
      const id = await make();
      const view = await joinPoll(db, id, bob);
      await answerPoll(db, id, bob, { answers: answerAll(view, 'yes') });
      const preview = await getPollPreview(db, id);
      expect(preview).toEqual({
        title: 'Board games',
        organizerName: 'Alice',
        memberCount: 2,
        status: 'open',
      });
      expect(JSON.stringify(preview)).not.toContain('Bob');
    });

    it('is 404 for a cancelled poll and for a missing one', async () => {
      const id = await make();
      await cancelPoll(db, id, alice);
      expect(await statusOf(getPollPreview(db, id))).toBe(404);
      expect(await statusOf(getPollPreview(db, 'nope'))).toBe(404);
    });
  });

  describe('lists', () => {
    it('puts open polls first, then newest, and counts answers', async () => {
      const older = await make({ title: 'Older' });
      const locked = await make({ title: 'Locked' });
      const newer = await make({ title: 'Newer' });
      const lockedView = await getPollView(db, locked, alice);
      await lockPoll(db, locked, alice, { candidateId: lockedView.candidates[1].id });
      await joinPoll(db, newer, bob);
      const view = await getPollView(db, newer, alice);
      await answerPoll(db, newer, alice, { answers: answerAll(view, 'yes') });

      const rows = await listPolls(db, alice);
      expect(rows.map((r) => r.title)).toEqual(['Newer', 'Older', 'Locked']);
      expect(rows.find((r) => r.id === newer)).toMatchObject({
        answeredCount: 1,
        memberCount: 2,
        iAnswered: true,
        isOrganizer: true,
      });
      expect(rows.find((r) => r.id === locked)?.lockedStartsAt).toBe(
        lockedView.candidates[1].startsAt,
      );
      expect(rows.find((r) => r.id === older)?.iAnswered).toBe(false);
    });

    it("only lists the caller's polls", async () => {
      await make();
      expect(await listPolls(db, bob)).toEqual([]);
    });
  });

  describe('people from past polls', () => {
    it('lists everyone who shared a poll with the caller, once, by name, minus the caller', async () => {
      const one = await make();
      const two = await make();
      await joinPoll(db, one, carol);
      await joinPoll(db, one, bob);
      await joinPoll(db, two, bob);
      expect(await pastMembers(db, alice)).toEqual([
        { uid: bob.uid, name: 'Bob' },
        { uid: carol.uid, name: 'Carol' },
      ]);
    });

    it('adds a past member to a new poll as a holdout, and rejects strangers', async () => {
      const first = await make();
      await joinPoll(db, first, bob);
      const id = await make({ addUids: [bob.uid] });
      const view = await getPollView(db, id, bob);
      expect(view.members.map((m) => m.uid)).toEqual([alice.uid, bob.uid]);
      expect(view.members[1].answeredAt).toBeNull();
      expect(await statusOf(createPoll(db, alice, valid({ addUids: [carol.uid] })))).toBe(400);
    });
  });

  describe('grid polls', () => {
    /** Whole hours from tomorrow on, so every offered hour is in the future. */
    const hourStart = (day: number, hour: number): string => {
      const d = new Date(Date.now() + day * 24 * HOUR);
      d.setUTCHours(hour, 0, 0, 0);
      return d.toISOString();
    };
    const window = {
      firstDay: '2026-10-03',
      days: 14,
      fromHour: 18,
      toHour: 23,
      timeZone: 'Europe/London',
    };
    const grid = (over: Partial<CreatePollRequest> = {}): CreatePollRequest => ({
      title: 'Board games',
      window,
      offered: [hourStart(2, 20), hourStart(1, 19), hourStart(1, 18)],
      ...over,
    });

    it('stores the window and the offered hours, sorted, with no candidates', async () => {
      const { id } = await createPoll(db, alice, grid());
      const view = await getPollView(db, id, alice);
      expect(view.window).toEqual(window);
      expect(view.offered).toEqual([hourStart(1, 18), hourStart(1, 19), hourStart(2, 20)]);
      expect(view.candidates).toEqual([]);
    });

    it('shows older candidate polls with no window and nothing offered', async () => {
      const view = await getPollView(db, await make(), alice);
      expect(view.window).toBeNull();
      expect(view.offered).toEqual([]);
    });

    it.each([
      ['no hours offered', { offered: [] }],
      ['an hour in the past', { offered: [iso(-2 * HOUR)] }],
      ['an hour off the quarter-hour grid', { offered: [iso(2 * 24 * HOUR + 7 * 60 * 1000)] }],
      ['the same hour twice', { offered: [hourStart(1, 18), hourStart(1, 18)] }],
      ['a malformed hour', { offered: ['soon'] }],
      ['no window', { window: undefined }],
      ['a window ending before it starts', { window: { ...window, fromHour: 20, toHour: 19 } }],
      ['a 32-day window', { window: { ...window, days: 32 } }],
      ['a malformed first day', { window: { ...window, firstDay: '3 Oct' } }],
      [
        'more hours than the window holds',
        { window: { ...window, days: 1, fromHour: 18, toHour: 19 } },
      ],
      ['candidates as well', { candidates: [slot(2), slot(3)] }],
      ['a deadline after the last offered hour', { deadlineAt: hourStart(3, 0) }],
    ])('rejects %s', async (_name, over) => {
      expect(await statusOf(createPoll(db, alice, grid(over as Partial<CreatePollRequest>)))).toBe(
        400,
      );
    });

    it('keeps the public preview to title, organizer, count and status', async () => {
      const { id } = await createPoll(db, alice, grid());
      expect(await getPollPreview(db, id)).toEqual({
        title: 'Board games',
        organizerName: 'Alice',
        memberCount: 1,
        status: 'open',
      });
    });
  });
});
