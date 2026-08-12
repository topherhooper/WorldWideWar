# Game Server Implementation Plan (1 of 3: server, web, deploy)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Fastify API (`packages/server`) wrapping `@www/engine` with Firestore persistence, Firebase Auth, deadline ticks, and email — fully tested against emulators.

**Architecture:** Trusted server holds full game state in Firestore (`stateJson`/`mapJson` as canonical JSON strings); every read is redacted per viewer; turn resolution is a Firestore transaction guarded by turn number so the tick and last-lock-in race safely. Spec: `docs/superpowers/specs/2026-08-11-game-server-design.md`.

**Tech Stack:** Node 22, TypeScript ESM, Fastify 5, firebase-admin 13, google-auth-library, Resend, vitest, Firebase emulators (Firestore + Auth).

## Global Constraints

- ESM throughout (`"type": "module"`), imports end in `.js`, matching the engine.
- No new runtime deps beyond: `fastify`, `firebase-admin`, `google-auth-library`, `resend`.
- Engine is the only rules authority: server never reimplements validation/resolution — it calls `normalizeOrders`, `resolveTurn`, `redact`.
- `seed` and other players' orders must never appear in any HTTP response.
- Integration tests run only under emulators: guard every emulator suite with `describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)` so plain `pnpm test` still passes.
- Emulator project id: `demo-www` (demo- prefix = offline, no real project).
- Firestore emulator needs Java 11+ on PATH. If missing locally, stop and ask the user to install it.
- Commit after every task.

## Engine API used (exact, from packages/engine/src/index.ts)

```ts
generateMap(seed: string, playerCount: number): GeneratedMap        // throws outside [MIN_PLAYERS, MAX_PLAYERS]
createInitialState(map: GeneratedMap, rules?: RuleConfig): GameState
rulesFor(playerCount: number): RuleConfig
resolveTurn(state, submissions: readonly (OrderSet|null)[], { seed, map, rules }): { next: GameState; report: TurnReport }
redact(state: GameState, viewer: Slot | null): GameState
normalizeOrders(state, map, slot, raw: OrderSet | null, events: WorldEvent[]): NormalizedOrders
  // pushes { kind: 'order_rejected', slot, reason } onto events for each rejected order
emptyOrders(slot: Slot): OrderSet
decideOrders(state, map, slot, rng: Rng, personality: BotPersonality): OrderSet
makePersonality(rng: Rng, slot: Slot, difficulty: Difficulty): BotPersonality
makeRng(seed: string): Rng;  substream(seed, ...parts): Rng   // variadic parts, e.g. substream(seed, 'personality', slot)
canonicalJson(value: unknown): string
// Bot pattern (mirror packages/engine/src/simulate.ts:83-110): personalities from
// substream(seed,'personality',slot); bots decide from redact(state, slot), rng substream(seed,'bot',turn,slot).
```

## File structure

```
firebase.json                      (new, repo root) emulator ports
packages/server/
  package.json  tsconfig.json      (mirror packages/engine/tsconfig.json + reference ../engine)
  src/
    api-types.ts     DTOs shared with web
    store.ts         Firestore init, GameDoc/OrderDoc shapes, load/save (JSON string fields)
    mailer.ts        Mailer interface, LogMailer, ResendMailer
    auth.ts          Verifiers interface; firebase-admin user tokens; OIDC tick tokens
    games.ts         create / join / start / getView / listGames / submitOrders
    resolve.ts       transactional turn resolution + bot orders + post-commit emails
    tick.ts          deadline sweep + reminders
    app.ts           buildApp(deps) → Fastify instance (exported for inject tests)
    main.ts          production entrypoint
    testing.ts       emulator helpers: fresh app, emulator auth tokens
    *.test.ts        colocated, emulator-guarded
```

---

### Task 1: Workspace scaffolding

**Files:** Create `packages/server/package.json`, `packages/server/tsconfig.json`, `packages/server/src/api-types.ts`, `firebase.json`; Modify root `tsconfig.json` (add reference), root `package.json` (add `test:server` script).

**Interfaces produced:** package `@www/server` builds under `tsc --build`; DTO types below are what web (plan 2) and all later tasks import.

- [ ] **Step 1: packages/server/package.json**

```json
{
  "name": "@www/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/main.js",
  "scripts": { "build": "tsc --build", "typecheck": "tsc --build --force", "dev": "tsx watch src/main.ts" },
  "dependencies": {
    "@www/engine": "workspace:*",
    "fastify": "^5.6.2",
    "firebase-admin": "^13.4.0",
    "google-auth-library": "^10.1.0",
    "resend": "^4.5.1"
  }
}
```

- [ ] **Step 2: tsconfig.** Copy `packages/engine/tsconfig.json` verbatim, then add `"references": [{ "path": "../engine" }]`. Add `{ "path": "./packages/server" }` to the root `tsconfig.json` references.

- [ ] **Step 3: firebase.json** (repo root):

```json
{
  "emulators": {
    "firestore": { "port": 8080 },
    "auth": { "port": 9099 },
    "ui": { "enabled": false }
  }
}
```

- [ ] **Step 4: root package.json** — add script
  `"test:server": "firebase emulators:exec --only firestore,auth --project demo-www \"vitest run packages/server\""`
  and devDependency `firebase-tools` is NOT added (global install exists; CI installs it in plan 3's CI task — for now Task 11 handles CI).

- [ ] **Step 5: api-types.ts** — complete file:

```ts
import type { GameState, GeneratedMap, OrderSet, TurnReport, GameResult } from '@www/engine';

export type GameStatus = 'lobby' | 'active' | 'finished';

export interface SeatView { slot: number; name: string; isBot: boolean; taken: boolean; }

export interface GameSummaryView {
  id: string; status: GameStatus; playerCount: number; seatsFilled: number;
  turn: number; deadlineAt: string | null; mySlot: number | null; myLocked: boolean;
}

export interface GameView {
  id: string; status: GameStatus; playerCount: number;
  seats: SeatView[]; turn: number; deadlineAt: string | null; turnMinutes: number;
  map: GeneratedMap;
  state: GameState | null;              // redacted for the viewer; null while in lobby
  mySlot: number | null; myOrders: OrderSet | null; myLocked: boolean;
  lockedSlots: number[]; latestReport: TurnReport | null; result: GameResult | null;
}

export interface CreateGameRequest { playerCount: number; turnMinutes: number; }
export interface SubmitOrdersRequest { orders: OrderSet; locked: boolean; }
export interface SubmitOrdersResponse { warnings: string[]; resolved: boolean; view: GameView; }
```

- [ ] **Step 6:** `pnpm install`, then `pnpm build` — expect clean. `pnpm test` still green.
- [ ] **Step 7: Commit** `feat(server): scaffold @www/server package and emulator config`

---

### Task 2: Mailer

**Files:** Create `packages/server/src/mailer.ts`, `packages/server/src/mailer.test.ts`.

**Interfaces produced:**

```ts
export interface Mail { to: string; subject: string; text: string; }
export interface Mailer { send(mail: Mail): Promise<void>; }
export class LogMailer implements Mailer { sent: Mail[]; /* records + console.log one line */ }
export function resendMailer(apiKey: string, from: string): Mailer  // wraps resend SDK; errors logged, never thrown
```

- [ ] **Step 1: failing test** — `LogMailer` records mail; `send` resolves.

```ts
import { describe, expect, it } from 'vitest';
import { LogMailer } from './mailer.js';

describe('LogMailer', () => {
  it('records sent mail', async () => {
    const m = new LogMailer();
    await m.send({ to: 'a@b.c', subject: 's', text: 't' });
    expect(m.sent).toEqual([{ to: 'a@b.c', subject: 's', text: 't' }]);
  });
});
```

- [ ] **Step 2:** `pnpm exec vitest run packages/server/src/mailer.test.ts` → FAIL (module not found).
- [ ] **Step 3:** implement both mailers. `resendMailer` calls `new Resend(apiKey).emails.send({ from, to, subject, text })` inside try/catch — email failure must never fail a request.
- [ ] **Step 4:** test → PASS.  **Step 5: Commit** `feat(server): mailer interface with log and resend implementations`

---

### Task 3: Store — Firestore shapes and JSON round-trip

**Files:** Create `packages/server/src/store.ts`, `packages/server/src/testing.ts`, `packages/server/src/store.test.ts`.

**Interfaces produced:**

```ts
export interface Seat { uid: string | null; name: string; email: string | null; isBot: boolean; }
export interface GameDoc {
  status: GameStatus; createdBy: string; createdAt: Timestamp;
  playerCount: number; seats: (Seat | null)[];
  turn: number; deadlineAt: Timestamp | null; turnMinutes: number; remindedTurn: number;
  seed: string; rules: RuleConfig; stateJson: string | null; mapJson: string;
}
export interface OrderDoc { ordersJson: string; locked: boolean; updatedAt: Timestamp; }
export function initFirestore(projectId: string): Firestore   // firebase-admin initializeApp once
export const games = (db: Firestore) => db.collection('games');
export const ordersCol = (db: Firestore, gameId: string) => ...  // games/{id}/orders
export const reportsCol = (db: Firestore, gameId: string) => ... // games/{id}/reports
export const usersCol = (db: Firestore) => db.collection('users');
export const orderDocId = (turn: number, slot: number) => `${turn}-${slot}`;
export function parseState(doc: GameDoc): GameState | null;  // JSON.parse of stateJson
export function parseMap(doc: GameDoc): GeneratedMap;
export function serializeState(s: GameState): string;        // canonicalJson
```

`testing.ts` exports `emulatorDb()` (initFirestore('demo-www')) and `clearFirestore()` (DELETE to `http://localhost:8080/emulator/v1/projects/demo-www/databases/(default)/documents`).

- [ ] **Step 1: failing test** (emulator-guarded):

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { generateMap, createInitialState, rulesFor } from '@www/engine';
import { emulatorDb, clearFirestore } from './testing.js';
import { games, serializeState, parseState, parseMap, type GameDoc } from './store.js';
import { Timestamp } from 'firebase-admin/firestore';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('store', () => {
  beforeEach(clearFirestore);
  it('round-trips a full game doc through Firestore', async () => {
    const db = emulatorDb();
    const map = generateMap('round-trip', 4);
    const state = createInitialState(map, rulesFor(4));
    const doc: GameDoc = {
      status: 'active', createdBy: 'u1', createdAt: Timestamp.now(),
      playerCount: 4, seats: [{ uid: 'u1', name: 'A', email: null, isBot: false }, null, null, null],
      turn: 1, deadlineAt: Timestamp.now(), turnMinutes: 1440, remindedTurn: 0,
      seed: 'round-trip', rules: rulesFor(4), stateJson: serializeState(state), mapJson: serializeState(map as never),
    };
    await games(db).doc('g1').set(doc);
    const got = (await games(db).doc('g1').get()).data() as GameDoc;
    expect(parseState(got)).toEqual(state);
    expect(parseMap(got)).toEqual(map);
    expect(got.seats).toEqual(doc.seats);
  });
});
```

- [ ] **Step 2:** `pnpm test:server` → FAIL (store.js missing). Plain `pnpm test` → suite skipped, green.
- [ ] **Step 3:** implement `store.ts` + `testing.ts`. `initFirestore` must be idempotent (`getApps().length` guard) and must NOT pass credentials when `FIRESTORE_EMULATOR_HOST` is set.
- [ ] **Step 4:** `pnpm test:server` → PASS.  **Step 5: Commit** `feat(server): firestore store layer with canonical-JSON state fields`

---

### Task 4: Game service — create, view, list

**Files:** Create `packages/server/src/games.ts`, `packages/server/src/games.test.ts`.

**Interfaces produced (consumed by routes in Task 8):**

```ts
export interface AuthedUser { uid: string; name: string; email: string | null; }
export class HttpError extends Error { constructor(public statusCode: number, message: string) }
export async function createGame(db, user: AuthedUser, req: CreateGameRequest): Promise<string>
export async function getView(db, gameId: string, user: AuthedUser): Promise<GameView>
export async function listGames(db, user: AuthedUser): Promise<GameSummaryView[]>
```

Behavior: `createGame` validates playerCount within engine MIN/MAX and turnMinutes in [5, 10080] (else HttpError 400); seed = `crypto.randomUUID()`; map generated now; `stateJson: null` until start; creator takes seat 0; user doc gets gameId appended (`FieldValue.arrayUnion`). `getView` builds the aggregate DTO: `state: redact(parseState(doc), mySlot)` when active/finished, seats mapped to `SeatView` (uid/email withheld), `lockedSlots` from the current turn's order docs, `latestReport` from `reports/{turn-1}` when turn > 1, `result` parsed from the final report when finished. `listGames` reads the user doc's gameIds then `getAll`s the games.

- [ ] **Step 1: failing tests** — three, in one emulator-guarded describe:

```ts
it('creates a lobby game with creator in seat 0', async () => {
  const id = await createGame(db, alice, { playerCount: 4, turnMinutes: 60 });
  const view = await getView(db, id, alice);
  expect(view.status).toBe('lobby');
  expect(view.mySlot).toBe(0);
  expect(view.seats.filter((s) => s.taken)).toHaveLength(1);
  expect(view.state).toBeNull();
  expect(view.map.playerCount).toBe(4);
  expect(JSON.stringify(view)).not.toContain((await games(db).doc(id).get()).get('seed'));
});
it('rejects bad player counts', async () => {
  await expect(createGame(db, alice, { playerCount: 1, turnMinutes: 60 })).rejects.toThrow(HttpError);
});
it('lists my games', async () => {
  const id = await createGame(db, alice, { playerCount: 4, turnMinutes: 60 });
  expect((await listGames(db, alice)).map((g) => g.id)).toContain(id);
  expect(await listGames(db, bob)).toEqual([]);
});
```

(`alice`/`bob` are literal `AuthedUser` objects in the test file.)

- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `pnpm test:server` → PASS. **Step 5: Commit** `feat(server): game creation and redacted aggregate views`

---

### Task 5: Join, auto-start, start-with-bots

**Files:** Modify `packages/server/src/games.ts`; extend `games.test.ts`.

**Interfaces produced:**

```ts
export async function joinGame(db, gameId: string, user: AuthedUser): Promise<GameView>
export async function startGame(db, gameId: string, user: AuthedUser): Promise<GameView>  // creator only
```

Both run in `db.runTransaction`. Join: 409 if already seated/full/not lobby; fills lowest empty seat; adds gameId to user doc. Activation (shared helper `activate(doc, now)`): `status: 'active'`, `stateJson: serializeState(createInitialState(parseMap(doc), doc.rules))`, `deadlineAt = now + turnMinutes`. Join auto-activates when the last seat fills. Start: 403 unless creator, 409 unless lobby; empty seats become `{ uid: null, name: BOT_NAMES[slot], email: null, isBot: true }` (`BOT_NAMES`: 'General Ash', 'Marshal Brook', 'Warlord Cole', … 12 names, index by slot).

- [ ] **Step 1: failing tests**

```ts
it('auto-starts when the last seat fills', async () => {
  const id = await createGame(db, alice, { playerCount: 2, turnMinutes: 60 });
  const view = await joinGame(db, id, bob);
  expect(view.status).toBe('active');
  expect(view.state).not.toBeNull();
  expect(view.deadlineAt).not.toBeNull();
});
it('rejects joining twice', async () => {
  const id = await createGame(db, alice, { playerCount: 3, turnMinutes: 60 });
  await expect(joinGame(db, id, alice)).rejects.toMatchObject({ statusCode: 409 });
});
it('creator starts early; empty seats become bots', async () => {
  const id = await createGame(db, alice, { playerCount: 4, turnMinutes: 60 });
  await joinGame(db, id, bob);
  const view = await startGame(db, id, alice);
  expect(view.status).toBe('active');
  expect(view.seats.filter((s) => s.isBot)).toHaveLength(2);
});
it('only the creator starts', async () => {
  const id = await createGame(db, alice, { playerCount: 4, turnMinutes: 60 });
  await joinGame(db, id, bob);
  await expect(startGame(db, id, bob)).rejects.toMatchObject({ statusCode: 403 });
});
```

- [ ] **Steps 2-5:** fail → implement → PASS → commit `feat(server): join, auto-start and start-with-bots`

---

### Task 6: Turn resolution (transactional core)

**Files:** Create `packages/server/src/resolve.ts`, `packages/server/src/resolve.test.ts`.

**Interfaces produced:**

```ts
export interface ResolutionOutcome { resolved: boolean; report: TurnReport | null; finished: boolean; }
/** Resolve `expectedTurn` if the game is still on it; no-op { resolved: false } otherwise. */
export async function resolveGameTurn(db, mailer: Mailer, baseUrl: string, gameId: string, expectedTurn: number): Promise<ResolutionOutcome>
```

Inside one transaction: read game doc (abort no-op if `status !== 'active'` or `turn !== expectedTurn`); `getAll` the turn's order docs for human seats; build `submissions[slot]`: human → `JSON.parse(ordersJson)` or `null`; bot → `decideOrders(redact(state, slot), map, slot, substream(seed, 'bot', turn, slot), personality(slot))` with personalities built exactly as `packages/engine/src/simulate.ts:83-85`; eliminated/empty seat → `null`. Call `resolveTurn(state, submissions, { seed, map, rules })`. Write: `stateJson = serializeState(next)`, `turn = next.turn`, `deadlineAt = now + turnMinutes` (or `null` + `status:'finished'` when `report.result`), report doc at `reports/{expectedTurn}` storing `canonicalJson(report)`. After commit: email every human seat `[WWW] Turn ${expectedTurn} resolved — ${report.headline}` with link `${baseUrl}/g/${gameId}` (finished games get `[WWW] Game over — ${report.result.detail ?? kind}`).

- [ ] **Step 1: failing tests**

```ts
async function activeGame(playerCount: number): Promise<string> {
  const id = await createGame(db, alice, { playerCount, turnMinutes: 60 });
  return (await startGame(db, id, alice)), id;   // alice + bots
}
it('resolves a turn and advances state', async () => {
  const id = await activeGame(4);
  const out = await resolveGameTurn(db, mailer, 'http://x', id, 1);
  expect(out.resolved).toBe(true);
  expect(out.report!.turn).toBe(1);
  expect((await getView(db, id, alice)).turn).toBe(2);
  expect(mailer.sent.some((m) => m.subject.includes('Turn 1 resolved'))).toBe(true);
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
  expect((await getView(db, id, alice)).result).not.toBeNull();
}, 120_000);
```

(Test 3 works because `alice` submits nothing — engine treats null as empty orders — and the turn cap guarantees a result; expect it to finish well before turn 40.)

- [ ] **Steps 2-5:** fail → implement → PASS → commit `feat(server): transactional turn resolution with bot seats and result emails`

---

### Task 7: Order submission and early resolve

**Files:** Modify `packages/server/src/games.ts`; extend `games.test.ts`.

**Interfaces produced:**

```ts
export async function submitOrders(db, mailer, baseUrl, gameId: string, user: AuthedUser, req: SubmitOrdersRequest): Promise<SubmitOrdersResponse>
```

Transaction: 409 unless active; 403 unless seated and slot active in state; force `req.orders.slot = mySlot`; collect warnings via `normalizeOrders(state, map, mySlot, req.orders, events)` then `events.filter(e => e.kind === 'order_rejected').map(e => e.reason)` — warnings never block; write order doc `{ ordersJson: JSON.stringify(req.orders), locked, updatedAt }`. After commit, if `locked`: read all live human slots' order docs; if every one is locked, call `resolveGameTurn(db, mailer, baseUrl, gameId, turn)`. Return `{ warnings, resolved, view: await getView(...) }`.

- [ ] **Step 1: failing tests**

```ts
it('stores draft orders and reports warnings without blocking', async () => {
  const id = await createGame(db, alice, { playerCount: 2, turnMinutes: 60 });
  await joinGame(db, id, bob);
  const bad = { slot: 0, pledge: null, deploys: [{ to: 9999, count: 1 }], units: [] };
  const res = await submitOrders(db, mailer, 'http://x', id, alice, { orders: bad, locked: false });
  expect(res.warnings.length).toBeGreaterThan(0);
  expect(res.resolved).toBe(false);
  expect(res.view.myOrders).toEqual(bad);
});
it('resolves early when the last human locks', async () => {
  const id = await createGame(db, alice, { playerCount: 2, turnMinutes: 60 });
  await joinGame(db, id, bob);
  const a = await submitOrders(db, mailer, 'http://x', id, alice, { orders: { slot: 0, pledge: null, deploys: [], units: [] }, locked: true });
  expect(a.resolved).toBe(false);
  const b = await submitOrders(db, mailer, 'http://x', id, bob, { orders: { slot: 1, pledge: null, deploys: [], units: [] }, locked: true });
  expect(b.resolved).toBe(true);
  expect(b.view.turn).toBe(2);
  expect(b.view.latestReport!.turn).toBe(1);
});
it('rejects orders from non-players', async () => {
  const id = await createGame(db, alice, { playerCount: 2, turnMinutes: 60 });
  await joinGame(db, id, bob);
  const carol = { uid: 'u3', name: 'Carol', email: null };
  await expect(submitOrders(db, mailer, 'http://x', id, carol, { orders: { slot: 0, pledge: null, deploys: [], units: [] }, locked: false }))
    .rejects.toMatchObject({ statusCode: 403 });
});
```

- [ ] **Steps 2-5:** fail → implement → PASS → commit `feat(server): order submission with warnings and early resolution`

---

### Task 8: Tick

**Files:** Create `packages/server/src/tick.ts`, `packages/server/src/tick.test.ts`.

**Interfaces produced:**

```ts
export interface TickResult { resolvedGames: string[]; remindedGames: string[]; errors: string[]; }
export async function runTick(db, mailer, baseUrl, now: Date): Promise<TickResult>
```

Fetch ALL `status == 'active'` games (playtest scale; no composite indexes). Per game, in try/catch (one bad game never blocks the sweep): past `deadlineAt` → `resolveGameTurn(db, mailer, baseUrl, id, doc.turn)`; else if remaining ≤ 25% of `turnMinutes` AND `remindedTurn < turn` AND some live human slot lacks a locked order doc → email exactly those unlocked humans `[WWW] Orders due soon` + link, then set `remindedTurn = turn`.

- [ ] **Step 1: failing tests** — three: past-deadline game resolves (create 2p game with both humans, manually set `deadlineAt` to the past via `games(db).doc(id).update(...)`, run tick with `now = new Date()`, expect turn 2); reminder goes only to unlocked humans and only once (set `deadlineAt` to now+10min on a 60-min game, lock alice's orders, run tick twice → exactly one mail, addressed to bob's email); far-from-deadline game untouched. Use emulator-auth users with emails (`bob.email = 'bob@test.dev'` literal objects).
- [ ] **Steps 2-5:** fail → implement → PASS → commit `feat(server): scheduler tick with deadline resolution and reminders`

---

### Task 9: Auth verifiers

**Files:** Create `packages/server/src/auth.ts`, `packages/server/src/auth.test.ts`; extend `testing.ts`.

**Interfaces produced:**

```ts
export interface Verifiers {
  verifyUser(authorizationHeader: string | undefined): Promise<AuthedUser>;  // throws HttpError(401)
  verifyTick(authorizationHeader: string | undefined): Promise<void>;        // throws HttpError(401/403)
}
export function realVerifiers(opts: { tickAudience: string; tickServiceAccount: string }): Verifiers
```

`verifyUser`: strip `Bearer `, `getAuth().verifyIdToken(token)` → `{ uid, name: decoded.name ?? decoded.email ?? 'Player', email: decoded.email ?? null }`. Works against the Auth emulator automatically when `FIREBASE_AUTH_EMULATOR_HOST` is set. `verifyTick`: `new OAuth2Client().verifyIdToken({ idToken, audience: tickAudience })`, require `payload.email === tickServiceAccount && payload.email_verified`.

`testing.ts` gains:

```ts
export async function emulatorToken(email: string, name: string): Promise<string> {
  const res = await fetch('http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password1', displayName: name, returnSecureToken: true }),
  });
  return ((await res.json()) as { idToken: string }).idToken;
}
export const stubVerifiers = (users: Record<string, AuthedUser>): Verifiers  // token = key lookup; tick accepts 'tick-ok'
```

- [ ] **Step 1: failing tests** (guarded by `FIREBASE_AUTH_EMULATOR_HOST`): valid emulator token → AuthedUser with right email; garbage/missing header → HttpError 401.
- [ ] **Steps 2-5:** fail → implement → PASS → commit `feat(server): firebase user auth and OIDC tick verification`

---

### Task 10: HTTP app and routes

**Files:** Create `packages/server/src/app.ts`, `packages/server/src/app.test.ts`.

**Interfaces produced:**

```ts
export interface AppDeps { db: Firestore; mailer: Mailer; verifiers: Verifiers; baseUrl: string; }
export function buildApp(deps: AppDeps): FastifyInstance
```

Routes exactly as specced: `POST /api/games`, `GET /api/games`, `POST /api/games/:id/join`, `POST /api/games/:id/start`, `GET /api/games/:id`, `PUT /api/games/:id/orders`, `GET /api/games/:id/reports/:turn`, `POST /internal/tick`, `GET /healthz`. A preHandler on `/api/*` sets `req.user = await verifiers.verifyUser(req.headers.authorization)`; `/internal/tick` uses `verifyTick`. Error handler maps `HttpError` → its status + `{ error: message }`, everything else → 500 (logged). Reports route reads `reports/{turn}` (404 when absent).

- [ ] **Step 1: failing test** — full-lifecycle inject test with `stubVerifiers` + emulator Firestore:

```ts
const app = buildApp({ db, mailer, verifiers: stubVerifiers({ 'tok-a': alice, 'tok-b': bob }), baseUrl: 'http://x' });
const H = (t: string) => ({ authorization: `Bearer ${t}` });
it('plays a full lifecycle over HTTP', async () => {
  const create = await app.inject({ method: 'POST', url: '/api/games', headers: H('tok-a'), payload: { playerCount: 2, turnMinutes: 60 } });
  expect(create.statusCode).toBe(200);
  const { id } = create.json();
  await app.inject({ method: 'POST', url: `/api/games/${id}/join`, headers: H('tok-b') });
  const lockA = await app.inject({ method: 'PUT', url: `/api/games/${id}/orders`, headers: H('tok-a'), payload: { orders: { slot: 0, pledge: 1, deploys: [], units: [] }, locked: true } });
  expect(lockA.json().resolved).toBe(false);
  const lockB = await app.inject({ method: 'PUT', url: `/api/games/${id}/orders`, headers: H('tok-b'), payload: { orders: { slot: 1, pledge: 0, deploys: [], units: [] }, locked: true } });
  expect(lockB.json().resolved).toBe(true);
  const report = await app.inject({ method: 'GET', url: `/api/games/${id}/reports/1`, headers: H('tok-a') });
  expect(report.json().pacts.length).toBeGreaterThan(0);   // mutual pledge → concord recorded
  expect(report.body).not.toContain('seed');
});
it('rejects unauthenticated requests', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/games' })).statusCode).toBe(401);
});
it('guards the tick route', async () => {
  expect((await app.inject({ method: 'POST', url: '/internal/tick' })).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url: '/internal/tick', headers: H('tick-ok') })).statusCode).toBe(200);
});
```

- [ ] **Steps 2-5:** fail → implement → PASS → commit `feat(server): fastify app wiring all routes`

---

### Task 11: Entrypoint, dev script, CI

**Files:** Create `packages/server/src/main.ts`; Modify root `package.json`, `.github/workflows/ci.yml`.

- [ ] **Step 1: main.ts** — read env (`PORT` default 8080, `GCP_PROJECT` default `demo-www`, `BASE_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `TICK_AUDIENCE`, `TICK_SERVICE_ACCOUNT`); `RESEND_API_KEY` present → `resendMailer`, else `LogMailer`; `realVerifiers`; `buildApp(...).listen({ port, host: '0.0.0.0' })`. No test (integration-covered); just `pnpm build` + boot it once locally under emulators and hit `/healthz`.
- [ ] **Step 2: dev script** — root package.json: `"dev:server": "firebase emulators:exec --only firestore,auth --project demo-www \"tsx watch packages/server/src/main.ts\""`.
- [ ] **Step 3: CI** — in `.github/workflows/ci.yml` `check` job, after `pnpm test`, add:

```yaml
      - run: pnpm build
      - name: Server integration tests
        run: pnpm exec firebase emulators:exec --only firestore,auth --project demo-www "pnpm exec vitest run packages/server"
```

and add `firebase-tools` to root devDependencies (pinned major 15). Ubuntu runners ship Java, which the Firestore emulator needs.

- [ ] **Step 4:** full local gate: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:server` → all green.
- [ ] **Step 5: Commit** `feat(server): production entrypoint, dev loop and CI integration`

---

## Self-review notes

- Spec coverage: data model (T3), create/view/list (T4), join/auto-start/bots (T5), resolution+race+emails (T6), orders/warnings/early-resolve (T7), tick+reminders (T8), auth both kinds (T9), routes/DTO/no-secret-leak (T10), dev loop + CI (T11). Deployment and web are plans 2 and 3.
- `submitOrders` returning the fresh report inline is covered by T7's second test (`view.latestReport.turn === 1`).
- Type names used across tasks: `AuthedUser` (T4→T9/T10), `HttpError` (T4→T9/T10), `Mailer`/`LogMailer` (T2→T6/T7/T8), `serializeState`/`parseState`/`parseMap` (T3→T4/T5/T6) — consistent.
