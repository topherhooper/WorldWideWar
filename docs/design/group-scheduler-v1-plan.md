# Build plan: group scheduler v1

The full handoff plan for the web version of the scheduler, written so a cheaper model can
execute it one phase at a time without the brainstorm in its context. The why lives in
[group-scheduler.md](group-scheduler.md) (cited below as Q2, Q8 and so on); this file is the
how. Phase 1 has its own, more detailed plan in
[group-scheduler-push-plan.md](group-scheduler-push-plan.md).

**Each phase is one PR, and each depends on the one before.** Phase 1 is a gate, not a step:
if a push does not reliably reach a home-screen iPhone, stop after phase 1 and reopen Q2.
Phases 2–6 are written on the assumption that it does. When a phase lands, the PR that lands it
replaces `tasks/web-push-reaches-a-phone.md` with **one** task file for the next phase (per
`CLAUDE.md`, never more than one). The PR that lands phase 1 deletes the push plan, as that
plan says; the PR that lands phase 6 deletes this file.

## Rules for the executor, every phase

- Read `CLAUDE.md` first. Its invariants and its "Before you push" gate apply in full.
- Branch from `origin/main` as `web/scheduler-<phase-slug>` (or the session's designated branch
  if the sandbox only allows one). Commit after each numbered step with conventional commits
  scoped by package (`feat(server):`, `feat(web):`, `test(server):`). Push after every commit;
  open a draft PR after the first push.
- **Stop at the second surprise.** Work around the first unexpected blocker and write it down;
  the second one ends the run with a written account of where it stopped.
- Do not widen scope. If a phase seems to need something from a later phase, it does not —
  stub it or leave it out and say so in the PR body.
- **Invalid input degrades, never throws** inside background work (the tick, notifications).
  Routes reject bad input with `HttpError(400, …)` the way `PUT /prefs` does in
  `packages/server/src/app.ts:193`.
- **Stored documents predate your change.** Every reader tolerates missing fields
  (`?? []`, `?? null`), including fields this plan adds in an earlier phase.
- **Keep Firestore free of composite indexes**, as `tick.ts:35-38` does: single-field queries
  only, sort in memory.
- Each phase ends with the local gate and a PR body written as a finding:

  ```bash
  pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm test:server
  pnpm exec prettier --check --end-of-line auto .
  ```

  If `pnpm test:server` cannot run, say so rather than reporting green.

- Real-phone checks use the preview setup built in phase 1 (`cloudbuild.preview.yaml`,
  `firebase.preview.json`, the stable test site at `test.topherhooper.com`). Those are **[human]** steps: write the exact
  commands into the PR body and stop.

## Decisions made after the brainstorm

Writing the build down forced choices the brainstorm did not reach. Topher settled them on
2026-10-01; they are recorded with their rejected alternatives as Q12–Q18 in
[group-scheduler.md](group-scheduler.md). In short:

1. **Who is a holdout (Q12).** A poll's members are everyone who has opened its link while
   signed in, plus anyone the organizer added from a previous poll. A holdout is a member who
   has not confirmed. Someone who never opens the link and was never in an earlier poll is
   invisible to the app, so "add from past polls" exists to make the second poll better than
   the first — and its invite is the one push that reaches a friend who missed the group chat.
2. **Answers are visible to every member (Q13)**, per person, as in Doodle.
3. **The organizer locks the final time by hand (Q14).** Nothing auto-locks, even at the
   deadline; the deadline only drives how pokes escalate.
4. **App pokes are capped and quiet (Q15).** At most three per member per poll, never between
   21:00 and 09:00 in the recipient's time zone. Friend nudges are separate (Q9).
5. **The profile is hourly (Q16)**: 7 days × 24 hours, each hour free, busy or unknown,
   learned from confirmed answers and editable directly.
6. **A candidate time has a start and an end (Q17)**, e.g. Sat 19:00–23:00, at most 24 hours
   long.
7. **The product is called Quorum (Q18).** Poll pages, poll notifications and poll emails say
   Quorum; the game keeps its own name. Whether Quorum gets its own hostname and home-screen
   icon is a launch question (phase 6).

Plan defaults that were not put to a question, and can be changed by editing this file: 2–6
candidates per poll, at most 5 tiers, at most 20 members; two new notification kinds,
`pollNudge` (app pokes and friend nudges) and `pollDecided` (a time was locked), both default
on, both sent by email and push through `notify()`, both switchable in Settings.

## Phase 1 — the push channel

See [group-scheduler-push-plan.md](group-scheduler-push-plan.md). Done when a push sent
through `notify()` arrives on a home-screen iPhone and an Android phone. Phases below assume
its pieces exist: `Pusher` and `NotifyDeps.pusher`, `pushTokens` on the user doc,
`packages/web/src/push.ts` (`pushStatus`, `enablePush`), `packages/web/src/InstallHelp.tsx`,
the service worker, and the preview deploy files.

## Phase 2 — a poll people can answer

**Done when** two signed-in accounts on the test host can: one creates a poll with three
candidate times and shares the link; the other opens it signed out, sees the title and who
asked, signs in, confirms Yes/No on each time; both see the per-time counts and who said what;
the organizer locks one time and both see it locked.

### 2.1 Types — `packages/server/src/api-types.ts`

```ts
export type PollStatus = 'open' | 'locked' | 'cancelled';
export type PollAnswer = 'yes' | 'no';

export interface CandidateView {
  id: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
}

export interface PollMemberView {
  uid: string;
  name: string;
  /** null = has not confirmed yet: a holdout. */
  answeredAt: string | null;
  answers: Record<string, PollAnswer>; // candidateId → answer; empty until confirmed
}

export interface PollView {
  id: string;
  title: string;
  organizerUid: string;
  organizerName: string;
  status: PollStatus;
  candidates: CandidateView[];
  deadlineAt: string | null;
  lockedCandidateId: string | null;
  members: PollMemberView[]; // organizer first, then by joinedAt
  me: string; // caller's uid
}

export interface PollPreview {
  title: string;
  organizerName: string;
  memberCount: number;
  status: PollStatus;
}

export interface PollSummaryView {
  id: string;
  title: string;
  status: PollStatus;
  answeredCount: number;
  memberCount: number;
  iAnswered: boolean;
  isOrganizer: boolean;
  lockedStartsAt: string | null;
  createdAt: string;
}

export interface CreatePollRequest {
  title: string;
  candidates: { startsAt: string; endsAt: string }[]; // ISO instants
  deadlineAt?: string | null; // ISO instant
  addUids?: string[]; // from past polls (Q12)
}
export interface AnswerPollRequest {
  answers: Record<string, PollAnswer>;
}
export interface LockPollRequest {
  candidateId: string;
}
export interface PastMemberView {
  uid: string;
  name: string;
}
```

Fields phases 3–5 add are listed in those phases; do not add them early.

### 2.2 Store — `packages/server/src/store.ts`

Add beside `games`:

```ts
export interface PollMember {
  name: string;
  email: string | null;
  joinedAt: Timestamp;
  answeredAt: Timestamp | null;
  answers: Record<string, 'yes' | 'no'>;
}

export interface PollDoc {
  title: string;
  createdBy: string;
  organizerName: string;
  createdAt: Timestamp;
  status: 'open' | 'locked' | 'cancelled';
  candidates: { id: string; startsAt: Timestamp; endsAt: Timestamp }[];
  deadlineAt: Timestamp | null;
  lockedCandidateId: string | null;
  members: Record<string, PollMember>;
  /** Mirror of Object.keys(members), so "my polls" is one array-contains query. */
  memberUids: string[];
}

export const polls = (db: Firestore): CollectionReference => db.collection('polls');
```

A separate collection, not a fourth `GameDoc` kind — see the Route in
[group-scheduler.md](group-scheduler.md). Members live in a map on the poll document: at most
20, each a few hundred bytes, far under Firestore's 1 MB document limit, and one document
means one transaction per answer.

### 2.3 Server logic — new file `packages/server/src/polls.ts`

Each function takes `(db, …, user: AuthedUser)` like `games.ts`, throws `HttpError` for
caller mistakes, and does its read-modify-write in `db.runTransaction`.

- `createPoll(db, user, req)`: validate — `title` trimmed, 1–80 chars; `candidates` 2–6, each
  a pair of valid ISO strings with `startsAt` in the future, `endsAt` after `startsAt` and at
  most 24 hours later (Q17); no two with the same `startsAt` and `endsAt`; sorted by `startsAt`
  before storing; each gets `id: randomUUID().slice(0, 8)`; `deadlineAt` if present must be in
  the future and before the last candidate's `startsAt`; `addUids` at most 19, each must appear
  in `pastMembers(db, user)` (below) — reject others with 400, so nobody can add strangers by
  uid.
  The organizer is the first member. Added members get `name`/`email` from their user doc,
  `answeredAt: null`. Return `{ id }`.
- `joinPoll(db, pollId, user)`: idempotent. 404 if missing, 409 if `cancelled`, 409 if 20
  members already and caller is not one. Locked polls can still be joined (to see the result).
  Also `usersCol(db).doc(uid).set({ name, email }, { merge: true })`, the way `joinGame`
  does at `games.ts:335`, so users who only ever touch polls still have a user doc.
- `getPollView(db, pollId, user)`: 404 if missing; 403 if caller is not a member (the web
  client calls join first). Maps the doc to `PollView`, timestamps to ISO.
- `getPollPreview(db, pollId)`: no user; 404 if missing or cancelled. Returns only the
  `PollPreview` fields — never member names or answers.
- `answerPoll(db, pollId, user, req)`: member only; 409 unless `open`. `answers` must have
  exactly one `'yes' | 'no'` for every candidate id and nothing else, else 400. Sets
  `answers` and `answeredAt: now`. Re-answering while open is allowed and overwrites.
- `lockPoll(db, pollId, user, req)`: organizer only (403); 409 unless `open`;
  `candidateId` must exist (400). Sets `status: 'locked'`, `lockedCandidateId`.
- `cancelPoll(db, pollId, user)`: organizer only; sets `status: 'cancelled'`. Not a delete:
  links in group chats should say "cancelled", not 404.
- `listPolls(db, user)`: `polls(db).where('memberUids', 'array-contains', uid)`, map to
  `PollSummaryView`, sort in memory: open first, then by `createdAt` descending. Cap at 50.
- `pastMembers(db, user)`: everyone who shares any poll with the caller, minus the caller,
  deduplicated by uid, sorted by name. Reuse the `listPolls` query.

### 2.4 Routes — `packages/server/src/app.ts`

Inside the authenticated block:

```
POST   /polls                 createPoll        → { id }
GET    /polls                 listPolls         → PollSummaryView[]
GET    /polls/past-members    pastMembers       → PastMemberView[]   (register before /polls/:id)
POST   /polls/:id/join        joinPoll          → PollView
GET    /polls/:id             getPollView       → PollView
PUT    /polls/:id/answer      answerPoll        → PollView
POST   /polls/:id/lock        lockPoll          → PollView
DELETE /polls/:id             cancelPoll        → { ok: true }
```

**Outside** the authenticated block, next to `/unsubscribe`, with a comment saying why it is
public (a friend opening the link from a group chat is not signed in yet, and Q5 wants them to
see what they are signing in for):

```
GET /api/polls/:id/preview    getPollPreview    → PollPreview
```

The authenticated block is mounted with `{ prefix: '/api' }` (`app.ts:299`), so register the
preview on `app` itself at the full path `/api/polls/:id/preview`; the Hosting rewrite sends
every `/api/**` to Cloud Run.

### 2.5 Server tests

New `packages/server/src/polls.test.ts` (emulator, same setup as `notify.test.ts`):
create validates each rule above (one case per rule); join is idempotent; the 21st member
gets 409; a non-member gets 403 on view; answer rejects missing, extra and invalid
candidate ids; re-answer overwrites; only the organizer can lock or cancel; lock rejects an
unknown candidate; preview of a cancelled poll is 404 and never contains member names;
`listPolls` puts open polls first; `addUids` containing a uid from no shared poll is 400.
Add route tests in the style of `app.test.ts` for the auth boundary: the preview works with no
token, everything else returns 401 without one.

### 2.6 Web — routing outside the sign-in wall

`packages/web/src/main.tsx` currently wraps the whole router in `<RequireAuth>`. Move the wall
inside the router, so the layout renders for everyone and only the routes that need sign-in
sit behind it:

```tsx
const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      // The one page a signed-out friend can reach: Q5 shows the poll's title and who
      // asked behind the sign-in button. It handles auth itself.
      { path: '/p/:id', element: <PollGate /> },
      {
        element: (
          <RequireAuth>
            <Outlet />
          </RequireAuth>
        ),
        children: [
          { path: '/', element: <Home /> },
          { path: '/g/:id', element: <Game /> },
          { path: '/settings', element: <Settings /> },
          { path: '/p', element: <Polls /> },
          { path: '/p/new', element: <NewPoll /> },
        ],
      },
    ],
  },
]);
// render: <AuthProvider><RouterProvider router={router} /></AuthProvider>
```

`/p/new` is a static segment, so React Router ranks it above `/p/:id`; add a test that proves
it. `App.tsx` must now render its top bar's user name, Settings link and Sign out button only
when `user` is signed in, since it is no longer behind the wall. Existing behaviour for every
other route must not change: add a test that `/` signed out still shows the sign-in card.

`PollGate` (`packages/web/src/polls/PollGate.tsx`):

- auth loading → "Loading…";
- signed out → fetch the preview with a plain `fetch` (not `apiFetch`, which throws when
  signed out) and show "**{organizerName}** wants to find a time for **{title}**", followed by
  the same sign-in button, error line and chat-app hint `RequireAuth` shows. Extract those
  three into a shared `SignInCard` component in `auth.tsx` and use it from both places, rather
  than copying them;
- signed in → `api.joinPoll(id)` once, then render `<PollPage>` with the returned view;
- missing or cancelled → "This poll was cancelled or doesn't exist."

Add a `Polls` link to the top bar in `packages/web/src/App.tsx` beside Settings. On `/p`
routes the brand in the top bar reads **Quorum** and links to `/p` (Q18); elsewhere it stays
"World Wide War". Use `useLocation()`; no second layout.

### 2.7 Web — pages

New folder `packages/web/src/polls/`. Reuse the existing CSS classes (`panel`, `muted`,
`error`, `form-row`, `game-list`, `game-card`) before adding any; new classes go at the end of
`styles.css` under a `/* polls */` comment.

- **`Polls.tsx`** (`/p`): "New poll" button → `/p/new`; list of `PollSummaryView` cards
  showing title, "3 of 5 answered", a "Your turn" badge (reuse `badge-due`) when `!iAnswered`
  and open, and the locked time when locked. Each links to `/p/:id`.
- **`NewPoll.tsx`** (`/p/new`): title input; 2–6 candidate rows, each a `<input
type="date">`, a start `<input type="time">` and an end `<input type="time">` (start with
  two empty rows, "Add a time" up to six, a remove button per row; a new row copies the
  previous row's times, since "same time, different day" is the common case). An end time at
  or before the start time means the next day ("21:00–01:00"). Optional deadline
  (`datetime-local`). "Add people from past polls" — a checkbox list from `api.pastMembers()`,
  hidden when empty. Build each instant with ``new Date(`${date}T${time}`).toISOString()``: the
  browser's zone is the organizer's zone, which is what they meant. Put the date/time
  arithmetic in a small pure `packages/web/src/polls/times.ts` with its own unit tests,
  including the past-midnight case. Client-side validation mirrors the server's; server
  errors show in `.error`. On success navigate to `/p/:id`.
- **`PollPage.tsx`**:
  - **Header**: title, "asked by {organizerName}", status, deadline via `formatRemaining`.
  - **Share** button, shown to every member: `navigator.share({ title, url })` when
    available, else copy the URL to the clipboard and say "Link copied". This is how a poll
    reaches the group chat; keep it at the top.
  - **Your answer** card (when open): one row per candidate, formatted in the viewer's zone
    as a range — `new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short',
day: 'numeric', hour: 'numeric', minute: '2-digit' }).formatRange(start, end)` gives
    "Sat, Oct 14, 7:00 – 11:00 PM" — each with a Yes / No segmented toggle. Put the
    formatter in `times.ts` too. Rows start
    unset in this phase; **Confirm** is disabled until every row is set (Q8: an explicit
    answer, no partial commits). After confirming, show "You're in" with an "Change answer"
    link while open.
  - **Results**: one row per candidate with the Yes count, the names who said yes, and the
    names who said no. Highlight the locked candidate when locked.
  - **Waiting on**: names of members with `answeredAt === null` (Q9: named to everyone). The
    Nudge buttons arrive in phase 5; leave room, add nothing.
  - **Organizer controls** (open only): a "Lock this time" button per candidate row, with a
    `confirm()` dialog; a "Cancel poll" link.
  - Poll for changes: re-fetch the view every 30 seconds while the tab is visible
    (`document.visibilityState`). No realtime listeners in v1.
- `packages/web/src/api.ts` gains `createPoll`, `listPolls`, `pastMembers`, `joinPoll`,
  `getPoll`, `answerPoll`, `lockPoll`, `cancelPoll`. The preview fetch lives in `PollGate`.

### 2.8 Web tests

jsdom tests mocking `../api.js` in the style of `pages/Settings.test.tsx`: `NewPoll` blocks
submit with one time and with a past time; `PollPage` keeps Confirm disabled until every row
is set and sends exactly one answer per candidate; the waiting-on list shows exactly the
members without `answeredAt`; organizer controls render only for the organizer and only while
open. A router test that `/p/new` renders `NewPoll`, not `PollGate`.

## Phase 3 — the availability profile

**Done when** a person who confirmed one poll opens a second poll whose times fall in hours
they already answered for, and finds those rows already ticked — and nothing is recorded for
them until they press Confirm.

### 3.1 The model — new pure module `packages/server/src/profile.ts`

No Firestore, no clock, no I/O in this file: everything a test needs is in the arguments.
The profile is hourly (Q16): 168 cells, one per weekday-hour, in the person's own zone.

```ts
export type Cell = 'free' | 'busy';
/** Key `${weekday}-${hour}`: weekday 0 = Sunday … 6 = Saturday (as Date.getDay()), hour
 *  0–23, both in the person's zone. Absent key = unknown. */
export type Profile = Partial<Record<string, Cell>>;

/** The weekday-hour keys a span touches, in a zone: 19:00–23:00 Sat → 6-19 … 6-22. A span
 *  that crosses midnight continues into the next weekday. The end hour is exclusive unless
 *  the span ends mid-hour (19:00–22:30 includes 6-22). */
export function hoursOf(startsAt: Date, endsAt: Date, timeZone: string): string[];

export function preTick(
  profile: Profile | undefined,
  span: { startsAt: Date; endsAt: Date },
  timeZone: string,
): 'yes' | 'no' | null;
// any hour in the span busy → 'no'; every hour free → 'yes'; otherwise null (unset row).

export function learn(
  profile: Profile | undefined,
  answers: Record<string, 'yes' | 'no'>,
  candidates: { id: string; startsAt: Date; endsAt: Date }[],
  timeZone: string,
): Profile;
// 'yes' → every hour of the span becomes free: they said they could do the whole thing.
// 'no'  → only the span's FIRST hour becomes busy: a No to 19:00–23:00 says they cannot
//         start at 7, not that every hour until 11 is taken. Last write wins per hour.

export function isValidKey(key: string): boolean; // 0-6 '-' 0-23, nothing else
```

Compute weekday and hour with `Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short',
hour: 'numeric', hourCycle: 'h23' }).formatToParts(instant)` — no date library. Step through
a span hour by hour in absolute time, so DST is handled by `Intl` rather than by arithmetic.
Unit tests (plain vitest, no emulator) must cover: a span inside one hour; a span ending
exactly on the hour versus mid-hour; a span crossing midnight into the next weekday; a
DST-change night in `America/Los_Angeles` (the repeated and the skipped hour); an instant that
is Saturday in Los Angeles and Sunday in London; `preTick` with all-free, one-busy and
partly-unknown spans; `learn` for yes and for no; an invalid zone string falling back to
`'UTC'` instead of throwing.

### 3.2 Storage and routes

- `UserDoc` gains `profile?: Profile` and `timeZone?: string`.
- `answerPoll` (phase 2) additionally, in the same transaction, reads the user doc and writes
  `profile: learn(…)` and `timeZone` from the request (below). It must not fail the answer if
  the stored profile is malformed — `learn` drops any key `isValidKey` rejects.
- `AnswerPollRequest` gains `timeZone?: string` (the client sends
  `Intl.DateTimeFormat().resolvedOptions().timeZone`).
- `PollView` gains `suggested: Record<string, 'yes' | 'no' | null>` — the viewer's pre-ticks,
  computed server-side in `getPollView` from the viewer's profile and stored `timeZone`
  (fallback `'UTC'`). Server-side so the phone app later gets the same answer for free.
- `GET /profile` → `{ profile: Profile, timeZone: string | null }`;
  `PUT /profile` `{ profile, timeZone }` → keeps only keys `isValidKey` accepts with values
  `'free' | 'busy'`, drops anything else (degrade, not 400), saves.

### 3.3 Web

- `PollPage`'s answer card initialises each row from `view.suggested`, marks pre-ticked rows
  with a small "from your usual week" label, and still requires Confirm (Q8). A row with no
  suggestion stays unset.
- New page `packages/web/src/polls/Availability.tsx` at `/availability`, linked from Settings
  and from the answer card ("Edit your usual week"). 168 cells do not fit a phone as one grid,
  so: a row of seven day tabs; under the selected day, 24 hour rows from 00:00 to 23:00,
  scrolled to 08:00 on open; each row a button cycling unknown → free → busy → unknown. Two
  shortcuts make it usable: **paint** — after tapping one hour, tapping another hour on the
  same day sets every hour between them to the first one's new state; and **copy this day
  to…** — a menu offering "weekdays", "weekend" and "every day". Save on change with the
  snap-back-on-error pattern `Settings.tsx` uses, debounced to one `PUT` per second. Copy above
  it: "We use this to pre-fill polls. Nothing is sent until you confirm."
- Tests: a row cycles and saves; paint fills the range between two taps; copy-to-weekdays
  copies exactly Monday–Friday; the answer card shows pre-ticks and the label; Confirm is
  still required.

## Phase 4 — headcount tiers

**Done when** an organizer can add "3+: Catan" and "5+: Werewolf" to a poll, and each
candidate row shows its Yes count with the tier it has reached and how many more the next
tier needs.

- `PollDoc` gains `tiers?: { min: number; label: string }[]`; `CreatePollRequest` gains
  `tiers?: …`; `PollView` gains `tiers`. Validation: at most 5; `min` an integer 2–20;
  `label` trimmed 1–40 chars; `min` values distinct; stored sorted ascending.
- A pure function in a new `packages/server/src/tiers.ts`:

  ```ts
  export function tierStatus(
    tiers: { min: number; label: string }[] | undefined,
    yesCount: number,
  ): { reached: string | null; next: { label: string; needed: number } | null };
  ```

  Unit tests: no tiers; below the first; exactly on a tier; between tiers; above the last.

- Compute it **server-side** and ship it in the view: `CandidateView` gains
  `tier: ReturnType<typeof tierStatus>`, filled in `getPollView` from that candidate's yes
  count. The web client only renders it, which keeps one copy of the rule and gives the phone
  app the same answer later for free — the same reasoning as `suggested` in phase 3.
- `NewPoll`: a "Plans by headcount (optional)" section with rows of [number] [label], add up
  to five.
- `PollPage` results rows: "4 yes — Catan · 1 more for Werewolf". When locked, the locked row
  says which tier the final count reached.

## Phase 5 — pokes

**Done when**, on the test host with two phones: a friend taps Nudge on a holdout and the
holdout's phone shows "{friend} is waiting on you for {title}" with the strongest line that
applies; a second Nudge from the same friend the same day is refused with a clear message; the
tick sends an app poke to a holdout at the right moment and never during their quiet hours; and
everyone gets a push when the organizer locks the time.

### 5.1 Notification kinds

- `NotifyKind` in `api-types.ts` gains `'pollNudge' | 'pollDecided'`; `DEFAULT_PREFS` in
  `notify.ts:11` gains both as `true`.
- **Trap:** `POST /unsubscribe` at `app.ts:155` writes the three existing kinds by name.
  Change it to build the patch from `NOTIFY_KINDS`, so an unsubscribe turns off every kind
  that exists, now and later. Add a test that unsubscribing turns off `pollNudge`.
- `Settings.tsx` `ROWS` gains `['pollNudge', 'Someone is waiting on you', 'Reminders and
nudges from friends when a Quorum poll needs your answer.']` and `['pollDecided', 'A time is
picked', 'When the organizer locks the final time.']`.
- Every poll email subject starts with `[Quorum] `, the way game mail starts with `[WWW] `,
  so inbox filters can tell the two apart; phase 1 already strips that tag from push titles.
- Recipients: `notify()` takes `Recipient { uid, email }`. Poll members store both, so pass
  `{ uid, email: member.email }`. Today `notify()` drops any recipient whose `email` is null
  before doing anything (`notify.ts:74-76`), which after phase 1 would also skip their push.
  Change the filter so a null `uid` skips the recipient and a null `email` skips only the
  email, and test both.

### 5.2 The poke composer — pure, in new `packages/server/src/poke.ts`

The psychology layer, in one function with no clock and no I/O, so it is unit-testable the way
the engine is. It picks the single strongest true line; it never invents urgency.

```ts
export interface PokeInput {
  title: string;
  memberCount: number;
  answeredCount: number;
  /** Best candidate by yes count, ties → earliest; null if nobody said yes yet. */
  leading: { label: string; yesCount: number } | null; // label = formatted time
  tierNext: { label: string; needed: number } | null; // from tierStatus(leading)
  deadlineIn: number | null; // ms until deadline
  from: string | null; // friend's name for a peer nudge
}
export function composePoke(p: PokeInput): { title: string; body: string };
```

Title: `"{from} is waiting on you"` for a peer nudge, else `"{title} needs your answer"`.
Body: the first of these that is true —

1. **Pivotal**: `tierNext.needed === 1` → "One more yes and {leading.label} becomes
   {tierNext.label}."
2. **Last one**: `answeredCount === memberCount - 1` → "Everyone else has answered — it's down
   to you."
3. **Deadline**: `deadlineIn !== null && deadlineIn < 24h` → "{answeredCount} of
   {memberCount} are in, and it closes in {formatted}."
4. **Progress**: `answeredCount > 0` → "{answeredCount} of {memberCount} are in.
   {leading ? leading.label + ' is leading.' : ''}"
5. **Plain**: "Pick the times that work for you — it takes a few seconds."

No exclamation marks, no "don't miss out", nothing that is not true of this poll right now.
The link goes in the push's `link`, not in the text. Unit-test every branch, including the ordering
(pivotal beats last-one when both are true) and that `from` changes only the title.
Format `deadlineIn` with a small pure helper (hours, or days if over 48h); do not import the
web's `formatRemaining`.

`leading.label` must be formatted in the **recipient's** zone (stored `timeZone`, fallback
`'UTC'`) as the span's start, e.g. "Sat 7pm", with `toLocaleString('en-US', { timeZone,
weekday: 'short', hour: 'numeric' })`; the caller does that, so `composePoke` stays
zone-free.

### 5.3 Friend nudges

- `PollDoc` gains `nudges?: Record<string, Timestamp>`, keyed `` `${fromUid}>${toUid}` ``.
- `POST /polls/:id/nudge` `{ to: uid }` in a new `nudgeMember` in `polls.ts`: caller must be a
  member (403); poll open (409); `to` a member who has not answered (409 "they already
  answered"); not self (400); `nudges[key]` absent or older than 24 hours, else 429 with
  "You nudged {name} today already". In the transaction, set `nudges[key] = now`; **after**
  the transaction, `notify(deps, 'pollNudge', [target], { subject, text, link })` with
  `subject`/`text` from `composePoke({ …, from: caller.name })` and `link =
${baseUrl}/p/${id}`. The rate limit is decision Q9's guard against a shaming tool; do not
  loosen it.
- `PollView` gains `myNudges: Record<string, string>` (toUid → ISO time of the caller's last
  nudge), so the button can say "Nudged" until tomorrow.
- `PollPage` Waiting-on list: a "Nudge" button beside each name (not beside the viewer's own),
  disabled with "Nudged" after use.

### 5.4 App pokes from the tick

- `PollDoc` gains `pokes?: Record<string, { count: number; lastAt: Timestamp }>` keyed by uid.
- New `sweepPolls(deps, now)` in `polls.ts`, called from `runTick` in `tick.ts:39` after the
  games loop, in its own try/catch so a poll error never stops game resolution; add
  `pokedPolls: string[]` to `TickResult`.
- Query `polls(db).where('status', '==', 'open')` (single field, no composite index).
- For each holdout, decide with a **pure** `pokeDue(...)` in `poke.ts`, unit-tested:

  ```ts
  export function pokeDue(a: {
    joinedAt: number;
    createdAt: number;
    deadlineAt: number | null;
    count: number;
    lastAt: number | null;
    now: number;
    localHour: number;
  }): boolean;
  ```

  Rules, in order: `count >= 3` → no. `localHour >= 21 || localHour < 9` → no (Q15).
  `lastAt !== null && now - lastAt < 12h` → no. Then, with a deadline: poke 1 once half the
  time from `createdAt` to the deadline has passed, poke 2 inside the last 24h, poke 3 inside
  the last 3h — each only if `count` is below that stage's number. Without a deadline: poke 1
  at 24h after `joinedAt`, poke 2 at 72h, never a third. `localHour` comes from the member's
  stored `timeZone` (fallback `'UTC'`) via `Intl`, computed by the caller.

- When due, increment `pokes[uid]` in a transaction that re-reads the poll and re-checks
  `pokeDue` (two tick runs must not double-send), then `notify(deps, 'pollNudge', …)` with
  `composePoke({ …, from: null })`.
- Tests (emulator): a member who joined 25h ago with no deadline gets exactly one poke across
  two consecutive sweeps; nobody is poked at 23:00 local; an answered member is never poked;
  a locked poll is never swept; the fourth poke never happens.

### 5.5 Decided, and invites from past polls

- `lockPoll` (phase 2), after its transaction: `notify(deps, 'pollDecided', allMembers,
{ subject: "{title}: {time} it is", text: "{organizerName} locked {time}. {tier line if
any}", link })`. The time must read in each member's own zone, so make one `notify()` call
  per member, formatting with their stored `timeZone` (fallback `'UTC'`). `lockPoll`
  therefore takes `NotifyDeps`, like `resolveNow` does at `games.ts:439`.
- `createPoll` with `addUids`: after the transaction, `notify(deps, 'pollNudge', added,
{ subject: "{organizerName} added you to {title}", text: "Pick the times that work for
you.", link })`. This is the push that reaches a friend who never saw the group chat — the
  reason Q12 exists.

### 5.6 Getting people to turn notifications on

Q2's accepted cost is that a holdout who never installs cannot be poked, so the install is the
first poke. Right after a successful Confirm on `PollPage`, if `pushStatus()` is `'off'`, show
a card: "Get told when the time is picked" with the enable button; if `'needs-install'`, show
the same card with `<InstallHelp />` inside it. Dismissible, and remembered in `localStorage`
per poll (wrapped in try/catch). Never shown before the answer — the answer comes first.

## Phase 6 — launch to the five friends

**Done when** a real poll among the real group goes from link in the group chat to a locked
time without Topher sending a follow-up text. That is the outcome in
[group-scheduler.md](group-scheduler.md), and it is the only test that counts.

- `CLAUDE.md`: under "What done looks like", add the scheduler's own one-sentence spec beside
  the game's — "Five friends get one link in the group chat, each confirms their times on a
  phone in under thirty seconds, and the last holdout answers because the app nudged them, not
  because the organizer did." Keep the game's sentence as it is.
- `README.md`: a short section describing the scheduler as it stands (current state only, per
  `CLAUDE.md` — no history).
- The scheduler is **Quorum** (Q18), but it shares the game's hostname, manifest and
  home-screen icon, so a friend who adds it to their home screen gets an icon labelled
  "World Wide War". Whether Quorum gets its own hostname — a second Firebase Hosting site in
  the same project is free — is a **[human]** decision to take before relight. Flag it in the
  PR with that cost and stop; do not build it under this plan.
- **[human]** relight, following the Relight section of `docs/deployment.md` exactly. Relight
  wakes the game's tick too; that is intended, since Q11 keeps both alive together.
- **[human]** run one real poll with the group and record in the PR body: how long each person
  took to answer, who needed a nudge, whether any nudge came from a friend, and anything anyone
  had to ask about. A failure there is a finding for `docs/onboarding-gaps.md`, in the same
  spirit as the game's.

## Deliberately not in v1

Each of these was either rejected in the brainstorm or deferred by it; none is to be built
under this plan. Proposing one belongs in a new idea, not a phase.

- The native phone app, Sign in with Apple, reading the phone calendar, and Yes/No buttons on
  the notification itself (Q4: after the web app).
- A "suggest times" button that proposes candidates from everyone's profiles (Q7: later).
- Silence counting as an answer, or any auto-lock at the deadline (Q8).
- SMS, paid or otherwise (Q2).
- Anonymous answering (Q5).
- Realtime listeners, calendar invites (`.ics`), comments on a poll, recurring polls.
