# Game Server & Web Client — Design

**Date:** 2026-08-11
**Status:** Approved for planning

## Goal

Make World Wide War playable end-to-end by real people in a browser: create a game, invite
friends, submit secret orders, and watch turns resolve on a deadline (or early, when everyone
locks in). First deployable milestone — the thing the eventual Cloud Build pipeline ships.

## Decisions (settled during brainstorming)

| Question    | Decision                                                          |
| ----------- | ----------------------------------------------------------------- |
| Milestone   | API server + minimal web UI, playable end-to-end                  |
| Hosting     | Cloud Run (API) + Firebase Hosting (static client)                |
| Persistence | Firestore, accessed only by the server via Admin SDK              |
| Auth        | Firebase Auth, Google sign-in                                     |
| Frontend    | React 19 + Vite, no state/component libraries, hand-rolled SVG    |
| Email       | In v1: turn-resolved and deadline-approaching notices, via Resend |
| CI/CD       | GitHub Actions keeps CI; Cloud Build deploys on push to `main`    |

Rejected: serving the client from Cloud Run (cold starts hurt first paint); Firebase-native
client-reads-Firestore architecture (security rules cannot express per-player redaction of
hidden orders and fogged armies — the engine's `redact()` assumes a trusted server).

## Architecture

```
Browser (React, Firebase Auth SDK)
   │  static assets from Firebase Hosting CDN
   │  /api/** rewritten by Hosting to Cloud Run  → no CORS
   ▼
Cloud Run: packages/server (Fastify, firebase-admin)
   │  verifies ID tokens, wraps @www/engine, redacts all reads
   ▼
Firestore (games, orders, reports, users)

Cloud Scheduler ── every minute, OIDC ──► POST /internal/tick
Resend ◄── turn-resolved + reminder emails
```

The client never runs engine logic in v1; it renders the server's redacted view. The server
imports `@www/engine` directly; the web package imports engine types and the server's DTO
types (`packages/server/src/api-types.ts`) through workspace references.

## Repo layout

```
packages/engine/   (existing) pure rules
packages/server/   Fastify API — deps: fastify, firebase-admin, resend
packages/web/      React + Vite client — deps: react, react-router, firebase (auth only)
```

## Firestore data model

```
games/{gameId}
  status: 'lobby' | 'active' | 'finished'
  createdBy, createdAt
  playerCount: number
  seats: { [slot]: { uid, name, email } | null }   // bot seats marked distinctly
  turn: number                  // mirrors state.turn, for queries
  deadlineAt: Timestamp
  turnMinutes: number
  remindedTurn: number          // last turn a reminder email was sent
  seed: string                  // drives combat RNG; never leaves the server
  rules: RuleConfig
  stateJson: string             // current GameState, canonicalJson
  mapJson: string               // GeneratedMap

games/{gameId}/orders/{turn}-{slot}
  ordersJson: string            // OrderSet
  locked: boolean               // all live humans locked ⇒ resolve early
  updatedAt

games/{gameId}/reports/{turn}   // TurnReport JSON

users/{uid}                     // displayName, email, gameIds: string[]
```

- **JSON strings, not native fields**, for state and map: Firestore forbids nested arrays and
  the map's polygon coordinates are nested arrays. Queryable bits (`turn`, `status`,
  `deadlineAt`) are mirrored top-level. Everything under 1 MB per doc at max table size.
- **Resolution is transactional and idempotent.** Two paths race to resolve (tick vs. last
  lock-in). Resolution runs in a Firestore transaction that re-reads the game doc and aborts
  if `turn` already advanced. `resolveTurn` is pure and deterministic, so retries are harmless.
- Orders and reports are kept forever; with the seed they make every turn re-derivable.

## API

All `/api` routes require a Firebase ID token (verified per request). The tick requires an
OIDC token for the scheduler's service account. `seed` and other players' orders never appear
in any response.

```
POST   /api/games                    { playerCount, turnMinutes } → lobby; creator seat 0;
                                     map + seed generated at creation
GET    /api/games                    my games (status, turn, deadline, orders-pending badge)
POST   /api/games/:id/join           claim next open seat; auto-start when last seat fills
POST   /api/games/:id/start          creator only: start now, empty seats become bots
GET    /api/games/:id                aggregate game view (the client's single polling target)
PUT    /api/games/:id/orders         upsert my draft { orders, locked }
GET    /api/games/:id/reports/:turn  past TurnReport
POST   /internal/tick                scheduler only
GET    /healthz
```

**Game view DTO:** `{ id, status, seats (names + pact records, no emails), turn, deadlineAt,
map, state: redact(state, mySlot), myOrders, lockedSlots, latestReport, result }`.

**Order submission** runs `normalizeOrders` immediately and returns rejection reasons as
warnings but stores the raw order set; the authoritative normalize happens at resolution.
If a submission with `locked: true` completes the set of live human locks, resolution runs
inline and the response carries the fresh report.

**Bot seats** get orders from the engine's `decideOrders` at resolution time.

**Tick, every minute:** (1) active games past `deadlineAt` → resolve (missing orders = null);
(2) games with ≤ 25% of `turnMinutes` remaining, unlocked humans, and `remindedTurn < turn`
→ reminder email to the unlocked players only.
Per-game try/catch so one bad game cannot block the tick. Turn-resolved emails go to all
human seats with a link.

## Frontend

Screens: **Home** (sign-in, game list with due badges, create form), **Lobby** (seats, invite
via URL — any signed-in visitor to `/g/:id` can claim a seat, start-with-bots for creator),
**Game** (SVG map + orders panel + latest report), **Report history**.

- Map: territory polygons from map JSON; fill = owner color; army label (`?` when fogged);
  click-source-then-target move entry; deploys by clicking own territories; pledge picker.
- Locking is public (`lockedSlots`); order contents are not.
- `useGame(id)` hook: poll aggregate endpoint every 15 s, immediately on tab focus, paused
  when hidden, 5 s after the player locks. Order edits are optimistic with background PUT;
  server warnings surface inline.
- Betrayals styled loudly in reports — they are the emotional peak.

## Deployment

- **One GCP project**, Firebase-enabled (Auth, Hosting, Firestore) + Cloud Run, Scheduler,
  Artifact Registry, Secret Manager.
- **`cloudbuild.yaml`** on push to `main`: workspace install/build → docker build server →
  deploy Cloud Run → vite build web → `firebase deploy --only hosting`.
- Cloud Run: min 0, **max 1 instance in v1** (correctness still guarded by transactions).
- Secrets: Resend key in Secret Manager, injected as env var.
- **Local dev:** Firebase emulators (Auth + Firestore) + `tsx watch` server + Vite dev proxy,
  orchestrated by one `pnpm dev`. Tick triggered by hand via curl in dev.

## Testing

- Server: vitest route tests via Fastify `inject` against the **Firestore emulator** — real
  transactions, no mocks. Covers the full lifecycle and the resolution race (exactly one
  resolution when tick and last lock-in collide). Joins the existing `pnpm test` suite and CI.
- Email behind a `Mailer` interface: Resend impl in prod, logging impl in dev/test.
- Web: typecheck + `useGame` hook test. No E2E in v1.

## Error handling

Engine-rejected orders degrade to warnings, never HTTP errors (matches engine philosophy).
HTTP errors are for real problems: unauthenticated, not your seat, game not active, seat
already taken. Tick failures are logged per game and skipped.

## Out of scope for v1

Matchmaking/public games, spectators, client-side order preview via engine, E2E tests,
push/web notifications, account pages, multiple environments (single prod project).
