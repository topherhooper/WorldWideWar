// Two accounts through one poll, against a deployed stack: Hosting rewrite, Cloud Run
// revision and real Firestore. This is phase 2's done-when, which nobody can run by hand
// without two Google accounts and two devices.
//
// Google sign-in cannot be automated, so the two people are Firebase users signed in with
// custom tokens: the runner mints them with the Admin SDK, which needs
// iam.serviceAccounts.signBlob on its own service account, and trades them for ID tokens
// through the same Identity Toolkit endpoint and API key the web app uses. The server sees
// ordinary Firebase ID tokens; nothing in it knows this suite exists.
//
//   SMOKE_ORIGIN    where to aim, default https://test.topherhooper.com
//   SMOKE_PROJECT   Firebase project, default fluted-citizen-269819
//   SMOKE_API_KEY   default: VITE_FIREBASE_API_KEY from packages/web/.env.production
//   SMOKE_SERVICE_ACCOUNT  the account that signs custom tokens, when not discoverable
//
// With FIREBASE_AUTH_EMULATOR_HOST set (as `firebase emulators:exec` does) tokens come from
// the Auth emulator instead, which is how the suite is checked locally.
//
// What it leaves behind: two Auth users, smoke-organizer and smoke-friend, and one poll per
// run, cancelled at the end. They are visible only to those two users.
import { readFileSync } from 'node:fs';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PollPreview, PollSummaryView, PollView } from '../api-types.js';

const origin = process.env.SMOKE_ORIGIN ?? 'https://test.topherhooper.com';
const projectId = process.env.SMOKE_PROJECT ?? 'fluted-citizen-269819';
const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;

function apiKey(): string {
  if (process.env.SMOKE_API_KEY) return process.env.SMOKE_API_KEY;
  if (emulator) return 'emulator';
  const env = readFileSync(new URL('../../../web/.env.production', import.meta.url), 'utf8');
  const key = /^VITE_FIREBASE_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
  if (!key) throw new Error('no VITE_FIREBASE_API_KEY in packages/web/.env.production');
  return key;
}

/** A Firebase ID token for `uid`, by the custom-token route. */
async function signIn(uid: string, name: string): Promise<string> {
  // Named rather than discovered, so a signBlob denial names the account that needs it.
  const serviceAccountId = process.env.SMOKE_SERVICE_ACCOUNT;
  if (getApps().length === 0) {
    initializeApp(serviceAccountId ? { projectId, serviceAccountId } : { projectId });
  }
  const custom = await getAuth().createCustomToken(uid, { name });
  const base = emulator
    ? `http://${emulator}/identitytoolkit.googleapis.com`
    : 'https://identitytoolkit.googleapis.com';
  const res = await fetch(`${base}/v1/accounts:signInWithCustomToken?key=${apiKey()}`, {
    method: 'POST',
    // The key is restricted by HTTP referrer to the sites that sign in with it.
    headers: { 'Content-Type': 'application/json', Referer: `${origin}/` },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`signInWithCustomToken ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { idToken: string }).idToken;
}

interface Reply<T> {
  status: number;
  body: T;
}

async function call<T>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<Reply<T>> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${origin}${path}`, init);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

function hoursFromNow(h: number): string {
  const d = new Date(Date.now() + h * 3_600_000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

describe(`two accounts, one poll, on ${origin}`, () => {
  const title = `[smoke] ${new Date().toISOString()}`;
  let organizer = '';
  let friend = '';
  let pollId = '';
  let candidates: string[] = [];

  beforeAll(async () => {
    organizer = await signIn('smoke-organizer', 'Smoke Organizer');
    friend = await signIn('smoke-friend', 'Smoke Friend');
  });

  afterAll(async () => {
    // Cancelling is a status, so the poll drops out of previews and stays out of the way.
    if (pollId) await call('DELETE', `/api/polls/${pollId}`, organizer);
  });

  it('reaches a server that has the poll routes', async () => {
    // 401 means the poll routes exist and want a token. 404 means /api reached a revision
    // without them, which on the test host is the Cloud Run tag not holding.
    expect((await call('GET', '/api/polls')).status).toBe(401);
  });

  it('lets the organizer create a poll with three times', async () => {
    const res = await call<{ id: string }>('POST', '/api/polls', organizer, {
      title,
      candidates: [48, 72, 96].map((h) => ({
        startsAt: hoursFromNow(h),
        endsAt: hoursFromNow(h + 3),
      })),
    });
    expect(res.status).toBe(200);
    pollId = res.body.id;
    expect(pollId).toBeTruthy();
  });

  it('shows a signed-out friend the title and who asked, and nothing else', async () => {
    const res = await call<PollPreview>('GET', `/api/polls/${pollId}/preview`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      title,
      organizerName: 'Smoke Organizer',
      memberCount: 1,
      status: 'open',
    });
  });

  it('keeps the poll itself from someone who has not joined', async () => {
    expect((await call('GET', `/api/polls/${pollId}`, friend)).status).toBe(403);
  });

  it('lets the friend join, twice without harm', async () => {
    const first = await call<PollView>('POST', `/api/polls/${pollId}/join`, friend);
    expect(first.status).toBe(200);
    expect(first.body.members.map((m) => m.uid)).toEqual(['smoke-organizer', 'smoke-friend']);
    candidates = first.body.candidates.map((c) => c.id);
    expect(candidates).toHaveLength(3);
    const again = await call<PollView>('POST', `/api/polls/${pollId}/join`, friend);
    expect(again.body.members).toHaveLength(2);
  });

  it('turns away an answer that skips a time', async () => {
    const res = await call('PUT', `/api/polls/${pollId}/answer`, friend, {
      answers: { [candidates[0]]: 'yes' },
    });
    expect(res.status).toBe(400);
  });

  it('records both answers and shows each person the other’s', async () => {
    const [a, b, c] = candidates;
    const f = await call('PUT', `/api/polls/${pollId}/answer`, friend, {
      answers: { [a]: 'yes', [b]: 'no', [c]: 'yes' },
    });
    expect(f.status).toBe(200);
    const o = await call('PUT', `/api/polls/${pollId}/answer`, organizer, {
      answers: { [a]: 'yes', [b]: 'yes', [c]: 'no' },
    });
    expect(o.status).toBe(200);

    for (const token of [organizer, friend]) {
      const view = await call<PollView>('GET', `/api/polls/${pollId}`, token);
      const byUid = Object.fromEntries(view.body.members.map((m) => [m.uid, m]));
      expect(byUid['smoke-organizer'].answers).toEqual({ [a]: 'yes', [b]: 'yes', [c]: 'no' });
      expect(byUid['smoke-friend'].answers).toEqual({ [a]: 'yes', [b]: 'no', [c]: 'yes' });
      expect(view.body.members.every((m) => m.answeredAt !== null)).toBe(true);
    }
  });

  it('lets only the organizer lock a time', async () => {
    const byFriend = await call('POST', `/api/polls/${pollId}/lock`, friend, {
      candidateId: candidates[0],
    });
    expect(byFriend.status).toBe(403);
    const byOrganizer = await call<PollView>('POST', `/api/polls/${pollId}/lock`, organizer, {
      candidateId: candidates[0],
    });
    expect(byOrganizer.status).toBe(200);
  });

  it('shows the locked time to both, and in the organizer’s list', async () => {
    for (const token of [organizer, friend]) {
      const view = await call<PollView>('GET', `/api/polls/${pollId}`, token);
      expect(view.body.status).toBe('locked');
      expect(view.body.lockedCandidateId).toBe(candidates[0]);
    }
    const list = await call<PollSummaryView[]>('GET', '/api/polls', organizer);
    const mine = list.body.find((p) => p.id === pollId);
    expect(mine?.status).toBe('locked');
    expect(mine?.isOrganizer).toBe(true);
  });

  it('closes answering once locked', async () => {
    const [a, b, c] = candidates;
    const res = await call('PUT', `/api/polls/${pollId}/answer`, friend, {
      answers: { [a]: 'no', [b]: 'no', [c]: 'no' },
    });
    expect(res.status).toBe(409);
  });
});
