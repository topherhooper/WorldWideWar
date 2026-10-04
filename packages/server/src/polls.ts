import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import type {
  AnswerPollRequest,
  CreatePollRequest,
  LockPollRequest,
  PastMemberView,
  PollMemberView,
  PollPreview,
  PollSummaryView,
  PollView,
  PollWindow,
} from './api-types.js';
import { HttpError, type AuthedUser } from './games.js';
import { polls, usersCol, type PollDoc, type PollMember } from './store.js';

export const MAX_MEMBERS = 20;
const MAX_TITLE = 80;
const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 6;
const MAX_SPAN_MS = 24 * 60 * 60 * 1000;
const MAX_LISTED = 50;
const MAX_DAYS = 31;
const HOUR_MS = 60 * 60 * 1000;
// Hour starts in zones offset by a quarter hour (Nepal, Chatham) still land on this grid.
const QUARTER_MS = 15 * 60 * 1000;

/** The organizer's grid window, or a 400. */
function parseWindow(raw: unknown): PollWindow {
  const w = (raw ?? {}) as Partial<PollWindow>;
  const int = (v: unknown, lo: number, hi: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  if (
    typeof w.firstDay !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(w.firstDay) ||
    !int(w.days, 1, MAX_DAYS) ||
    !int(w.fromHour, 0, 23) ||
    !int(w.toHour, 1, 24) ||
    (w.toHour as number) <= (w.fromHour as number) ||
    typeof w.timeZone !== 'string' ||
    w.timeZone.length < 1 ||
    w.timeZone.length > 64
  ) {
    throw new HttpError(400, 'bad grid window');
  }
  return {
    firstDay: w.firstDay,
    days: w.days as number,
    fromHour: w.fromHour as number,
    toHour: w.toHour as number,
    timeZone: w.timeZone,
  };
}

/** Offered hour starts, sorted and unique, all in the future, or a 400. */
function parseOffered(raw: unknown, window: PollWindow, now: number): Date[] {
  const list = Array.isArray(raw) ? raw : [];
  const max = window.days * (window.toHour - window.fromHour);
  if (list.length < 1) throw new HttpError(400, 'leave at least one hour free on the grid');
  if (list.length > max) throw new HttpError(400, 'more hours offered than the grid holds');
  const starts = list.map((v) => parseInstant(v, 'offered hour'));
  for (const d of starts) {
    if (d.getTime() % QUARTER_MS !== 0) throw new HttpError(400, 'an offered hour is off the grid');
    if (d.getTime() <= now) throw new HttpError(400, 'an offered hour is in the past');
  }
  const ms = [...new Set(starts.map((d) => d.getTime()))].sort((a, b) => a - b);
  if (ms.length !== starts.length) throw new HttpError(400, 'duplicate offered hours');
  // The window spans at most 31 days; anything past it is not on the organizer's grid.
  if (ms[ms.length - 1] - ms[0] > (MAX_DAYS + 1) * 24 * HOUR_MS) {
    throw new HttpError(400, 'offered hours span more than the grid');
  }
  return ms.map((t) => new Date(t));
}

/** A strict ISO instant, or a 400. `what` names the field in the error. */
function parseInstant(value: unknown, what: string): Date {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (date === null || Number.isNaN(date.getTime())) {
    throw new HttpError(400, `bad ${what}`);
  }
  return date;
}

async function loadPoll(db: Firestore, pollId: string): Promise<PollDoc> {
  const snap = await polls(db).doc(pollId).get();
  if (!snap.exists) throw new HttpError(404, 'poll not found');
  return snap.data() as PollDoc;
}

/** Everyone who shares any poll with the caller, minus the caller, by uid. */
async function sharedMembers(db: Firestore, user: AuthedUser): Promise<Map<string, PollMember>> {
  const snap = await polls(db).where('memberUids', 'array-contains', user.uid).get();
  const found = new Map<string, PollMember>();
  for (const doc of snap.docs) {
    const poll = doc.data() as PollDoc;
    for (const [uid, member] of Object.entries(poll.members ?? {})) {
      if (uid !== user.uid && !found.has(uid)) found.set(uid, member);
    }
  }
  return found;
}

export async function pastMembers(db: Firestore, user: AuthedUser): Promise<PastMemberView[]> {
  const found = await sharedMembers(db, user);
  return [...found.entries()]
    .map(([uid, m]) => ({ uid, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createPoll(
  db: Firestore,
  user: AuthedUser,
  req: CreatePollRequest,
): Promise<{ id: string }> {
  const title = typeof req?.title === 'string' ? req.title.trim() : '';
  if (title.length < 1 || title.length > MAX_TITLE) {
    throw new HttpError(400, `title must be 1-${MAX_TITLE} characters`);
  }

  const now = Date.now();
  // A grid poll offers hours; a candidate poll (the shape before the grid) lists spans.
  const gridPoll = req.window !== undefined || req.offered !== undefined;
  if (gridPoll && Array.isArray(req.candidates) && req.candidates.length > 0) {
    throw new HttpError(400, 'send candidate times or a grid, not both');
  }
  const window = gridPoll ? parseWindow(req.window) : null;
  const offered = window ? parseOffered(req.offered, window, now) : [];

  const raw = gridPoll ? [] : Array.isArray(req.candidates) ? req.candidates : [];
  if (!gridPoll && (raw.length < MIN_CANDIDATES || raw.length > MAX_CANDIDATES)) {
    throw new HttpError(400, `a poll needs ${MIN_CANDIDATES}-${MAX_CANDIDATES} candidate times`);
  }
  const spans = raw.map((c) => {
    const startsAt = parseInstant(c?.startsAt, 'start time');
    const endsAt = parseInstant(c?.endsAt, 'end time');
    if (startsAt.getTime() <= now) throw new HttpError(400, 'a candidate time is in the past');
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new HttpError(400, 'a candidate must end after it starts');
    }
    if (endsAt.getTime() - startsAt.getTime() > MAX_SPAN_MS) {
      throw new HttpError(400, 'a candidate can be at most 24 hours long');
    }
    return { startsAt, endsAt };
  });
  const keys = spans.map((s) => `${s.startsAt.getTime()}-${s.endsAt.getTime()}`);
  if (new Set(keys).size !== keys.length) throw new HttpError(400, 'duplicate candidate times');
  spans.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  let deadlineAt: Timestamp | null = null;
  if (req.deadlineAt !== undefined && req.deadlineAt !== null) {
    const deadline = parseInstant(req.deadlineAt, 'deadline');
    if (deadline.getTime() <= now) throw new HttpError(400, 'the deadline is in the past');
    const last = gridPoll ? offered[offered.length - 1] : spans[spans.length - 1].startsAt;
    if (deadline.getTime() >= last.getTime()) {
      throw new HttpError(400, 'the deadline must come before the last candidate time');
    }
    deadlineAt = Timestamp.fromDate(deadline);
  }

  const addUids = [...new Set(Array.isArray(req.addUids) ? req.addUids : [])].filter(
    (uid) => uid !== user.uid,
  );
  if (addUids.length > MAX_MEMBERS - 1) throw new HttpError(400, 'too many people added');
  const joinedAt = Timestamp.now();
  const members: Record<string, PollMember> = {
    [user.uid]: { name: user.name, email: user.email, joinedAt, answeredAt: null, answers: {} },
  };
  if (addUids.length > 0) {
    const past = await sharedMembers(db, user);
    for (const uid of addUids) {
      if (typeof uid !== 'string' || !past.has(uid)) {
        throw new HttpError(400, 'you can only add people from your past polls');
      }
    }
    const snaps = await db.getAll(...addUids.map((uid) => usersCol(db).doc(uid)));
    snaps.forEach((snap, i) => {
      const data = snap.data() as { name?: string; email?: string | null } | undefined;
      const fallback = past.get(addUids[i]) as PollMember;
      members[addUids[i]] = {
        name: data?.name ?? fallback.name,
        email: data?.email ?? fallback.email ?? null,
        joinedAt,
        answeredAt: null,
        answers: {},
      };
    });
  }

  const doc: PollDoc = {
    title,
    createdBy: user.uid,
    organizerName: user.name,
    createdAt: joinedAt,
    status: 'open',
    candidates: spans.map((s) => ({
      id: randomUUID().slice(0, 8),
      startsAt: Timestamp.fromDate(s.startsAt),
      endsAt: Timestamp.fromDate(s.endsAt),
    })),
    deadlineAt,
    lockedCandidateId: null,
    ...(window ? { window, offered: offered.map((d) => Timestamp.fromDate(d)) } : {}),
    members,
    memberUids: Object.keys(members),
  };
  const ref = polls(db).doc();
  await ref.set(doc);
  return { id: ref.id };
}

function toView(pollId: string, poll: PollDoc, viewerUid: string): PollView {
  const entries = Object.entries(poll.members ?? {}).sort(([ua, a], [ub, b]) => {
    if (ua === poll.createdBy) return -1;
    if (ub === poll.createdBy) return 1;
    return a.joinedAt.toMillis() - b.joinedAt.toMillis();
  });
  const members: PollMemberView[] = entries.map(([uid, m]) => ({
    uid,
    name: m.name,
    answeredAt: m.answeredAt?.toDate().toISOString() ?? null,
    answers: m.answers ?? {},
  }));
  return {
    id: pollId,
    title: poll.title,
    organizerUid: poll.createdBy,
    organizerName: poll.organizerName,
    status: poll.status,
    candidates: poll.candidates.map((c) => ({
      id: c.id,
      startsAt: c.startsAt.toDate().toISOString(),
      endsAt: c.endsAt.toDate().toISOString(),
    })),
    deadlineAt: poll.deadlineAt?.toDate().toISOString() ?? null,
    lockedCandidateId: poll.lockedCandidateId ?? null,
    window: poll.window ?? null,
    offered: (poll.offered ?? []).map((t) => t.toDate().toISOString()),
    members,
    me: viewerUid,
  };
}

/** Idempotent. Locked polls can still be joined, to see the result. */
export async function joinPoll(db: Firestore, pollId: string, user: AuthedUser): Promise<PollView> {
  const ref = polls(db).doc(pollId);
  const poll = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, 'poll not found');
    const doc = snap.data() as PollDoc;
    if (doc.status === 'cancelled') throw new HttpError(409, 'this poll was cancelled');
    if (doc.members[user.uid] !== undefined) return doc;
    if (Object.keys(doc.members).length >= MAX_MEMBERS) {
      throw new HttpError(409, 'this poll is full');
    }
    doc.members[user.uid] = {
      name: user.name,
      email: user.email,
      joinedAt: Timestamp.now(),
      answeredAt: null,
      answers: {},
    };
    doc.memberUids = Object.keys(doc.members);
    tx.set(ref, doc);
    return doc;
  });
  // So someone who only ever touches polls still has a user doc, as joinGame does.
  await usersCol(db).doc(user.uid).set({ name: user.name, email: user.email }, { merge: true });
  return toView(pollId, poll, user.uid);
}

export async function getPollView(
  db: Firestore,
  pollId: string,
  user: AuthedUser,
): Promise<PollView> {
  const poll = await loadPoll(db, pollId);
  if (poll.members[user.uid] === undefined) throw new HttpError(403, 'not a member of this poll');
  return toView(pollId, poll, user.uid);
}

/** No user. Only what a friend needs to decide to sign in: never names or answers. */
export async function getPollPreview(db: Firestore, pollId: string): Promise<PollPreview> {
  const poll = await loadPoll(db, pollId);
  if (poll.status === 'cancelled') throw new HttpError(404, 'poll not found');
  return {
    title: poll.title,
    organizerName: poll.organizerName,
    memberCount: Object.keys(poll.members).length,
    status: poll.status,
  };
}

export async function answerPoll(
  db: Firestore,
  pollId: string,
  user: AuthedUser,
  req: AnswerPollRequest,
): Promise<PollView> {
  const ref = polls(db).doc(pollId);
  const poll = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, 'poll not found');
    const doc = snap.data() as PollDoc;
    const me = doc.members[user.uid];
    if (me === undefined) throw new HttpError(403, 'not a member of this poll');
    if (doc.status !== 'open') throw new HttpError(409, 'this poll is no longer open');

    const given = (req?.answers ?? {}) as Record<string, unknown>;
    const ids = doc.candidates.map((c) => c.id);
    const keys = Object.keys(given);
    // One explicit answer per candidate and nothing else (Q8: no partial commits).
    if (
      keys.length !== ids.length ||
      !ids.every((id) => given[id] === 'yes' || given[id] === 'no')
    ) {
      throw new HttpError(400, 'answer yes or no for every time, and nothing else');
    }
    me.answers = Object.fromEntries(ids.map((id) => [id, given[id] as 'yes' | 'no']));
    me.answeredAt = Timestamp.now();
    tx.set(ref, doc);
    return doc;
  });
  return toView(pollId, poll, user.uid);
}

export async function lockPoll(
  db: Firestore,
  pollId: string,
  user: AuthedUser,
  req: LockPollRequest,
): Promise<PollView> {
  const ref = polls(db).doc(pollId);
  const poll = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, 'poll not found');
    const doc = snap.data() as PollDoc;
    if (doc.createdBy !== user.uid) throw new HttpError(403, 'only the organizer can lock a time');
    if (doc.status !== 'open') throw new HttpError(409, 'this poll is no longer open');
    if (!doc.candidates.some((c) => c.id === req?.candidateId)) {
      throw new HttpError(400, 'unknown time');
    }
    doc.status = 'locked';
    doc.lockedCandidateId = req.candidateId;
    tx.set(ref, doc);
    return doc;
  });
  return toView(pollId, poll, user.uid);
}

/** Not a delete: a link in a group chat should say "cancelled", not 404. */
export async function cancelPoll(
  db: Firestore,
  pollId: string,
  user: AuthedUser,
): Promise<{ ok: true }> {
  const ref = polls(db).doc(pollId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, 'poll not found');
    const doc = snap.data() as PollDoc;
    if (doc.createdBy !== user.uid) throw new HttpError(403, 'only the organizer can cancel');
    doc.status = 'cancelled';
    tx.set(ref, doc);
  });
  return { ok: true };
}

export async function listPolls(db: Firestore, user: AuthedUser): Promise<PollSummaryView[]> {
  // Single-field query, sorted in memory: no composite index (tick.ts does the same).
  const snap = await polls(db).where('memberUids', 'array-contains', user.uid).get();
  const rows = snap.docs.map((d) => {
    const poll = d.data() as PollDoc;
    const members = Object.values(poll.members ?? {});
    const locked = poll.candidates.find((c) => c.id === poll.lockedCandidateId);
    const summary: PollSummaryView = {
      id: d.id,
      title: poll.title,
      status: poll.status,
      answeredCount: members.filter((m) => m.answeredAt !== null).length,
      memberCount: members.length,
      iAnswered: poll.members[user.uid]?.answeredAt != null,
      isOrganizer: poll.createdBy === user.uid,
      lockedStartsAt: locked?.startsAt.toDate().toISOString() ?? null,
      createdAt: poll.createdAt.toDate().toISOString(),
    };
    return summary;
  });
  rows.sort((a, b) => {
    const open = Number(b.status === 'open') - Number(a.status === 'open');
    return open !== 0 ? open : b.createdAt.localeCompare(a.createdAt);
  });
  return rows.slice(0, MAX_LISTED);
}
