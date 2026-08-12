# Web Client Implementation Plan (2 of 3: server, web, deploy)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packages/web` — a lean React 19 + Vite client: Google sign-in, game list/create, lobby, SVG map with order entry, pact pledge, lock-in, turn reports. Playable end-to-end against the local server + emulators.

**Architecture:** Static SPA. Firebase JS SDK for auth only (emulator-aware); every server interaction goes through a typed `api.ts` fetch wrapper attaching the ID token; one `useGame` polling hook drives the game screen. No state or component libraries. Spec: `docs/superpowers/specs/2026-08-11-game-server-design.md`.

**Tech Stack:** React 19, react-router 7, Vite 7, firebase (auth), vitest + @testing-library/react for the hook test.

## Global Constraints

- Dependencies limited to: `react`, `react-dom`, `react-router`, `firebase`. Dev: `@vitejs/plugin-react`, `@testing-library/react`, `jsdom`, `@types/react`, `@types/react-dom`.
- All server types imported from `@www/server/src/api-types.js` and `@www/engine` (types only — enforce with `import type`).
- The client never computes rules. It renders `GameView` and posts `OrderSet`s.
- Optimistic order edits: local state updates instantly, PUT in background, warnings surfaced inline.
- `VITE_USE_EMULATORS=1` in dev connects auth to `http://localhost:9099`; Vite proxies `/api` → `http://localhost:3001`.
- Army counts of `-1` (HIDDEN_ARMIES) render as `?`.
- Betrayals in reports styled loudly (red, bold) — they are the emotional peak.
- Commit after every task; `pnpm typecheck && pnpm lint && pnpm format:check` green before each commit.

## File structure

```
packages/web/
  package.json  tsconfig.json  vite.config.ts  index.html
  src/
    main.tsx           router + auth provider bootstrap
    auth.tsx           Firebase auth init, useAuth(), <RequireAuth>, sign-in screen
    api.ts             typed fetch wrapper: get/post/put with ID token + HttpError
    useGame.ts         polling hook: 15s idle / 5s locked / refetch on focus / pause hidden
    format.ts          deadline countdown ("2d 4h", "37m"), army display
    App.tsx            shell: header (user, sign-out), <Outlet>
    pages/Home.tsx     game list + create form
    pages/Lobby.tsx    seats, invite hint, start-with-bots
    pages/Game.tsx     layout: map + side panel (orders or lobby or report)
    game/MapView.tsx   SVG polygons, selection, owner colors, army labels
    game/OrdersPanel.tsx  deploys/moves/pledge editor + lock button + locked slots
    game/ReportView.tsx   turn report rendering (pacts loud, battles, events)
    styles.css         single stylesheet, dark theme, CSS variables per player color
  src/useGame.test.ts  hook test with mocked api + fake timers
```

## Player colors

`PLAYER_COLORS` (12, index = slot): `#e6553a #4da6ff #66cc66 #e6c84d #b980ff #ff9e4d #4dd2c4 #ff80b3 #a3e64d #7f8cff #d9a066 #66e0ff`. Neutral territory `#8a8578`, collapsed `#2b2b33`.

---

### Task 1: Scaffold packages/web

**Files:** Create `packages/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx` (placeholder rendering "WWW"), `src/styles.css` (reset + dark shell). Modify root `tsconfig.json` (reference), root `package.json` (`dev:web` script), `.github/workflows/ci.yml` if needed (typecheck covers web via root build).

Key configs:

```jsonc
// package.json (deps pinned by pnpm at install time)
{
  "name": "@www/web", "private": true, "type": "module", "version": "0.0.0",
  "scripts": { "dev": "vite", "build": "tsc --build && vite build", "typecheck": "tsc --build --force" },
  "dependencies": { "firebase": "^12", "react": "^19", "react-dom": "^19", "react-router": "^7" },
  "devDependencies": { "@testing-library/react": "^16", "@types/react": "^19", "@types/react-dom": "^19", "@vitejs/plugin-react": "^5", "@www/server": "workspace:*", "jsdom": "^27" }
}
```

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3001' } },
});
```

tsconfig: extends base but overrides for the DOM app: `"jsx": "react-jsx", "lib": ["ES2023", "DOM", "DOM.Iterable"], "noEmit": true` (Vite builds; tsc typechecks only — drop rootDir/outDir, no composite emit needed; if `tsc --build` requires emit for the reference from root, use `"emitDeclarationOnly": false` + keep it OUT of root references and typecheck via its own script wired into root `typecheck`). Resolve during implementation; the constraint is: root `pnpm typecheck` must fail on web type errors.

Root script: `"dev:web": "pnpm --filter @www/web dev"`.

- [ ] Scaffold, `pnpm install`, `pnpm dev:web` serves the placeholder, typecheck green, commit `feat(web): scaffold react+vite client`.

### Task 2: Auth (emulator-aware) and API wrapper

**Files:** Create `src/auth.tsx`, `src/api.ts`. Modify `src/main.tsx`.

- `auth.tsx`: `initializeApp` from `VITE_FIREBASE_*` env (apiKey, authDomain, projectId — all optional strings; emulator mode uses `{ apiKey: 'fake', projectId: 'demo-www', authDomain: 'localhost' }`); `connectAuthEmulator(auth, 'http://localhost:9099')` when `VITE_USE_EMULATORS`; `useAuth()` context exposing `{ user, signIn, signOut }` where `signIn` = `signInWithPopup(new GoogleAuthProvider())`; `<RequireAuth>` renders a centered sign-in card when logged out.
- `api.ts`: `apiFetch<T>(method, path, body?)` — gets `auth.currentUser.getIdToken()`, sets headers, throws `ApiError extends Error { status, message }` on non-2xx (parsing `{ error }`), returns parsed JSON. Convenience: `api.createGame(req): Promise<{id: string}>`, `api.listGames()`, `api.getGame(id)`, `api.join(id)`, `api.start(id)`, `api.submitOrders(id, req)`, `api.getReport(id, turn)` — all typed with DTOs from `@www/server`.
- [ ] Verify by running dev:server + dev:web, signing in via the emulator popup (emulator auth UI allows creating a fake Google account), watching `/api/games` return `[]` in the network tab. Commit `feat(web): firebase auth and typed api client`.

### Task 3: useGame hook (TDD)

**Files:** Create `src/useGame.ts`, `src/useGame.test.ts`.

Hook contract:

```ts
export interface UseGame {
  view: GameView | null; error: string | null;
  refresh(): Promise<void>;
  saveOrders(orders: OrderSet, locked: boolean): Promise<string[]>; // returns warnings; optimistic: sets view.myOrders immediately
}
export function useGame(id: string): UseGame
```

Implementation: `useEffect` interval — 15_000ms default, 5_000ms when `view.myLocked && view.status === 'active'`; cleared when `document.hidden` (listen to `visibilitychange`, refetch immediately on visible); `saveOrders` PUTs, on success replaces `view` with `res.view` and returns `res.warnings`.

Test (vitest + jsdom + fake timers): mock `./api.js` with `vi.mock`; assert (1) mounts → one fetch; (2) advances 15s → second fetch; (3) after saveOrders with locked resolve response, interval tightens to 5s; (4) hidden tab pauses polling.

- [ ] Red → green → commit `feat(web): useGame polling hook`.

### Task 4: Home + Lobby pages

**Files:** Create `src/App.tsx`, `src/pages/Home.tsx`, `src/pages/Lobby.tsx`; wire routes in `main.tsx` (`/` Home, `/g/:id` Game-or-Lobby switch). Game page placeholder for now.

- Home: `api.listGames()` on mount; cards showing status, turn, deadline countdown (`format.ts`: `formatRemaining(iso): string`), "orders due" badge when active && !myLocked; create form (player count 2-12 select, turn length select: 30m/1h/4h/24h/48h) → `api.createGame` → navigate to `/g/:id`.
- Lobby (rendered by Game route when `view.status === 'lobby'`): seat list with names/bot markers, "share this page's URL to invite", Join button when the viewer isn't seated (deep-linked friend), Start-now-with-bots button when viewer is creator (seat 0 uid check via mySlot === 0 fallback: show whenever seats unfilled and mySlot !== null).
- [ ] Manual verify both flows against dev servers; commit `feat(web): home and lobby screens`.

### Task 5: Map, orders, reports — the Game screen

**Files:** Create `src/pages/Game.tsx`, `src/game/MapView.tsx`, `src/game/OrdersPanel.tsx`, `src/game/ReportView.tsx`, `src/format.ts`.

- **MapView**: `<svg viewBox>` from map radius; polygon per territory (`points` from `territory.polygon`), fill by `state.owner[id]` → `PLAYER_COLORS`, neutral/collapsed fills; stroke highlights: selected source (white, 3px), eligible targets (dashed white) using `map.adjacency[selected]`; army label `<text>` (`?` when -1); capital marker (star glyph) where `state.capital.includes(id)`; storm-warned territories (from `map.collapseWaves` + current turn vs `rules.stormStartTurn` — if not derivable from view, skip storm preview in v1) — skip: render collapsed only.
- Interaction model in Game.tsx state: `phase: 'idle' | 'source' | 'target'`; click own territory → source; click adjacent → prompt count (number input in panel, default all-but-one) → append MOVE to draft `units`; deploy mode: click own territory with deploy pool remaining → +1 per click (right-click or ⌫ chip to remove); draft mirrors `OrderSet`.
- **OrdersPanel**: income/deploys-remaining counter, list of draft deploys/moves as removable chips, pledge selector (portrait row of other living players, click to toggle; shows their `pactsHonored`/`pactsBetrayed` from state arrays), Save (auto via debounce 800ms after edits) + **Lock in** button → `saveOrders(draft, true)`; warnings list under panel; locked slots shown as badge row; countdown to deadline.
- **ReportView**: headline; pact results grouped (concord green, betrayal red bold "X BETRAYED Y", spurned/courted muted); battles: territory name, sides, dice; world events; result banner when `view.result` (winners, kind, standings) with "Game over" styling.
- Game.tsx composes: `useGame(id)`; lobby → Lobby; active → Map + OrdersPanel + collapsible latest ReportView; finished → Map + ReportView + standings.
- [ ] Manual verify: create 2p game in two browser profiles (or normal+incognito), play 2-3 turns including a mutual pledge and a betrayal, watch early resolve fire when both lock. Commit `feat(web): playable game screen with svg map, orders and reports`.

### Task 6: Polish pass and full gate

- [ ] Countdown ticking (1s interval in a `useNow()` hook used by panel + home badges).
- [ ] Empty/edge states: dead player (state.status[mySlot] !== 'active' → spectate banner), error toasts on ApiError, loading spinners.
- [ ] `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm test:server` all green.
- [ ] Commit `feat(web): polish, countdowns and edge states`.

## Self-review notes

- Spec coverage: 4 screens ✓, polling cadence ✓, optimistic edits ✓, no engine logic client-side ✓ (colors/countdowns are presentation, not rules), fog `?` ✓, betrayal styling ✓, lock publicity ✓.
- Deliberate deviation from spec: report history page folded into ReportView + `api.getReport` (accessible from Game screen turn selector) rather than a separate route — less chrome, same capability. Storm preview omitted in v1.
- Types: `GameView.state.armies` uses `HIDDEN_ARMIES = -1` from engine — import the constant, don't hardcode.
