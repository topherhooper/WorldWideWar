# Tiers Contest & Configurable Turn Cap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Tiers" — a legibility-based second contest (write a secret A–F tier list each turn; rivals score by guessing your ordering) — plus a configurable per-game turn cap, per the approved spec `docs/superpowers/specs/2026-08-11-tiers-contest-design.md`.

**Architecture:** The engine gains a second contest resolved in `resolveTurn` Phase 4, dispatched on a new `rules.contest` field. Tier lists live in `GameState.tiersLists` (author ordering redacted for rivals), pipelined one turn: written with turn N orders, published shuffled in the turn-N report, guessed with turn N+1 orders, revealed and scored at turn N+1 resolution. The lobby collects each player's first list ("turn 0") so turn 1 already scores. The server adds creation options (`contest`, `turnCap`), a lobby-list endpoint, and activation gating; the web adds a list editor, guess panel, and report section.

**Tech Stack:** TypeScript ESM monorepo (pnpm), Vitest, Fastify + Firestore (server, tested against the emulator), React 19 + react-router (web).

## Global Constraints

- Resolution must stay a pure function of `(state, orders, seed)` — no `Math.random`, no clock. All randomness via `substream(seed, ...)` (`packages/engine/src/rng.ts`).
- Invalid input never throws inside resolution; it degrades silently (Pact's normalization pattern).
- `redact()` (`packages/engine/src/redact.ts`) is the only path game state takes to a client. Rival tier-list _orderings_ must never survive it, fog or no fog.
- Multiplier space is ×100 integers; Tiers multipliers clamp to [80, 140]. Guess scoring: exact = 2, adjacent = 1, max 12/guess; guess contributes `(score − 6) × 2`; author gains `max(0, best − 6)`.
- Turn cap: creation range [10, 50], default 25. `rulesFor(playerCount)` with no cap argument must return exactly today's values (existing tests and stored games depend on it).
- Backwards compatibility: stored `GameDoc`s lack `rules.contest`; stored states lack `tiersLists`; stored reports lack `tiers`/`revealedTopic`. Every reader must tolerate that (`?? 'pact'`, hydration in `parseState`, `?? []` in web).
- Tier lists: exactly 6 entries, each trimmed non-empty ≤ 60 chars, pairwise distinct after normalization (lowercase, strip all non-alphanumerics). Guesses: ≤ 2, distinct living targets with a published list, order a permutation of 0–5.
- Run engine tests with `pnpm exec vitest run <file>`; server tests with `pnpm test:server`; types with `pnpm typecheck`; lint with `pnpm lint`.

## File Structure

| File                                                                                                                                                                       | Role                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine/src/types.ts`                                                                                                                                             | + `ContestKind`, `TiersGuess`, `TiersOrders`, `TiersList`, `TiersGuessResult`, `TiersResult`; `OrderSet.tiers?`, `GameState.tiersLists`, `RuleConfig.contest`, `TurnReport.tiers`/`revealedTopic` |
| `packages/engine/src/constants.ts`                                                                                                                                         | + `MIN_TURN_CAP`/`MAX_TURN_CAP`, `DEFAULT_RULES.contest`, cap-aware `rulesFor`                                                                                                                    |
| `packages/engine/src/contest/topics.ts` (new)                                                                                                                              | Topic bank (40 topics × 8 canned items, popularity order) + `topicForTurn`                                                                                                                        |
| `packages/engine/src/contest/tiers.ts` (new)                                                                                                                               | Normalization, scoring, `resolveTiers`, `applyTiersRecord`, `makeTiersList`, `tiersWarnings`, bot helpers `decideTiersList`/`decideTiersOrders`                                                   |
| `packages/engine/src/setup.ts`, `redact.ts`, `victory.ts`, `orders.ts`, `resolve.ts`, `simulate.ts`, `testing.ts`, `index.ts`                                              | Plumbing: state field, redaction, elimination cleanup, order carry-through, Phase-4 dispatch, bot games, exports                                                                                  |
| `packages/server/src/api-types.ts`, `store.ts`, `games.ts`, `resolve.ts`, `app.ts`                                                                                         | Creation options, view fields, lobby-list endpoint + activation gating, bot tiers orders, warnings                                                                                                |
| `packages/web/src/api.ts`, `pages/Home.tsx`, `pages/Lobby.tsx`, `pages/Game.tsx`, `game/OrdersPanel.tsx`, `game/TiersPanel.tsx` (new), `game/ReportView.tsx`, `styles.css` | Creation form, lobby list editor, write/guess panel, report reveals                                                                                                                               |

Tests: `packages/engine/src/constants.test.ts` (new), `packages/engine/src/contest/topics.test.ts` (new), `packages/engine/src/contest/tiers.test.ts` (new), `packages/engine/src/simulate-tiers.test.ts` (new), `packages/server/src/tiers.test.ts` (new).

---

### Task 1: Contest kind + turn-cap-aware rules

**Files:**

- Modify: `packages/engine/src/types.ts` (RuleConfig, ~line 262)
- Modify: `packages/engine/src/constants.ts` (DEFAULT_RULES ~line 63, `rulesFor` ~line 160)
- Create: `packages/engine/src/constants.test.ts`

**Interfaces:**

- Consumes: existing `DEFAULT_RULES`, `RuleConfig`.
- Produces: `type ContestKind = 'pact' | 'tiers'` (types.ts); `RuleConfig.contest: ContestKind`; `MIN_TURN_CAP = 10`, `MAX_TURN_CAP = 50` (constants.ts); `rulesFor(playerCount: number, turnCap?: number, contest?: ContestKind): RuleConfig`. Later tasks branch on `rules.contest === 'tiers'` everywhere.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/constants.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { DEFAULT_RULES, MAX_TURN_CAP, MIN_TURN_CAP, rulesFor } from './constants.js';

describe('rulesFor with a turn cap', () => {
  it('defaults reproduce the tuned values exactly', () => {
    for (const playerCount of [2, 4, 6, 8, 10, 12]) {
      const rules = rulesFor(playerCount);
      expect(rules.turnCap).toBe(25);
      expect(rules.contest).toBe('pact');
      expect(rules.stormFirstWave).toBe(playerCount <= 6 ? 10 : playerCount <= 9 ? 9 : 6);
      expect(rules.stormInterval).toBe(playerCount <= 6 ? 2 : 1);
      expect(rules.concordatWindow).toBe(5);
    }
  });

  it('scales the storm schedule with the cap', () => {
    const short = rulesFor(4, 15);
    expect(short.turnCap).toBe(15);
    expect(short.stormFirstWave).toBe(6); // round(15 * 0.4)
    expect(short.stormInterval).toBe(1); // short games tighten the interval
    const long = rulesFor(4, 35);
    expect(long.stormFirstWave).toBe(14);
    expect(long.stormInterval).toBe(2);
  });

  it('keeps a floor on the first wave and scales the concordat window', () => {
    expect(rulesFor(12, 10).stormFirstWave).toBeGreaterThanOrEqual(4);
    expect(rulesFor(4, 10).concordatWindow).toBe(3); // round(10 / 3)
    expect(rulesFor(4, 50).concordatWindow).toBe(5); // never above today's 5
    expect(rulesFor(4, 10).concordatWindow).toBeGreaterThanOrEqual(2);
  });

  it('streak requirements are cap-independent', () => {
    const short = rulesFor(4, 10);
    expect(short.hegemonyStreak).toBe(DEFAULT_RULES.hegemonyStreak);
    expect(short.decapitationStreak).toBe(DEFAULT_RULES.decapitationStreak);
    expect(short.condominiumStreak).toBe(DEFAULT_RULES.condominiumStreak);
  });

  it('carries the contest kind', () => {
    expect(rulesFor(4, 25, 'tiers').contest).toBe('tiers');
    expect(MIN_TURN_CAP).toBe(10);
    expect(MAX_TURN_CAP).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/engine/src/constants.test.ts`
Expected: FAIL — `MIN_TURN_CAP` etc. are not exported; `contest` missing.

- [ ] **Step 3: Implement**

In `packages/engine/src/types.ts`, add above `RuleConfig` and inside it:

```ts
/** Which social contest drives combat multipliers. */
export type ContestKind = 'pact' | 'tiers';
```

```ts
export interface RuleConfig {
  /** Which social contest drives combat multipliers. */
  contest: ContestKind;
  turnCap: number;
  // ... existing fields unchanged
```

In `packages/engine/src/constants.ts`:

- Import the type: extend the existing type import to `import type { ContestKind, PactOutcome, RuleConfig } from './types.js';`
- Add `contest: 'pact',` as the first field of `DEFAULT_RULES`.
- Add near the top (after the existing player constants is fine):

```ts
/** Creation-time bounds on the configurable game length. */
export const MIN_TURN_CAP = 10;
export const MAX_TURN_CAP = 50;
```

- Replace `rulesFor` with:

```ts
export function rulesFor(
  playerCount: number,
  turnCap: number = DEFAULT_RULES.turnCap,
  contest: ContestKind = 'pact',
): RuleConfig {
  // Same per-table-size fraction that produced the tuned 10/9/6 first waves at
  // the default cap of 25; the cap now just stretches or compresses the clock.
  const firstWaveFraction = playerCount <= 6 ? 0.4 : playerCount <= 9 ? 0.36 : 0.24;
  return {
    ...DEFAULT_RULES,
    contest,
    turnCap,
    dominationShare:
      playerCount <= 4 ? 0.65 : playerCount <= 6 ? 0.6 : playerCount <= 9 ? 0.55 : 0.5,
    hegemonyShare: playerCount <= 4 ? 0.5 : playerCount <= 6 ? 0.45 : playerCount <= 9 ? 0.4 : 0.45,
    stormFirstWave: Math.max(4, Math.round(turnCap * firstWaveFraction)),
    stormInterval: playerCount <= 6 ? (turnCap <= 15 ? 1 : 2) : 1,
    // "Recent cooperation" must never mean a third of the game ago.
    concordatWindow: Math.min(5, Math.max(2, Math.round(turnCap / 3))),
  };
}
```

(Keep the existing explanatory comments above the function and on `dominationShare`/`hegemonyShare` — only the mechanics shown here change.)

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/engine/src/constants.test.ts` — expected: PASS.
Run: `pnpm exec vitest run packages/engine` — expected: PASS (defaults unchanged; `TEST_RULES = { ...DEFAULT_RULES }` picks up `contest: 'pact'` automatically). If anything fails, it will be a `RuleConfig` literal missing `contest` — add `contest: 'pact'` to it.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/constants.ts packages/engine/src/constants.test.ts
git commit -m "feat(engine): contest kind and turn-cap-aware rulesFor"
```

---

### Task 2: `GameState.tiersLists` plumbing and redaction

**Files:**

- Modify: `packages/engine/src/types.ts` (GameState, ~line 143)
- Modify: `packages/engine/src/setup.ts` (`createInitialState`, `cloneState`)
- Modify: `packages/engine/src/redact.ts`
- Modify: `packages/engine/src/victory.ts` (`processEliminations`, ~line 503)
- Modify: `packages/engine/src/testing.ts` (`scenario`, ~line 129)
- Create: `packages/engine/src/contest/tiers.test.ts` (redaction tests only for now)

**Interfaces:**

- Consumes: `cloneShallow`/`cloneState` field-copy pattern.
- Produces: `interface TiersList { items: string[]; shuffle: number[] }` in types.ts, where **`shuffle[p]` = author index (= true tier, 0=A…5=F) of the item displayed at public position `p`**; `GameState.tiersLists: (TiersList | null)[]` (per slot); redacted rival views carry `items` in public order with an identity `shuffle`. Every later task relies on these exact semantics.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/contest/tiers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { redact } from '../redact.js';
import { lineMap, scenario } from '../testing.js';
import type { TiersList } from '../types.js';

const LIST: TiersList = {
  items: ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'], // true A→F
  shuffle: [3, 0, 5, 1, 4, 2], // public position p shows items[shuffle[p]]
};

function stateWithList() {
  const map = lineMap(4, 2);
  const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3] });
  state.tiersLists[0] = { items: [...LIST.items], shuffle: [...LIST.shuffle] };
  return state;
}

describe('tiers redaction', () => {
  it('authors see their own ordering', () => {
    const view = redact(stateWithList(), 0);
    expect(view.tiersLists[0]).toEqual(LIST);
  });

  it('rivals see items in public order with an identity shuffle', () => {
    const view = redact(stateWithList(), 1);
    expect(view.tiersLists[0]).toEqual({
      items: ['delta', 'alpha', 'foxtrot', 'bravo', 'echo', 'charlie'],
      shuffle: [0, 1, 2, 3, 4, 5],
    });
  });

  it('spectators get the public view too, and the ordering is hidden even without fog', () => {
    const state = stateWithList();
    expect(state.fogUntilTurn).toBe(0); // fog inactive — redaction must still apply
    const view = redact(state, null);
    expect(view.tiersLists[0]?.items[0]).toBe('delta');
    expect(JSON.stringify(view.tiersLists[0])).not.toContain('"shuffle":[3');
  });

  it('redaction never mutates the source state', () => {
    const state = stateWithList();
    redact(state, 1);
    expect(state.tiersLists[0]).toEqual(LIST);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/engine/src/contest/tiers.test.ts`
Expected: FAIL — `tiersLists` does not exist (TypeScript error).

- [ ] **Step 3: Implement**

`packages/engine/src/types.ts` — add near the Pact section:

```ts
// ─── Tiers ───────────────────────────────────────────────────────────────────

/**
 * A published tier list. `items` holds the six entries in the author's true
 * A→F order and is a secret; what the table sees is the shuffled presentation:
 * `shuffle[p]` is the author index (= true tier) of the item shown at public
 * position `p`. Redaction rewrites rival lists into public order with an
 * identity shuffle, so the true ordering never leaves the server.
 */
export interface TiersList {
  items: string[];
  shuffle: number[];
}
```

In `GameState`, after `decapitationStreak`:

```ts
  // Tiers bookkeeping — the list each slot wrote last turn, guessable this turn.
  // All null in pact games.
  tiersLists: (TiersList | null)[];
```

`packages/engine/src/setup.ts` — in `createInitialState` after `decapitationStreak: ...`:

```ts
    tiersLists: new Array<TiersList | null>(playerCount).fill(null),
```

(add `TiersList` to the type import). In `cloneState`, after `decapitationStreak: ...`:

```ts
    tiersLists: state.tiersLists.map((list) =>
      list === null ? null : { items: list.items.slice(), shuffle: list.shuffle.slice() },
    ),
```

`packages/engine/src/testing.ts` — in `scenario`'s state literal, after `decapitationStreak`:

```ts
    tiersLists: new Array<TiersList | null>(playerCount).fill(null),
```

(add `TiersList` to the type import).

`packages/engine/src/victory.ts` — in `processEliminations`, next to the pact cleanup (`state.pactPartner[slot] = null;`):

```ts
// A dead player's list leaves the guessable pool with them.
state.tiersLists[slot] = null;
```

`packages/engine/src/redact.ts` — replace `redact` and extend `cloneShallow`:

```ts
export function redact(state: GameState, viewer: Slot | null): GameState {
  const out = cloneShallow(state);

  // Tier-list orderings are secret regardless of fog: rivals and spectators get
  // the items in public (shuffled) order with an identity shuffle, so the true
  // ordering is unrecoverable. Authors keep their own.
  out.tiersLists = state.tiersLists.map((list, slot) => {
    if (list === null) return null;
    if (viewer === slot) return { items: list.items.slice(), shuffle: list.shuffle.slice() };
    return {
      items: list.shuffle.map((authorIndex) => list.items[authorIndex]),
      shuffle: list.shuffle.map((_, position) => position),
    };
  });

  if (!fogActive(state)) return out;

  // Fog hides strength, never ownership: you can still see who holds what, you
  // just cannot count what is standing on it.
  out.armies = state.armies.map((count, id) =>
    viewer !== null && state.owner[id] === viewer ? count : HIDDEN_ARMIES,
  );

  return out;
}
```

In `cloneShallow`, after `decapitationStreak: ...`:

```ts
    tiersLists: state.tiersLists.map((list) =>
      list === null ? null : { items: list.items.slice(), shuffle: list.shuffle.slice() },
    ),
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/engine` — expected: PASS (the compiler will flag any other `GameState` literal; fix each by adding the `tiersLists` line as in `scenario`).
Run: `pnpm typecheck` — expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src
git commit -m "feat(engine): tiersLists state field with always-on redaction"
```

---

### Task 3: Topic bank

**Files:**

- Create: `packages/engine/src/contest/topics.ts`
- Create: `packages/engine/src/contest/topics.test.ts`

**Interfaces:**

- Consumes: `substream` from `../rng.js`.
- Produces: `interface TiersTopic { title: string; canned: string[] }` (canned items in descending popularity — bots lean on this order); `TIERS_TOPICS: readonly TiersTopic[]` (40 topics, 8 canned each); `topicForTurn(seed: string, writeTurn: number): TiersTopic` — deterministic, repeat-free within a cycle of the bank (`writeTurn` 0 = lobby list).

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/contest/topics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { normalizeItemText } from './tiers.js';
import { TIERS_TOPICS, topicForTurn } from './topics.js';

describe('the topic bank', () => {
  it('has at least 40 topics of 8 distinct canned items each', () => {
    expect(TIERS_TOPICS.length).toBeGreaterThanOrEqual(40);
    for (const topic of TIERS_TOPICS) {
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.canned).toHaveLength(8);
      const keys = new Set(topic.canned.map(normalizeItemText));
      expect(keys.size).toBe(8);
      expect(keys.has('')).toBe(false);
    }
  });

  it('draws deterministically and without repeats within a full cycle', () => {
    const seen = new Set<string>();
    for (let turn = 0; turn < TIERS_TOPICS.length; turn++) {
      const topic = topicForTurn('seed-a', turn);
      expect(topicForTurn('seed-a', turn)).toEqual(topic);
      seen.add(topic.title);
    }
    expect(seen.size).toBe(TIERS_TOPICS.length);
  });

  it('different seeds draw different schedules', () => {
    const a = Array.from({ length: 5 }, (_, t) => topicForTurn('seed-a', t).title).join('|');
    const b = Array.from({ length: 5 }, (_, t) => topicForTurn('seed-b', t).title).join('|');
    expect(a).not.toBe(b);
  });
});
```

Note: this test imports `normalizeItemText` from `./tiers.js`, which does not exist yet. To keep this task self-contained, create `packages/engine/src/contest/tiers.ts` now containing ONLY that function (Task 4 fills in the rest):

```ts
/** The Tiers contest. Scoring and resolution arrive with the contest core. */

/**
 * Collapses an entry to its identity: lowercased, accents folded, everything
 * that is not a letter or digit removed — "McDonald's" and "mcdonalds" are the
 * same item. Used for duplicate detection and bot popularity lookups, never
 * for display.
 */
export function normalizeItemText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/engine/src/contest/topics.test.ts`
Expected: FAIL — `./topics.js` not found.

- [ ] **Step 3: Implement the bank**

Create `packages/engine/src/contest/topics.ts`:

```ts
/**
 * The Tiers topic bank.
 *
 * Canned items are listed in rough descending popularity. That order is what
 * bots play from — a bot's list is a lightly perturbed popularity order, which
 * keeps bots guessable by attentive humans and keeps bot-vs-bot games from
 * going inert. Humans are free to ignore the canned items entirely.
 */

import { substream } from '../rng.js';

export interface TiersTopic {
  title: string;
  canned: string[];
}

export const TIERS_TOPICS: readonly TiersTopic[] = [
  {
    title: 'Fast food chains',
    canned: [
      "McDonald's",
      'Chick-fil-A',
      "Wendy's",
      'Taco Bell',
      'Burger King',
      'Subway',
      'KFC',
      "Arby's",
    ],
  },
  {
    title: 'Pizza toppings',
    canned: [
      'Pepperoni',
      'Mushrooms',
      'Sausage',
      'Extra cheese',
      'Onions',
      'Bacon',
      'Pineapple',
      'Anchovies',
    ],
  },
  {
    title: 'Dog breeds',
    canned: [
      'Labrador',
      'Golden Retriever',
      'German Shepherd',
      'Poodle',
      'Beagle',
      'Corgi',
      'Dachshund',
      'Chihuahua',
    ],
  },
  {
    title: 'Superpowers',
    canned: [
      'Flight',
      'Teleportation',
      'Time travel',
      'Invisibility',
      'Super strength',
      'Mind reading',
      'Healing',
      'X-ray vision',
    ],
  },
  {
    title: 'Breakfast cereals',
    canned: [
      'Cinnamon Toast Crunch',
      'Frosted Flakes',
      'Lucky Charms',
      'Cheerios',
      'Froot Loops',
      'Rice Krispies',
      'Corn Flakes',
      'Raisin Bran',
    ],
  },
  {
    title: 'Ice cream flavors',
    canned: [
      'Chocolate',
      'Cookies and cream',
      'Vanilla',
      'Mint chip',
      'Strawberry',
      'Cookie dough',
      'Pistachio',
      'Rum raisin',
    ],
  },
  {
    title: 'Board games',
    canned: ['Chess', 'Catan', 'Scrabble', 'Monopoly', 'Risk', 'Clue', 'Checkers', 'Candy Land'],
  },
  {
    title: 'Sodas',
    canned: [
      'Coca-Cola',
      'Dr Pepper',
      'Sprite',
      'Pepsi',
      'Mountain Dew',
      'Root beer',
      'Fanta',
      'Tab',
    ],
  },
  {
    title: 'Candy',
    canned: [
      "Reese's",
      'Kit Kat',
      'Snickers',
      "M&M's",
      'Twix',
      'Skittles',
      'Candy corn',
      'Black licorice',
    ],
  },
  {
    title: 'Fruits',
    canned: [
      'Strawberry',
      'Mango',
      'Watermelon',
      'Apple',
      'Banana',
      'Pineapple',
      'Grapefruit',
      'Durian',
    ],
  },
  {
    title: 'Vegetables',
    canned: [
      'Corn',
      'Potatoes',
      'Carrots',
      'Broccoli',
      'Spinach',
      'Cauliflower',
      'Brussels sprouts',
      'Okra',
    ],
  },
  {
    title: 'Household chores',
    canned: [
      'Cooking',
      'Laundry',
      'Vacuuming',
      'Dishes',
      'Dusting',
      'Mowing the lawn',
      'Cleaning the bathroom',
      'Unclogging drains',
    ],
  },
  {
    title: 'Kinds of weather',
    canned: [
      'Sunny and mild',
      'Snow day',
      'Light rain',
      'Thunderstorm',
      'Fog',
      'Windy',
      'Hail',
      'Heat wave',
    ],
  },
  {
    title: 'Holidays',
    canned: [
      'Christmas',
      'Halloween',
      'Thanksgiving',
      "New Year's Eve",
      'Fourth of July',
      'Easter',
      "Valentine's Day",
      'Tax Day',
    ],
  },
  {
    title: 'Movie genres',
    canned: [
      'Comedy',
      'Action',
      'Thriller',
      'Sci-fi',
      'Horror',
      'Romance',
      'Documentary',
      'Musical',
    ],
  },
  {
    title: 'Music genres',
    canned: ['Rock', 'Pop', 'Hip hop', 'Country', 'Jazz', 'Classical', 'Metal', 'Polka'],
  },
  {
    title: 'Pets',
    canned: ['Dog', 'Cat', 'Fish', 'Rabbit', 'Hamster', 'Parrot', 'Snake', 'Tarantula'],
  },
  {
    title: 'Sandwiches',
    canned: [
      'Grilled cheese',
      'Turkey club',
      'BLT',
      'Peanut butter and jelly',
      'Ham and cheese',
      'Tuna salad',
      'Egg salad',
      'Liverwurst',
    ],
  },
  {
    title: 'Condiments',
    canned: [
      'Ketchup',
      'Ranch',
      'Mayonnaise',
      'Mustard',
      'BBQ sauce',
      'Hot sauce',
      'Relish',
      'Miracle Whip',
    ],
  },
  {
    title: 'School subjects',
    canned: ['Gym', 'Art', 'Science', 'History', 'Math', 'English', 'Chemistry', 'Latin'],
  },
  {
    title: 'Ways to travel',
    canned: ['Airplane', 'Train', 'Road trip', 'Boat', 'Bicycle', 'Motorcycle', 'Bus', 'Walking'],
  },
  {
    title: 'Vacations',
    canned: [
      'Beach resort',
      'Mountain cabin',
      'Big city trip',
      'National park',
      'Cruise',
      'Theme park',
      'Camping',
      'Visiting relatives',
    ],
  },
  {
    title: 'Mythical creatures',
    canned: ['Dragon', 'Phoenix', 'Unicorn', 'Mermaid', 'Griffin', 'Werewolf', 'Kraken', 'Goblin'],
  },
  {
    title: 'Video game genres',
    canned: ['RPG', 'Shooter', 'Platformer', 'Strategy', 'Puzzle', 'Racing', 'Fighting', 'Sports'],
  },
  {
    title: 'Card games',
    canned: ['Poker', 'Uno', 'Blackjack', 'Solitaire', 'Hearts', 'Go Fish', 'Rummy', 'War'],
  },
  {
    title: 'Coffee orders',
    canned: [
      'Latte',
      'Cold brew',
      'Cappuccino',
      'Mocha',
      'Black coffee',
      'Espresso',
      'Frappuccino',
      'Decaf',
    ],
  },
  {
    title: 'Desserts',
    canned: [
      'Chocolate cake',
      'Cheesecake',
      'Brownies',
      'Apple pie',
      'Tiramisu',
      'Ice cream sundae',
      'Donuts',
      'Fruitcake',
    ],
  },
  {
    title: 'Snacks',
    canned: [
      'Potato chips',
      'Popcorn',
      'Pretzels',
      'Trail mix',
      'Crackers',
      'Beef jerky',
      'Rice cakes',
      'Plain celery',
    ],
  },
  {
    title: 'Ways to exercise',
    canned: [
      'Walking',
      'Swimming',
      'Weightlifting',
      'Yoga',
      'Running',
      'Cycling',
      'Rowing',
      'Burpees',
    ],
  },
  {
    title: 'Pasta shapes',
    canned: [
      'Spaghetti',
      'Penne',
      'Fettuccine',
      'Elbow macaroni',
      'Ravioli',
      'Lasagna',
      'Angel hair',
      'Orzo',
    ],
  },
  {
    title: 'Cheeses',
    canned: ['Cheddar', 'Mozzarella', 'Parmesan', 'Swiss', 'Brie', 'Gouda', 'Feta', 'Limburger'],
  },
  {
    title: 'Pies',
    canned: [
      'Apple',
      'Pumpkin',
      'Pecan',
      'Cherry',
      'Key lime',
      'Lemon meringue',
      'Blueberry',
      'Mincemeat',
    ],
  },
  {
    title: 'Kitchen appliances',
    canned: [
      'Microwave',
      'Air fryer',
      'Coffee maker',
      'Dishwasher',
      'Blender',
      'Toaster',
      'Slow cooker',
      'Bread machine',
    ],
  },
  {
    title: 'Smells',
    canned: [
      'Fresh bread',
      'Coffee',
      'Rain on pavement',
      'Campfire',
      'Fresh-cut grass',
      'Vanilla',
      'Gasoline',
      'Wet dog',
    ],
  },
  {
    title: 'Gadgets',
    canned: [
      'Smartphone',
      'Laptop',
      'Headphones',
      'Smart watch',
      'Tablet',
      'E-reader',
      'Drone',
      'Fax machine',
    ],
  },
  {
    title: 'Social media platforms',
    canned: [
      'YouTube',
      'Instagram',
      'TikTok',
      'Reddit',
      'Twitter',
      'Facebook',
      'Snapchat',
      'LinkedIn',
    ],
  },
  {
    title: 'Ocean animals',
    canned: ['Dolphin', 'Sea turtle', 'Octopus', 'Whale', 'Seahorse', 'Shark', 'Crab', 'Jellyfish'],
  },
  {
    title: 'Birds',
    canned: ['Eagle', 'Owl', 'Penguin', 'Hummingbird', 'Parrot', 'Flamingo', 'Crow', 'Pigeon'],
  },
  {
    title: 'Sports to watch',
    canned: ['Football', 'Basketball', 'Baseball', 'Soccer', 'Hockey', 'Tennis', 'Golf', 'Bowling'],
  },
  {
    title: 'Things on toast',
    canned: [
      'Butter',
      'Avocado',
      'Jam',
      'Peanut butter',
      'Nutella',
      'Honey',
      'Cream cheese',
      'Marmite',
    ],
  },
];

/**
 * The topic for the list written alongside turn `writeTurn`'s orders
 * (`writeTurn` 0 is the lobby list). One seeded shuffle of the whole bank per
 * game, walked in order: deterministic, and repeat-free until the bank cycles.
 */
export function topicForTurn(seed: string, writeTurn: number): TiersTopic {
  const shuffled = substream(seed, 'tiers-topics').shuffle(TIERS_TOPICS);
  return shuffled[writeTurn % shuffled.length];
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/engine/src/contest/topics.test.ts` — expected: PASS.
Run: `pnpm lint` — expected: clean (long lines in the bank are data, but if Prettier objects run `pnpm format`).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/contest/topics.ts packages/engine/src/contest/topics.test.ts packages/engine/src/contest/tiers.ts
git commit -m "feat(engine): tiers topic bank with seeded repeat-free draws"
```

---

### Task 4: Tiers contest core — normalization, scoring, resolution

**Files:**

- Modify: `packages/engine/src/types.ts` (Orders section ~line 61, Report section ~line 200)
- Modify: `packages/engine/src/contest/tiers.ts` (extend the stub from Task 3)
- Modify: `packages/engine/src/index.ts` (exports)
- Modify: `packages/engine/src/contest/tiers.test.ts` (add scoring/resolution tests)

**Interfaces:**

- Consumes: `TiersList` (Task 2), `ContestContext`/`ContestOutcome` (`contest/types.ts`), `substream`.
- Produces (types.ts):
  - `interface TiersGuess { target: Slot; order: number[] }` — **`order[t]` = public position (0–5) of the item the guesser places at tier `t` (0=A…5=F)**.
  - `interface TiersOrders { list: string[]; guesses: TiersGuess[] }`; `OrderSet` gains optional `tiers?: TiersOrders`.
  - `interface TiersGuessResult { guesser: Slot; target: Slot; score: number }`.
  - `interface TiersResult { slot: Slot; revealed: string[] | null; guesses: TiersGuessResult[]; bestRead: TiersGuessResult | null; multiplier: number }`.
- Produces (tiers.ts):
  - `TIERS_LIST_SIZE = 6`, `TIERS_MAX_GUESSES = 2`, `TIERS_MAX_ITEM_LENGTH = 60`.
  - `normalizeTiersList(list: unknown): string[] | null` — trimmed originals, or null if invalid.
  - `makeTiersList(list: unknown, seed: string, writeTurn: number, slot: Slot): TiersList | null`.
  - `scoreGuess(list: TiersList, order: readonly number[]): number` — 0–12.
  - `resolveTiers(state: GameState, inputs: readonly (TiersOrders | null)[], context: ContestContext): ContestOutcome<TiersResult>`.
  - `applyTiersRecord(next: GameState, inputs: readonly (TiersOrders | null)[], seed: string, writeTurn: number): void`.
  - `tiersWarnings(state: GameState, slot: Slot, tiers: TiersOrders | null | undefined): string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/src/contest/tiers.test.ts` (keep the Task 2 redaction block; extend the imports):

```ts
import {
  applyTiersRecord,
  makeTiersList,
  normalizeItemText,
  normalizeTiersList,
  resolveTiers,
  scoreGuess,
  tiersWarnings,
} from './tiers.js';
import type { ContestContext } from './types.js';
import type { TiersOrders } from '../types.js';

const IDENTITY = [0, 1, 2, 3, 4, 5];

function context(state: ReturnType<typeof stateWithList>): ContestContext {
  const aliveSlots = [];
  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] === 'active') aliveSlots.push(slot);
  }
  return {
    attacked: state.status.map(() => state.status.map(() => false)),
    aliveSlots,
  };
}

describe('normalizeTiersList', () => {
  it('accepts six distinct entries and preserves display text', () => {
    expect(normalizeTiersList(['A ', ' b', 'C', 'd', 'E', 'f'])).toEqual([
      'A',
      'b',
      'C',
      'd',
      'E',
      'f',
    ]);
  });

  it('rejects wrong length, blanks, oversize and normalized duplicates', () => {
    expect(normalizeTiersList(['a', 'b', 'c', 'd', 'e'])).toBeNull();
    expect(normalizeTiersList(['a', 'b', 'c', 'd', 'e', ' '])).toBeNull();
    expect(normalizeTiersList(['a', 'b', 'c', 'd', 'e', 'x'.repeat(61)])).toBeNull();
    expect(normalizeTiersList(["McDonald's", 'mcdonalds', 'c', 'd', 'e', 'f'])).toBeNull();
    expect(normalizeTiersList(null)).toBeNull();
    expect(normalizeTiersList('nope')).toBeNull();
  });

  it('normalizeItemText folds case, punctuation and spacing', () => {
    expect(normalizeItemText(" McDonald's ")).toBe('mcdonalds');
    expect(normalizeItemText('Café au lait')).toBe('cafeaulait');
  });
});

describe('scoreGuess', () => {
  const list = { items: ['a', 'b', 'c', 'd', 'e', 'f'], shuffle: [3, 0, 5, 1, 4, 2] };

  it('a perfect guess scores 12', () => {
    // Place true tier t: find public position p with shuffle[p] === t.
    const perfect = [1, 3, 5, 0, 4, 2];
    expect(scoreGuess(list, perfect)).toBe(12);
  });

  it('adjacent placements score 1 each', () => {
    // Swap tiers A and B relative to the perfect guess: two items land one off.
    expect(scoreGuess(list, [3, 1, 5, 0, 4, 2])).toBe(10);
  });

  it('an identity guess against an identity shuffle is perfect', () => {
    expect(scoreGuess({ items: list.items, shuffle: IDENTITY }, IDENTITY)).toBe(12);
  });
});

describe('resolveTiers', () => {
  function twoPlayerState() {
    const map = lineMap(4, 2);
    const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3] });
    state.tiersLists[0] = { items: ['a', 'b', 'c', 'd', 'e', 'f'], shuffle: [...IDENTITY] };
    state.tiersLists[1] = { items: ['u', 'v', 'w', 'x', 'y', 'z'], shuffle: [...IDENTITY] };
    return state;
  }

  const input = (guesses: TiersOrders['guesses']): TiersOrders => ({
    list: ['p', 'q', 'r', 's', 't', 'u'],
    guesses,
  });

  it('a perfect guess pays the guesser and the author', () => {
    const state = twoPlayerState();
    const out = resolveTiers(
      state,
      [input([{ target: 1, order: [...IDENTITY] }]), input([])],
      context(state),
    );
    // Guesser: 100 + (12 − 6) × 2 = 112. Author: 100 + max(0, 12 − 6) = 106.
    expect(out.multiplier[0]).toBe(112);
    expect(out.multiplier[1]).toBe(106);
    expect(out.results[0].guesses).toEqual([{ guesser: 0, target: 1, score: 12 }]);
    expect(out.results[1].bestRead).toEqual({ guesser: 0, target: 1, score: 12 });
    expect(out.results[0].revealed).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(out.bonusIncome).toEqual([0, 0]);
  });

  it('a wild guess hurts the guesser and never hurts the author', () => {
    const state = twoPlayerState();
    // Reverse order scores 2 (tiers 2 and 3 land adjacent), so 100 + (2−6)×2 = 92.
    const out = resolveTiers(
      state,
      [input([{ target: 1, order: [5, 4, 3, 2, 1, 0] }]), input([])],
      context(state),
    );
    expect(out.multiplier[0]).toBe(92);
    expect(out.multiplier[1]).toBe(100); // bad read is not the author's problem
  });

  it('abstaining is neutral and clamps hold at [80, 140]', () => {
    const state = twoPlayerState();
    const out = resolveTiers(state, [null, null], context(state));
    expect(out.multiplier[0]).toBe(100);
    const worst = resolveTiers(
      state,
      [
        input([{ target: 1, order: [5, 4, 3, 2, 1, 0] }]),
        input([{ target: 0, order: [5, 4, 3, 2, 1, 0] }]),
      ],
      context(state),
    );
    expect(Math.min(...worst.multiplier)).toBeGreaterThanOrEqual(80);
    expect(Math.max(...worst.multiplier)).toBeLessThanOrEqual(140);
  });

  it('drops invalid guesses: self, dead, listless, duplicate, bad permutation, overflow', () => {
    const map = lineMap(8, 4);
    const state = scenario(map, {
      owner: [0, 1, 2, 3, 0, 1, 2, 3],
      armies: [3, 3, 3, 3, 3, 3, 3, 3],
    });
    state.status[2] = 'eliminated';
    state.tiersLists[0] = { items: ['a', 'b', 'c', 'd', 'e', 'f'], shuffle: [...IDENTITY] };
    state.tiersLists[1] = { items: ['g', 'h', 'i', 'j', 'k', 'l'], shuffle: [...IDENTITY] };
    state.tiersLists[3] = { items: ['m', 'n', 'o', 'p', 'q', 'r'], shuffle: [...IDENTITY] };

    const out = resolveTiers(
      state,
      [
        input([
          { target: 0, order: [...IDENTITY] }, // self
          { target: 2, order: [...IDENTITY] }, // dead
          { target: 1, order: [0, 0, 1, 2, 3, 4] }, // not a permutation
          { target: 3, order: [...IDENTITY] }, // valid
          { target: 3, order: [...IDENTITY] }, // duplicate target
          { target: 1, order: [...IDENTITY] }, // over the 2-guess cap
        ]),
        null,
        null,
        null,
      ],
      context(state),
    );
    expect(out.results[0].guesses).toHaveLength(2); // target 3, then target 1
    expect(out.results[0].guesses.map((g) => g.target)).toEqual([3, 1]);
  });

  it('bestRead tie-breaks to the lowest guesser slot', () => {
    const map = lineMap(6, 3);
    const state = scenario(map, { owner: [0, 1, 2, 0, 1, 2], armies: [3, 3, 3, 3, 3, 3] });
    state.tiersLists[2] = { items: ['a', 'b', 'c', 'd', 'e', 'f'], shuffle: [...IDENTITY] };
    const out = resolveTiers(
      state,
      [
        input([{ target: 2, order: [...IDENTITY] }]),
        input([{ target: 2, order: [...IDENTITY] }]),
        input([]),
      ],
      context(state),
    );
    expect(out.results[2].bestRead?.guesser).toBe(0);
  });
});

describe('applyTiersRecord and makeTiersList', () => {
  it('installs normalized lists with a seeded shuffle, null for invalid or dead', () => {
    const map = lineMap(4, 2);
    const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3] });
    applyTiersRecord(
      state,
      [
        { list: ['a', 'b', 'c', 'd', 'e', 'f'], guesses: [] },
        { list: ['a', 'a', 'c', 'd', 'e', 'f'], guesses: [] }, // duplicate → invalid
      ],
      'seed-x',
      3,
    );
    const installed = state.tiersLists[0];
    expect(installed).not.toBeNull();
    expect([...(installed?.shuffle ?? [])].sort((a, b) => a - b)).toEqual(IDENTITY);
    expect(state.tiersLists[1]).toBeNull();
    // Deterministic given (seed, writeTurn, slot):
    expect(makeTiersList(['a', 'b', 'c', 'd', 'e', 'f'], 'seed-x', 3, 0)).toEqual(installed);
    // A different turn shuffles differently for the same seed and slot:
    expect(makeTiersList(['a', 'b', 'c', 'd', 'e', 'f'], 'seed-x', 4, 0)).not.toEqual(installed);
  });
});

describe('tiersWarnings', () => {
  it('flags a bad list and dropped guesses without throwing', () => {
    const map = lineMap(4, 2);
    const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3] });
    state.tiersLists[1] = { items: ['a', 'b', 'c', 'd', 'e', 'f'], shuffle: [...IDENTITY] };
    expect(tiersWarnings(state, 0, null)).toHaveLength(1);
    expect(
      tiersWarnings(state, 0, {
        list: ['a', 'b', 'c', 'd', 'e', 'f'],
        guesses: [{ target: 0, order: [...IDENTITY] }],
      }),
    ).toHaveLength(1);
    expect(
      tiersWarnings(state, 0, {
        list: ['a', 'b', 'c', 'd', 'e', 'f'],
        guesses: [{ target: 1, order: [...IDENTITY] }],
      }),
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/engine/src/contest/tiers.test.ts`
Expected: FAIL — missing exports.

- [ ] **Step 3: Add the types**

`packages/engine/src/types.ts` — in the Orders section, before `OrderSet`:

```ts
/** One reordering of a rival's published items, submitted blind with orders. */
export interface TiersGuess {
  target: Slot;
  /** order[t] = public position (0–5) of the item placed at tier t (0=A … 5=F). */
  order: number[];
}

export interface TiersOrders {
  /** Six free-text entries in the author's chosen A→F order. */
  list: string[];
  /** Up to two rivals' lists, reordered as the guesser believes they wrote them. */
  guesses: TiersGuess[];
}
```

`OrderSet` gains one optional field after `pledge`:

```ts
  /** Tiers contest input; absent in pact games. */
  tiers?: TiersOrders;
```

In the Tiers section (added in Task 2), after `TiersList`:

```ts
export interface TiersGuessResult {
  guesser: Slot;
  target: Slot;
  /** 0–12: exact tier = 2 per item, one tier off = 1. */
  score: number;
}

export interface TiersResult {
  slot: Slot;
  /** The list this player wrote last turn, revealed in true A→F order. */
  revealed: string[] | null;
  /** Guesses this player made this turn, scored. */
  guesses: TiersGuessResult[];
  /** The best guess made against this player's list. */
  bestRead: TiersGuessResult | null;
  /** Combat multiplier, ×100. */
  multiplier: number;
}
```

- [ ] **Step 4: Implement the contest**

Extend `packages/engine/src/contest/tiers.ts` to:

```ts
/**
 * The Tiers contest.
 *
 * Where the Pact is a loyalty game, Tiers is a legibility game. Each turn,
 * blind and simultaneous with orders, every player writes a six-entry tier
 * list for the turn's topic and may reorder up to two rivals' *previous* lists
 * as they believe the authors wrote them. Lists are pipelined: written on turn
 * N, published shuffled in the turn-N report, guessed during turn N+1, revealed
 * and scored at turn-N+1 resolution.
 *
 * Reading someone well pays you; being read well pays the author too — an
 * illegible list denies rivals points but earns its author nothing, so being
 * knowable is a mutual good. A wild guess costs: guessing is a wager, not free
 * upside.
 *
 * Resolution draws no randomness; the only seeded step is the presentation
 * shuffle applied when a new list is installed.
 */

import { substream } from '../rng.js';
import type {
  GameState,
  Slot,
  TiersGuess,
  TiersGuessResult,
  TiersList,
  TiersOrders,
  TiersResult,
} from '../types.js';
import type { ContestContext, ContestOutcome } from './types.js';

export const TIERS_LIST_SIZE = 6;
export const TIERS_MAX_GUESSES = 2;
export const TIERS_MAX_ITEM_LENGTH = 60;

/** Per item: exact tier and one-tier-off points. */
const EXACT_POINTS = 2;
const ADJACENT_POINTS = 1;
/** A guess scoring this breaks even; below it, guessing was a losing wager. */
const NEUTRAL_SCORE = 6;
/** Multiplier points per point of guess score above or below neutral. */
const GUESS_WEIGHT = 2;
const MIN_MULTIPLIER = 80;
const MAX_MULTIPLIER = 140;

export function normalizeItemText(text: string): string {
  // ... unchanged from Task 3
}

/**
 * Validates a raw list submission. Returns the six entries with display
 * whitespace tidied (trimmed, inner runs collapsed) — the author's casing and
 * punctuation are preserved for display — or null if the submission is not six
 * distinct, non-empty, reasonably-sized entries.
 */
export function normalizeTiersList(list: unknown): string[] | null {
  if (!Array.isArray(list) || list.length !== TIERS_LIST_SIZE) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== 'string') return null;
    const display = raw.trim().replace(/\s+/g, ' ');
    if (display.length === 0 || display.length > TIERS_MAX_ITEM_LENGTH) return null;
    const key = normalizeItemText(display);
    if (key.length === 0 || seen.has(key)) return null;
    seen.add(key);
    out.push(display);
  }
  return out;
}

/** Builds the stored list: normalized items plus the seeded presentation shuffle. */
export function makeTiersList(
  list: unknown,
  seed: string,
  writeTurn: number,
  slot: Slot,
): TiersList | null {
  const items = normalizeTiersList(list);
  if (items === null) return null;
  const positions = Array.from({ length: TIERS_LIST_SIZE }, (_, i) => i);
  return { items, shuffle: substream(seed, 'tiers-shuffle', writeTurn, slot).shuffle(positions) };
}

function isPermutation(order: unknown): order is number[] {
  if (!Array.isArray(order) || order.length !== TIERS_LIST_SIZE) return false;
  const seen = new Set<number>();
  for (const value of order) {
    if (!Number.isInteger(value) || value < 0 || value >= TIERS_LIST_SIZE || seen.has(value)) {
      return false;
    }
    seen.add(value);
  }
  return true;
}

/** Scores one guess against the author's true ordering. 0–12. */
export function scoreGuess(list: TiersList, order: readonly number[]): number {
  let score = 0;
  for (let tier = 0; tier < TIERS_LIST_SIZE; tier++) {
    const trueTier = list.shuffle[order[tier]];
    const diff = Math.abs(trueTier - tier);
    score += diff === 0 ? EXACT_POINTS : diff === 1 ? ADJACENT_POINTS : 0;
  }
  return score;
}

export function resolveTiers(
  state: GameState,
  inputs: readonly (TiersOrders | null | undefined)[],
  _context: ContestContext,
): ContestOutcome<TiersResult> {
  const playerCount = state.playerCount;

  // Normalise: like the Pact, bad input is an abstention, never an error.
  const validGuesses: TiersGuess[][] = Array.from({ length: playerCount }, () => []);
  for (let slot = 0; slot < playerCount; slot++) {
    if (state.status[slot] !== 'active') continue;
    const seen = new Set<Slot>();
    for (const guess of inputs[slot]?.guesses ?? []) {
      if (validGuesses[slot].length >= TIERS_MAX_GUESSES) break;
      const target = guess?.target;
      if (!Number.isInteger(target) || target < 0 || target >= playerCount) continue;
      if (target === slot || seen.has(target)) continue;
      if (state.status[target] !== 'active') continue;
      if (state.tiersLists[target] === null) continue;
      if (!isPermutation(guess.order)) continue;
      seen.add(target);
      validGuesses[slot].push({ target, order: guess.order.slice() });
    }
  }

  // Score every guess; track the best read of each author. Iterating guessers
  // in slot order makes the strictly-greater comparison a deterministic
  // lowest-slot tie-break.
  const guessResults: TiersGuessResult[][] = Array.from({ length: playerCount }, () => []);
  const bestRead: (TiersGuessResult | null)[] = new Array(playerCount).fill(null);
  for (let slot = 0; slot < playerCount; slot++) {
    for (const guess of validGuesses[slot]) {
      const list = state.tiersLists[guess.target];
      if (list === null) continue;
      const result: TiersGuessResult = {
        guesser: slot,
        target: guess.target,
        score: scoreGuess(list, guess.order),
      };
      guessResults[slot].push(result);
      const incumbent = bestRead[guess.target];
      if (incumbent === null || result.score > incumbent.score) bestRead[guess.target] = result;
    }
  }

  const multiplier: number[] = new Array(playerCount).fill(100);
  const bonusIncome: number[] = new Array(playerCount).fill(0);
  const results: TiersResult[] = [];

  for (let slot = 0; slot < playerCount; slot++) {
    if (state.status[slot] !== 'active') continue;

    const guessContribution = guessResults[slot].reduce(
      (sum, guess) => sum + (guess.score - NEUTRAL_SCORE) * GUESS_WEIGHT,
      0,
    );
    // Being read well pays; being read badly costs the author nothing.
    const authorBonus = Math.max(0, (bestRead[slot]?.score ?? 0) - NEUTRAL_SCORE);
    multiplier[slot] = Math.min(
      MAX_MULTIPLIER,
      Math.max(MIN_MULTIPLIER, 100 + guessContribution + authorBonus),
    );

    results.push({
      slot,
      revealed: state.tiersLists[slot]?.items.slice() ?? null,
      guesses: guessResults[slot],
      bestRead: bestRead[slot],
      multiplier: multiplier[slot],
    });
  }

  return { multiplier, bonusIncome, results };
}

/**
 * Installs the lists written this turn, replacing the ones just scored. The
 * tiers analogue of `applyPactRecord`. A missing or malformed list simply makes
 * its author unguessable next turn.
 */
export function applyTiersRecord(
  next: GameState,
  inputs: readonly (TiersOrders | null | undefined)[],
  seed: string,
  writeTurn: number,
): void {
  for (let slot = 0; slot < next.playerCount; slot++) {
    next.tiersLists[slot] =
      next.status[slot] === 'active'
        ? makeTiersList(inputs[slot]?.list ?? null, seed, writeTurn, slot)
        : null;
  }
}

/** Human-readable submission feedback for the server; resolution never warns. */
export function tiersWarnings(
  state: GameState,
  slot: Slot,
  tiers: TiersOrders | null | undefined,
): string[] {
  const warnings: string[] = [];
  if (!tiers || normalizeTiersList(tiers.list) === null) {
    warnings.push(
      'tier list incomplete — six distinct entries needed, or rivals cannot read you next turn',
    );
  }
  const guesses = tiers?.guesses ?? [];
  if (guesses.length > TIERS_MAX_GUESSES) {
    warnings.push(`only your first ${TIERS_MAX_GUESSES} guesses count`);
  }
  const seen = new Set<Slot>();
  for (const guess of guesses.slice(0, TIERS_MAX_GUESSES)) {
    const target = guess?.target;
    const badTarget =
      !Number.isInteger(target) ||
      target < 0 ||
      target >= state.playerCount ||
      target === slot ||
      seen.has(target) ||
      state.status[target] !== 'active' ||
      state.tiersLists[target] === null;
    if (badTarget) {
      warnings.push(`guess ${seen.size + 1} dropped: no guessable list for that target`);
      continue;
    }
    seen.add(target);
    if (!isPermutation(guess.order)) {
      warnings.push(`guess on seat ${target + 1} dropped: incomplete ordering`);
    }
  }
  return warnings;
}
```

- [ ] **Step 5: Export from the engine**

In `packages/engine/src/index.ts`, after the pact export block:

```ts
export {
  applyTiersRecord,
  decideTiersList,
  decideTiersOrders,
  makeTiersList,
  normalizeItemText,
  normalizeTiersList,
  resolveTiers,
  scoreGuess,
  tiersWarnings,
  TIERS_LIST_SIZE,
  TIERS_MAX_GUESSES,
  TIERS_MAX_ITEM_LENGTH,
} from './contest/tiers.js';
export { TIERS_TOPICS, topicForTurn, type TiersTopic } from './contest/topics.js';
```

`decideTiersList`/`decideTiersOrders` do not exist until Task 6 — omit those two names now and add them in Task 6.

- [ ] **Step 6: Run tests**

Run: `pnpm exec vitest run packages/engine/src/contest` — expected: PASS.
Run: `pnpm typecheck` — expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src
git commit -m "feat(engine): tiers contest core — normalization, scoring, resolution"
```

---

### Task 5: Resolution dispatch and turn report

**Files:**

- Modify: `packages/engine/src/types.ts` (`TurnReport`, ~line 247)
- Modify: `packages/engine/src/orders.ts` (`NormalizedOrders`, `normalizeOrders`)
- Modify: `packages/engine/src/resolve.ts` (Phase 4, Phase 9, report, headline)
- Modify: `packages/engine/src/contest/tiers.test.ts` (integration tests)

**Interfaces:**

- Consumes: `resolveTiers`, `applyTiersRecord` (Task 4), `topicForTurn` (Task 3), `rules.contest` (Task 1).
- Produces: `TurnReport.tiers: TiersResult[]` (empty in pact games), `TurnReport.revealedTopic: string | null`; `NormalizedOrders.tiers: TiersOrders | null`. Web (Task 13) reads exactly these.

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/src/contest/tiers.test.ts`:

```ts
import { resolveTurn } from '../resolve.js';
import { TEST_RULES, orders } from '../testing.js';
import { topicForTurn } from './topics.js';

describe('resolveTurn under the tiers contest', () => {
  const rules = { ...TEST_RULES, contest: 'tiers' as const };

  function setup() {
    const map = lineMap(4, 2);
    const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3] });
    state.tiersLists[0] = { items: ['a', 'b', 'c', 'd', 'e', 'f'], shuffle: [0, 1, 2, 3, 4, 5] };
    state.tiersLists[1] = { items: ['u', 'v', 'w', 'x', 'y', 'z'], shuffle: [0, 1, 2, 3, 4, 5] };
    return { map, state };
  }

  const submission = (slot: number, target: number) => ({
    ...orders(slot),
    tiers: {
      list: ['1', '2', '3', '4', '5', '6'],
      guesses: [{ target, order: [0, 1, 2, 3, 4, 5] }],
    },
  });

  it('scores guesses, installs new lists, reveals the old ones and skips the pact', () => {
    const { map, state } = setup();
    const { next, report } = resolveTurn(state, [submission(0, 1), submission(1, 0)], {
      seed: 'seed-t',
      map,
      rules,
    });
    expect(report.pacts).toEqual([]);
    expect(report.tiers).toHaveLength(2);
    expect(report.tiers[0].guesses[0].score).toBe(12);
    expect(report.tiers[0].revealed).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(report.revealedTopic).toBe(topicForTurn('seed-t', 0).title);
    expect(next.tiersLists[0]?.items).toEqual(['1', '2', '3', '4', '5', '6']);
    // Pact bookkeeping untouched → pact-based victories can never fire.
    expect(next.pactPartner).toEqual([null, null]);
    expect(next.pactStreak).toEqual([0, 0]);
  });

  it('is deterministic and order-independent', () => {
    const { map, state } = setup();
    const context = { seed: 'seed-t', map, rules };
    const a = resolveTurn(state, [submission(0, 1), submission(1, 0)], context);
    const b = resolveTurn(state, [submission(0, 1), submission(1, 0)], context);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('pact games report an empty tiers array and a null topic', () => {
    const { map, state } = setup();
    const { report } = resolveTurn(state, [orders(0), orders(1)], {
      seed: 'seed-t',
      map,
      rules: TEST_RULES,
    });
    expect(report.tiers).toEqual([]);
    expect(report.revealedTopic).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/engine/src/contest/tiers.test.ts`
Expected: FAIL — `report.tiers` does not exist.

- [ ] **Step 3: Implement**

`packages/engine/src/types.ts` — `TurnReport` gains, after `pacts`:

```ts
  /** Tiers outcomes; empty in pact games. */
  tiers: TiersResult[];
  /** Topic of the lists revealed this turn; null in pact games. */
  revealedTopic: string | null;
```

`packages/engine/src/orders.ts`:

- `NormalizedOrders` gains `tiers: TiersOrders | null;` (import the type).
- In `normalizeOrders`, the `normalized` literal gains `tiers: raw?.tiers ?? null,`.

`packages/engine/src/resolve.ts`:

- Imports: add `resolveTiers`, `applyTiersRecord` from `./contest/tiers.js`; `topicForTurn` from `./contest/topics.js`; type `TiersResult` from `./types.js`.
- Phase 1's inactive-slot placeholder gains `tiers: null`:

```ts
orders.push({ slot, pledge: null, deploys: [], moves: [], supports: [], tiers: null });
```

- Phase 4 becomes a dispatch (replace the `const pact = resolvePacts(...)` statement):

```ts
const attacked = buildAttackMatrix(state, orders);
const aliveSlots: Slot[] = [];
for (let slot = 0; slot < state.playerCount; slot++) {
  if (state.status[slot] === 'active') aliveSlots.push(slot);
}
const contestContext = { attacked, aliveSlots };
const tiersInputs = orders.map((set) => set.tiers);
const pact =
  rules.contest === 'tiers'
    ? null
    : resolvePacts(
        state,
        orders.map((set) => set.pledge),
        contestContext,
      );
const tiers = rules.contest === 'tiers' ? resolveTiers(state, tiersInputs, contestContext) : null;
// Whichever contest ran, this is the multiplier/bonus surface the battles use.
const contest = (pact ?? tiers)!;
```

- Replace every remaining `pact.multiplier[...]` with `contest.multiplier[...]` (two in the clash phase, one in Phase 8) and `pact.results`/`pact.bonusIncome` handling in Phase 9 with:

```ts
if (pact !== null) applyPactRecord(next, pact.results);
if (tiers !== null) applyTiersRecord(next, tiersInputs, seed, state.turn);
for (let slot = 0; slot < next.playerCount; slot++) {
  next.pendingBonusIncome[slot] += contest.bonusIncome[slot];
}
```

- The report literal gains:

```ts
    pacts: pact?.results ?? [],
    tiers: tiers?.results ?? [],
    revealedTopic: tiers === null ? null : topicForTurn(seed, state.turn - 1).title,
```

- `buildHeadline` takes the tiers results after `pacts` (`tiersResults: readonly TiersResult[]`), and after the betrayal branch add:

```ts
// The best read of the turn is the tiers analogue of a betrayal headline.
const reads = tiersResults
  .flatMap((result) => (result.bestRead === null ? [] : [result.bestRead]))
  .sort((a, b) => b.score - a.score || a.guesser - b.guesser);
if (reads.length > 0 && reads[0].score >= 10) {
  return `Turn ${turn} — player ${reads[0].guesser} read player ${reads[0].target} like a book`;
}
```

Update the call site: `buildHeadline(state.turn, pact?.results ?? [], tiers?.results ?? [], battles, clashes, world)`.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/engine` — expected: PASS, including the existing shuffle-invariance property test in `resolve.test.ts` (any failure there means the dispatch broke purity — stop and fix).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src
git commit -m "feat(engine): dispatch the tiers contest through turn resolution"
```

---

### Task 6: Bot lists and guesses; tiers bot games

**Files:**

- Modify: `packages/engine/src/contest/tiers.ts` (bot helpers)
- Modify: `packages/engine/src/simulate.ts`
- Modify: `packages/engine/src/index.ts` (add `decideTiersList`, `decideTiersOrders` to the Task 4 export block)
- Create: `packages/engine/src/simulate-tiers.test.ts`

**Interfaces:**

- Consumes: `TiersTopic` (canned popularity order), `makeTiersList`, redacted-state semantics (rival lists are public-order + identity shuffle).
- Produces: `decideTiersList(topic: TiersTopic, rng: Rng): string[]`; `decideTiersOrders(state: GameState, slot: Slot, writeTopic: TiersTopic, prevTopic: TiersTopic, rng: Rng): TiersOrders`. Server Task 9 calls both with substreams `substream(seed, 'tiers-bot-list', slot)` (lobby) and `substream(seed, turn, 'tiers-bot', slot)` (in-game) — the simulate harness must use the same substream names.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/simulate-tiers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { rulesFor } from './constants.js';
import { playBotGame } from './simulate.js';

describe('bot games under the tiers contest', () => {
  it('terminate, score reads, and never touch pact state', () => {
    for (const playerCount of [2, 4, 6]) {
      const summary = playBotGame({
        seed: `tiers-${playerCount}`,
        playerCount,
        rules: rulesFor(playerCount, 25, 'tiers'),
        keepHistory: true,
      });
      expect(summary.result.kind).not.toBe('condominium');
      expect(summary.result.kind).not.toBe('concordat');
      expect(summary.turns).toBeLessThanOrEqual(25);
      const reports = summary.history ?? [];
      expect(reports.length).toBeGreaterThan(0);
      // Turn 1 already scores: lobby lists exist, bots guess from the start.
      const scored = reports[0].tiers.flatMap((r) => r.guesses);
      expect(scored.length).toBeGreaterThan(0);
      // Popularity-order bots read each other well: multipliers actually move.
      const multipliers = reports.flatMap((r) => r.tiers.map((t) => t.multiplier));
      expect(multipliers.some((m) => m !== 100)).toBe(true);
      expect(Math.min(...multipliers)).toBeGreaterThanOrEqual(80);
      expect(Math.max(...multipliers)).toBeLessThanOrEqual(140);
      expect(summary.finalState.pactsHonored.every((n) => n === 0)).toBe(true);
    }
  });

  it('short-cap tiers games still end decisively or on standings', () => {
    const summary = playBotGame({
      seed: 'tiers-short',
      playerCount: 4,
      rules: rulesFor(4, 15, 'tiers'),
    });
    expect(summary.turns).toBeLessThanOrEqual(15);
    expect(summary.result.winners.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/engine/src/simulate-tiers.test.ts`
Expected: FAIL — no lobby lists installed, `reports[0].tiers` guesses empty.

- [ ] **Step 3: Implement the bot helpers**

Append to `packages/engine/src/contest/tiers.ts` (imports: `Rng` type from `../rng.js`, `TiersTopic` from `./topics.js`):

```ts
/**
 * A bot's list: the topic's canned items in popularity order, lightly
 * perturbed. Mostly-predictable on purpose — an attentive human can learn that
 * bots follow the obvious order, which keeps guessing bots from being a pure
 * gamble and keeps bot-vs-bot games from going inert.
 */
export function decideTiersList(topic: TiersTopic, rng: Rng): string[] {
  const items = topic.canned.slice(0, TIERS_LIST_SIZE);
  const swaps = rng.int(3);
  for (let i = 0; i < swaps; i++) {
    const at = rng.int(TIERS_LIST_SIZE - 1);
    const tmp = items[at];
    items[at] = items[at + 1];
    items[at + 1] = tmp;
  }
  return items;
}

/**
 * A bot's full tiers input. Guesses assume the author ranked by popularity —
 * right about other bots, and the "consensus" read against humans. Expects the
 * bot's *redacted* view, where rival items arrive in public order.
 */
export function decideTiersOrders(
  state: GameState,
  slot: Slot,
  writeTopic: TiersTopic,
  prevTopic: TiersTopic,
  rng: Rng,
): TiersOrders {
  const popularity = new Map(prevTopic.canned.map((item, rank) => [normalizeItemText(item), rank]));

  const targets: Slot[] = [];
  for (let other = 0; other < state.playerCount; other++) {
    if (other !== slot && state.status[other] === 'active' && state.tiersLists[other] !== null) {
      targets.push(other);
    }
  }

  const guesses: TiersGuess[] = rng
    .shuffle(targets)
    .slice(0, TIERS_MAX_GUESSES)
    .map((target) => {
      const items = state.tiersLists[target]!.items;
      const order = Array.from({ length: TIERS_LIST_SIZE }, (_, position) => position).sort(
        (a, b) =>
          (popularity.get(normalizeItemText(items[a])) ?? TIERS_LIST_SIZE) -
            (popularity.get(normalizeItemText(items[b])) ?? TIERS_LIST_SIZE) || a - b,
      );
      return { target, order };
    });

  return { list: decideTiersList(writeTopic, rng), guesses };
}
```

- [ ] **Step 4: Wire the simulate harness**

`packages/engine/src/simulate.ts`:

- Imports: `decideTiersList`, `decideTiersOrders`, `makeTiersList` from `./contest/tiers.js`; `topicForTurn` from `./contest/topics.js`.
- After `let state = createInitialState(map, rules);`:

```ts
if (rules.contest === 'tiers') {
  // The lobby ("turn 0") lists, so turn 1 already has something to guess.
  for (let slot = 0; slot < playerCount; slot++) {
    state.tiersLists[slot] = makeTiersList(
      decideTiersList(topicForTurn(seed, 0), substream(seed, 'tiers-bot-list', slot)),
      seed,
      0,
      slot,
    );
  }
}
```

- In the turn loop, replace `submissions.push(decideOrders(view, map, slot, rng, personalities[slot]));` with:

```ts
const orderSet = decideOrders(view, map, slot, rng, personalities[slot]);
if (rules.contest === 'tiers') {
  orderSet.tiers = decideTiersOrders(
    view,
    slot,
    topicForTurn(seed, state.turn),
    topicForTurn(seed, state.turn - 1),
    substream(seed, state.turn, 'tiers-bot', slot),
  );
}
submissions.push(orderSet);
```

- Add `decideTiersList`/`decideTiersOrders` to the engine `index.ts` export block from Task 4.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run packages/engine` — expected: PASS (pact-game simulate tests must be byte-identical to before: the tiers branch never executes for them).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src
git commit -m "feat(engine): popularity-order bots for the tiers contest"
```

---

### Task 7: Server creation options and view fields

**Files:**

- Modify: `packages/server/src/api-types.ts`
- Modify: `packages/server/src/store.ts` (`parseState` hydration)
- Modify: `packages/server/src/games.ts` (`createGame`, `getView`)
- Create: `packages/server/src/tiers.test.ts`

**Interfaces:**

- Consumes: `MIN_TURN_CAP`, `MAX_TURN_CAP`, `rulesFor`, `topicForTurn`, `ContestKind` from `@www/engine`.
- Produces: `CreateGameRequest` gains `contest?: ContestKind; turnCap?: number`. `GameView` gains `contest: ContestKind; turnCap: number; tiersTopic: string | null; lobbyListSlots: number[]`. `parseState` hydrates `tiersLists` on states stored before this feature. Web tasks consume these exact field names.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/tiers.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { emulatorDb, clearFirestore } from './testing.js';
import { games } from './store.js';
import { createGame, getView, HttpError, type AuthedUser } from './games.js';

const alice: AuthedUser = { uid: 'u-alice', name: 'Alice', email: 'alice@test.dev' };

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('tiers game creation', () => {
  const db = emulatorDb();
  beforeEach(clearFirestore);

  it('creates a tiers game with a custom cap and shows the lobby topic', async () => {
    const id = await createGame(db, alice, {
      playerCount: 4,
      turnMinutes: 60,
      contest: 'tiers',
      turnCap: 15,
    });
    const view = await getView(db, id, alice);
    expect(view.contest).toBe('tiers');
    expect(view.turnCap).toBe(15);
    expect(view.tiersTopic).not.toBeNull();
    expect(view.lobbyListSlots).toEqual([]);
    const rules = (await games(db).doc(id).get()).get('rules') as { turnCap: number };
    expect(rules.turnCap).toBe(15);
  });

  it('defaults to pact at 25 turns', async () => {
    const id = await createGame(db, alice, { playerCount: 4, turnMinutes: 60 });
    const view = await getView(db, id, alice);
    expect(view.contest).toBe('pact');
    expect(view.turnCap).toBe(25);
    expect(view.tiersTopic).toBeNull();
  });

  it('rejects bad caps and contests', async () => {
    await expect(
      createGame(db, alice, { playerCount: 4, turnMinutes: 60, turnCap: 9 }),
    ).rejects.toThrow(HttpError);
    await expect(
      createGame(db, alice, { playerCount: 4, turnMinutes: 60, turnCap: 51 }),
    ).rejects.toThrow(HttpError);
    await expect(
      createGame(db, alice, {
        playerCount: 4,
        turnMinutes: 60,
        contest: 'dice' as never,
      }),
    ).rejects.toThrow(HttpError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:server` — expected: the new file FAILS (`contest` not on `CreateGameRequest`), existing server tests PASS.

- [ ] **Step 3: Implement**

`packages/server/src/api-types.ts`:

- Extend the engine type import with `ContestKind`.
- `CreateGameRequest` gains:

```ts
  /** Which social contest runs; defaults to 'pact'. */
  contest?: ContestKind;
  /** Game length in turns; defaults to 25. */
  turnCap?: number;
```

- `GameView` gains, after `turnMinutes`:

```ts
  contest: ContestKind;
  turnCap: number;
  /** Topic for the list being written now (lobby list in lobby); null in pact games. */
  tiersTopic: string | null;
  /** Seats that have submitted their lobby list; [] outside a tiers lobby. */
  lobbyListSlots: number[];
```

- Add a request type:

```ts
export interface SubmitLobbyListRequest {
  list: string[];
}
```

`packages/server/src/store.ts` — hydrate old states (extend the engine type import with `TiersList`):

```ts
export const parseState = (doc: GameDoc): GameState | null => {
  if (doc.stateJson === null) return null;
  const state = JSON.parse(doc.stateJson) as GameState;
  // Games stored before the tiers contest lack the field.
  state.tiersLists ??= new Array<TiersList | null>(state.playerCount).fill(null);
  return state;
};
```

`packages/server/src/games.ts`:

- Extend engine imports with `MAX_TURN_CAP`, `MIN_TURN_CAP`, `topicForTurn` (and later tasks' names as they arrive).
- In `createGame`, after the `turnMinutes` check:

```ts
const contest = req.contest ?? 'pact';
if (contest !== 'pact' && contest !== 'tiers') {
  throw new HttpError(400, "contest must be 'pact' or 'tiers'");
}
const turnCap = req.turnCap ?? 25;
if (!Number.isInteger(turnCap) || turnCap < MIN_TURN_CAP || turnCap > MAX_TURN_CAP) {
  throw new HttpError(400, `turnCap must be an integer in [${MIN_TURN_CAP}, ${MAX_TURN_CAP}]`);
}
```

and change the doc's rules line to `rules: rulesFor(playerCount, turnCap, contest),`.

- In `getView`, before the return (old docs lack `rules.contest`, hence the `?? 'pact'`):

```ts
const contest = game.rules.contest ?? 'pact';
let tiersTopic: string | null = null;
let lobbyListSlots: number[] = [];
if (contest === 'tiers') {
  tiersTopic = topicForTurn(game.seed, game.status === 'lobby' ? 0 : game.turn).title;
  if (game.status === 'lobby') {
    const humans = humanSlots(game.seats);
    if (humans.length > 0) {
      const snaps = await db.getAll(
        ...humans.map((slot) => ordersCol(db, gameId).doc(orderDocId(0, slot))),
      );
      lobbyListSlots = humans.filter((_, i) => snaps[i].exists);
    }
  }
}
```

and add to the returned literal: `contest`, `turnCap: game.rules.turnCap`, `tiersTopic`, `lobbyListSlots`.

Note the existing test `games.test.ts` asserts the view never contains the seed — `tiersTopic` is a title, not the seed, so it stays green.

- [ ] **Step 4: Run tests**

Run: `pnpm test:server` — expected: PASS. `pnpm typecheck` — expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src
git commit -m "feat(server): tiers/turn-cap creation options and view fields"
```

---

### Task 8: Lobby lists and activation gating

**Files:**

- Modify: `packages/server/src/games.ts` (`activate`, `joinGame`, `startGame`, new `submitLobbyList`)
- Modify: `packages/server/src/app.ts` (route)
- Modify: `packages/server/src/tiers.test.ts`

**Interfaces:**

- Consumes: `makeTiersList`, `normalizeTiersList`, `decideTiersList`, `topicForTurn`, `substream` from `@www/engine`; `orderDocId(0, slot)` as the lobby-list document.
- Produces: `submitLobbyList(db, gameId, user, listRaw): Promise<GameView>`; route `PUT /api/games/:id/lobby-list` with body `SubmitLobbyListRequest`. Activation rule: **a game activates only when every seat is filled AND (pact game, or every human seat has a valid lobby list)**. Bot lobby lists come from `decideTiersList(topicForTurn(seed, 0), substream(seed, 'tiers-bot-list', slot))` — identical to the simulate harness.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/tiers.test.ts` (extend imports with `joinGame`, `startGame`, `submitLobbyList`):

```ts
const LIST = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
const LIST2 = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
const bob: AuthedUser = { uid: 'u-bob', name: 'Bob', email: 'bob@test.dev' };

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('tiers lobby lists', () => {
  const db = emulatorDb();
  beforeEach(clearFirestore);

  const makeGame = () =>
    createGame(db, alice, { playerCount: 2, turnMinutes: 60, contest: 'tiers' });

  it('a full table does not start until every human list is in', async () => {
    const id = await makeGame();
    let view = await joinGame(db, id, bob);
    expect(view.status).toBe('lobby'); // seats full, lists missing
    view = await submitLobbyList(db, id, alice, LIST);
    expect(view.status).toBe('lobby');
    expect(view.lobbyListSlots).toEqual([0]);
    view = await submitLobbyList(db, id, bob, LIST2);
    expect(view.status).toBe('active'); // last list activates
    expect(view.state).not.toBeNull();
    // Both lobby lists are installed and redacted for the viewer (bob sees his own order).
    expect(view.state?.tiersLists.filter((l) => l !== null)).toHaveLength(2);
    expect(view.state?.tiersLists[1]?.items).toEqual(LIST2);
  });

  it('start-with-bots fills bot lists but insists on human lists', async () => {
    const id = await createGame(db, alice, { playerCount: 3, turnMinutes: 60, contest: 'tiers' });
    await expect(startGame(db, id, alice)).rejects.toMatchObject({ statusCode: 409 });
    await submitLobbyList(db, id, alice, LIST);
    const view = await startGame(db, id, alice);
    expect(view.status).toBe('active');
    expect(view.state?.tiersLists.every((l) => l !== null)).toBe(true);
  });

  it('rejects malformed lists, non-tiers games and started games', async () => {
    const id = await makeGame();
    await expect(
      submitLobbyList(db, id, alice, ['only', 'five', 'items', 'in', 'list']),
    ).rejects.toMatchObject({ statusCode: 400 });
    const pactId = await createGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await expect(submitLobbyList(db, pactId, alice, LIST)).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(submitLobbyList(db, id, bob, LIST)).rejects.toMatchObject({ statusCode: 403 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:server` — expected: new block FAILS (`submitLobbyList` missing).

- [ ] **Step 3: Implement in `games.ts`**

Add helpers (near `activate`):

```ts
/** Lobby ("turn 0") lists per slot, read inside a transaction before any writes. */
async function readLobbyLists(
  tx: FirebaseFirestore.Transaction,
  db: Firestore,
  gameId: string,
  game: GameDoc,
): Promise<(string[] | null)[]> {
  const lists: (string[] | null)[] = new Array(game.playerCount).fill(null);
  if ((game.rules.contest ?? 'pact') !== 'tiers') return lists;
  const humans = humanSlots(game.seats);
  if (humans.length === 0) return lists;
  const snaps = await tx.getAll(
    ...humans.map((slot) => ordersCol(db, gameId).doc(orderDocId(0, slot))),
  );
  snaps.forEach((snap, i) => {
    if (!snap.exists) return;
    const set = JSON.parse((snap.data() as OrderDoc).ordersJson) as OrderSet;
    lists[humans[i]] = set.tiers?.list ?? null;
  });
  return lists;
}

function canActivate(game: GameDoc, lobbyLists: readonly (string[] | null)[]): boolean {
  if (!game.seats.every((seat) => seat !== null)) return false;
  if ((game.rules.contest ?? 'pact') !== 'tiers') return true;
  // A seat is not ready until its first list is in.
  return humanSlots(game.seats).every((slot) => normalizeTiersList(lobbyLists[slot]) !== null);
}
```

Extend `activate` to install lists:

```ts
function activate(doc: GameDoc, now: Timestamp, lobbyLists: readonly (string[] | null)[]): void {
  doc.status = 'active';
  const map = parseMap(doc);
  const state = createInitialState(map, doc.rules);
  if ((doc.rules.contest ?? 'pact') === 'tiers') {
    for (let slot = 0; slot < doc.playerCount; slot++) {
      const raw = doc.seats[slot]?.isBot
        ? decideTiersList(topicForTurn(doc.seed, 0), substream(doc.seed, 'tiers-bot-list', slot))
        : lobbyLists[slot];
      state.tiersLists[slot] = makeTiersList(raw, doc.seed, 0, slot);
    }
  }
  doc.stateJson = serializeState(state);
  doc.deadlineAt = Timestamp.fromMillis(now.toMillis() + doc.turnMinutes * 60_000);
}
```

Update the two call sites:

- `joinGame`: read `const lobbyLists = await readLobbyLists(tx, db, gameId, game);` right after the game snapshot (reads must precede writes), then replace `if (game.seats.every((s) => s !== null)) activate(game, Timestamp.now());` with `if (canActivate(game, lobbyLists)) activate(game, Timestamp.now(), lobbyLists);`.
- `startGame`: read `lobbyLists` the same way; after filling bot seats, add

```ts
if (!canActivate(game, lobbyLists)) {
  throw new HttpError(409, 'waiting for tier lists from seated players');
}
activate(game, Timestamp.now(), lobbyLists);
```

Add the new service function:

```ts
export async function submitLobbyList(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
  listRaw: unknown,
): Promise<GameView> {
  const list = normalizeTiersList(listRaw);
  if (list === null) {
    throw new HttpError(400, 'list must be six distinct, non-empty entries');
  }
  const doc = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'game not found');
    const game = snap.data() as GameDoc;
    if ((game.rules.contest ?? 'pact') !== 'tiers') {
      throw new HttpError(409, 'this game has no tier lists');
    }
    if (game.status !== 'lobby') throw new HttpError(409, 'game already started');
    const mySlot = slotOf(game, user.uid);
    if (mySlot === null) throw new HttpError(403, 'not seated in this game');

    const lobbyLists = await readLobbyLists(tx, db, gameId, game);
    lobbyLists[mySlot] = list;

    tx.set(ordersCol(db, gameId).doc(orderDocId(0, mySlot)), {
      ordersJson: JSON.stringify({
        slot: mySlot,
        pledge: null,
        deploys: [],
        units: [],
        tiers: { list, guesses: [] },
      } satisfies OrderSet),
      locked: true,
      updatedAt: Timestamp.now(),
    } satisfies OrderDoc);

    if (canActivate(game, lobbyLists)) {
      activate(game, Timestamp.now(), lobbyLists);
      tx.set(games(db).doc(gameId), game);
    }
    return game;
  });
  return getView(db, gameId, user, doc);
}
```

(Extend the engine import list with `decideTiersList`, `makeTiersList`, `normalizeTiersList`, `substream`, `topicForTurn`, and the `OrderSet`-related types as needed. `getView(db, gameId, user, doc)` receives the pre-activation copy only when activation did not run inside the transaction — when it did, `doc` was mutated in place by `activate`, so the view is current either way.)

- [ ] **Step 4: Add the route**

`packages/server/src/app.ts`, after the `/games/:id/start` route (extend imports with `submitLobbyList` and `SubmitLobbyListRequest`):

```ts
api.put('/games/:id/lobby-list', async (req) => {
  const { id } = req.params as { id: string };
  const { list } = req.body as SubmitLobbyListRequest;
  return submitLobbyList(db, id, req.user, list);
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm test:server` — expected: PASS, including the untouched pact-lobby tests (`auto-starts when the last seat fills` must stay green — pact games ignore the gate).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src
git commit -m "feat(server): lobby tier lists gate activation of tiers games"
```

---

### Task 9: Bot tiers orders at resolution; submit warnings

**Files:**

- Modify: `packages/server/src/resolve.ts` (bot submissions)
- Modify: `packages/server/src/games.ts` (`submitOrders` warnings)
- Modify: `packages/server/src/tiers.test.ts`

**Interfaces:**

- Consumes: `decideTiersOrders`, `topicForTurn`, `tiersWarnings` from `@www/engine`; substream names from Task 6.
- Produces: tiers games resolve end-to-end on the server; locked submissions return tier-list warnings.

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/tiers.test.ts` (extend imports with `submitOrders`, `LogMailer` from `./mailer.js`, `reportsCol` from `./store.js`, and `TurnReport` type from `@www/engine`):

```ts
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('tiers turn resolution', () => {
  const db = emulatorDb();
  const mailer = new LogMailer();
  beforeEach(clearFirestore);

  it('resolves a human-vs-bot tiers turn with scored guesses in the report', async () => {
    const id = await createGame(db, alice, { playerCount: 2, turnMinutes: 60, contest: 'tiers' });
    await submitLobbyList(db, id, alice, LIST);
    const view = await startGame(db, id, alice);
    expect(view.status).toBe('active');
    // The bot's lobby list is guessable: reorder its public items as shown.
    const botList = view.state?.tiersLists[1];
    expect(botList).not.toBeNull();

    const res = await submitOrders(db, mailer, 'http://x', id, alice, {
      orders: {
        slot: 0,
        pledge: null,
        deploys: [],
        units: [],
        tiers: { list: LIST2, guesses: [{ target: 1, order: [0, 1, 2, 3, 4, 5] }] },
      },
      locked: true,
    });
    expect(res.resolved).toBe(true);
    const report = JSON.parse(
      (await reportsCol(db, id).doc('1').get()).get('reportJson') as string,
    ) as TurnReport;
    expect(report.tiers.length).toBeGreaterThan(0);
    expect(report.tiers[0].guesses[0]?.target).toBe(1);
    expect(report.revealedTopic).not.toBeNull();
    // The human's new list is installed for turn 2.
    expect(res.view.state?.tiersLists[0]?.items).toEqual(LIST2);
  });

  it('warns on a locked submission with a broken tier list', async () => {
    const id = await createGame(db, alice, { playerCount: 3, turnMinutes: 60, contest: 'tiers' });
    await submitLobbyList(db, id, alice, LIST);
    await startGame(db, id, alice);
    const res = await submitOrders(db, mailer, 'http://x', id, alice, {
      orders: { slot: 0, pledge: null, deploys: [], units: [] },
      locked: true,
    });
    expect(res.warnings.some((w) => w.includes('tier list'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:server` — expected: first test FAILS (bot submits no tiers input, so `report.tiers[0].guesses` may exist but the human's guess of the bot works — the decisive failure is the second test: no warnings; and in the first, `resolved` succeeds but bot lists never refresh. Treat any red as the signal).

- [ ] **Step 3: Implement**

`packages/server/src/resolve.ts` — extend the engine import with `decideTiersOrders` and `topicForTurn`; in the bot loop, replace the `submissions[slot] = decideOrders(...)` statement with:

```ts
const view = redact(state, slot);
const orderSet = decideOrders(
  view,
  map,
  slot,
  substream(game.seed, 'bot', expectedTurn, slot),
  personality,
);
if ((game.rules.contest ?? 'pact') === 'tiers') {
  orderSet.tiers = decideTiersOrders(
    view,
    slot,
    topicForTurn(game.seed, expectedTurn),
    topicForTurn(game.seed, expectedTurn - 1),
    substream(game.seed, expectedTurn, 'tiers-bot', slot),
  );
}
submissions[slot] = orderSet;
```

`packages/server/src/games.ts` — in `submitOrders`, after the `rejections` line (extend imports with `tiersWarnings`):

```ts
if ((game.rules.contest ?? 'pact') === 'tiers' && req.locked) {
  // Only on lock-in: warning about a half-typed list on every autosave is noise.
  rejections.push(...tiersWarnings(state, mySlot, orders.tiers ?? null));
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:server` — expected: PASS. `pnpm typecheck && pnpm lint` — expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src
git commit -m "feat(server): bot tiers orders at resolution and lock-in warnings"
```

---

### Task 10: Web — API client and creation form

**Files:**

- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/pages/Home.tsx`

**Interfaces:**

- Consumes: `CreateGameRequest`/`SubmitLobbyListRequest` (Task 7/8), route from Task 8.
- Produces: `api.submitLobbyList(id, list)`; Home sends `contest` and `turnCap`.

- [ ] **Step 1: Extend the API client**

`packages/web/src/api.ts` — add to the `api` object:

```ts
  submitLobbyList: (id: string, list: string[]) =>
    apiFetch<GameView>('PUT', `/api/games/${id}/lobby-list`, { list }),
```

- [ ] **Step 2: Extend the creation form**

`packages/web/src/pages/Home.tsx`:

- Add below `TURN_LENGTHS`:

```ts
const GAME_LENGTHS: [label: string, turns: number][] = [
  ['Short — 15 turns', 15],
  ['Standard — 25 turns', 25],
  ['Long — 35 turns', 35],
];
```

- Add state: `const [contest, setContest] = useState<'pact' | 'tiers'>('pact');` and `const [turnCap, setTurnCap] = useState(25);`
- Change the create call to `api.createGame({ playerCount, turnMinutes, contest, turnCap })`.
- Add two labelled selects in the form row, matching the existing markup style:

```tsx
          <label>
            Contest{' '}
            <select
              value={contest}
              onChange={(e) => setContest(e.target.value as 'pact' | 'tiers')}
            >
              <option value="pact">Pact — pledge &amp; betray</option>
              <option value="tiers">Tiers — read your rivals</option>
            </select>
          </label>
          <label>
            Game length{' '}
            <select value={turnCap} onChange={(e) => setTurnCap(Number(e.target.value))}>
              {GAME_LENGTHS.map(([label, turns]) => (
                <option key={turns} value={turns}>
                  {label}
                </option>
              ))}
            </select>
          </label>
```

- [ ] **Step 3: Verify and commit**

Run: `pnpm typecheck && pnpm lint` — expected: clean.

```bash
git add packages/web/src/api.ts packages/web/src/pages/Home.tsx
git commit -m "feat(web): contest and game-length creation options"
```

---

### Task 11: Web — lobby list editor

**Files:**

- Modify: `packages/web/src/pages/Lobby.tsx`
- Modify: `packages/web/src/styles.css`

**Interfaces:**

- Consumes: `view.contest`, `view.tiersTopic`, `view.lobbyListSlots` (Task 7), `api.submitLobbyList` (Task 10), `normalizeTiersList` from `@www/engine` for client-side validation.
- Produces: the lobby collects the turn-0 list; per-seat "list in" badges; the start button reflects the gate.

- [ ] **Step 1: Implement**

Rewrite `packages/web/src/pages/Lobby.tsx` to add the editor (existing behavior preserved):

```tsx
import { useState } from 'react';
import type { GameView } from '@www/server/api-types';
import { TIERS_LIST_SIZE, normalizeTiersList } from '@www/engine';

import { api, ApiError } from '../api.js';
import { playerColor } from '../format.js';

const TIER_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

interface Props {
  view: GameView;
  onChanged: () => Promise<unknown>;
}

export function Lobby({ view, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<string[]>(new Array<string>(TIERS_LIST_SIZE).fill(''));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  };

  const openSeats = view.seats.filter((s) => !s.taken).length;
  const isTiers = view.contest === 'tiers';
  const myListIn = view.mySlot !== null && view.lobbyListSlots.includes(view.mySlot);
  const listValid = normalizeTiersList(list) !== null;
  const humansMissing = view.seats.filter(
    (s) => s.taken && !s.isBot && !view.lobbyListSlots.includes(s.slot),
  ).length;

  return (
    <main className="panel">
      <h2>
        Lobby — {view.playerCount - openSeats}/{view.playerCount} seated
      </h2>
      <ul className="seat-list">
        {view.seats.map((seat) => (
          <li key={seat.slot} className="seat">
            <span className="seat-dot" style={{ background: playerColor(seat.slot) }} />
            {seat.taken ? (
              <span>
                {seat.name}
                {seat.isBot ? ' (bot)' : ''}
                {seat.slot === view.mySlot ? ' — you' : ''}
                {isTiers && !seat.isBot && (
                  <span className={view.lobbyListSlots.includes(seat.slot) ? 'concord' : 'muted'}>
                    {view.lobbyListSlots.includes(seat.slot) ? ' ✓ list in' : ' — writing list'}
                  </span>
                )}
              </span>
            ) : (
              <span className="muted">open seat</span>
            )}
          </li>
        ))}
      </ul>

      {isTiers && view.mySlot !== null && (
        <div className="tiers-editor">
          <h3>Your first tier list — {view.tiersTopic}</h3>
          <p className="muted">
            Rank honestly, A best to F worst. Rivals will try to guess your order — being readable
            pays you both.
          </p>
          {TIER_LABELS.map((label, i) => (
            <label key={label} className="tier-row">
              <span className="tier-label">{label}</span>
              <input
                value={list[i]}
                disabled={busy || myListIn}
                onChange={(e) => setList(list.map((v, j) => (j === i ? e.target.value : v)))}
              />
            </label>
          ))}
          {!myListIn ? (
            <button
              disabled={busy || !listValid}
              onClick={() => void run(() => api.submitLobbyList(view.id, list))}
            >
              Submit list
            </button>
          ) : (
            <p className="concord">List submitted — waiting on the rest of the table.</p>
          )}
        </div>
      )}

      <p className="muted">Invite friends by sharing this page&rsquo;s URL.</p>
      {error !== null && <p className="error">{error}</p>}

      <div className="form-row">
        {view.mySlot === null && openSeats > 0 && (
          <button disabled={busy} onClick={() => void run(() => api.join(view.id))}>
            Take a seat
          </button>
        )}
        {view.mySlot === 0 && (
          <button
            disabled={busy || (isTiers && humansMissing > 0)}
            title={
              isTiers && humansMissing > 0
                ? 'waiting for tier lists from seated players'
                : undefined
            }
            onClick={() => void run(() => api.start(view.id))}
          >
            Start now — fill empty seats with bots
          </button>
        )}
      </div>
    </main>
  );
}
```

Note the start button now renders whenever the viewer is the creator (not only with open seats): in a tiers game a full table still waits on lists, and the creator may need to start once they arrive. `api.start` on a full pact table was previously unreachable; the server accepts it (activation is idempotent by status check), so this is safe.

Add to `packages/web/src/styles.css`:

```css
.tiers-editor {
  margin: 1rem 0;
}
.tier-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.25rem 0;
}
.tier-label {
  width: 1.5rem;
  font-weight: 700;
  text-align: center;
}
.tier-row input {
  flex: 1;
}
.guess-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.15rem 0;
}
.guess-item .spacer {
  flex: 1;
}
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck && pnpm lint`.

```bash
git add packages/web/src/pages/Lobby.tsx packages/web/src/styles.css
git commit -m "feat(web): lobby tier-list editor and readiness badges"
```

---

### Task 12: Web — Tiers panel (write + guess)

**Files:**

- Create: `packages/web/src/game/TiersPanel.tsx`
- Modify: `packages/web/src/game/OrdersPanel.tsx` (gate the pledge UI)
- Modify: `packages/web/src/pages/Game.tsx` (draft init + render)

**Interfaces:**

- Consumes: `draft.tiers` (`TiersOrders`), redacted `state.tiersLists` (public order + identity shuffle), `view.tiersTopic`, `TIERS_MAX_GUESSES`.
- Produces: a panel that edits `draft.tiers.list` and `draft.tiers.guesses` in place via `onDraftChange`, autosaved by Game.tsx's existing debounce.

- [ ] **Step 1: Create the panel**

`packages/web/src/game/TiersPanel.tsx`:

```tsx
import type { GameView } from '@www/server/api-types';
import type { GameState, OrderSet, TiersGuess, TiersOrders } from '@www/engine';
import { TIERS_LIST_SIZE, TIERS_MAX_GUESSES } from '@www/engine';

import { playerColor } from '../format.js';

const TIER_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

export const emptyTiers = (): TiersOrders => ({
  list: new Array<string>(TIERS_LIST_SIZE).fill(''),
  guesses: [],
});

interface Props {
  view: GameView;
  state: GameState;
  draft: OrderSet;
  onDraftChange: (draft: OrderSet) => void;
}

export function TiersPanel({ view, state, draft, onDraftChange }: Props) {
  const mySlot = view.mySlot;
  if (mySlot === null) return null;
  const locked = view.myLocked;
  const tiers = draft.tiers ?? emptyTiers();

  const change = (next: TiersOrders) => onDraftChange({ ...draft, tiers: next });

  const setEntry = (i: number, value: string) =>
    change({ ...tiers, list: tiers.list.map((v, j) => (j === i ? value : v)) });

  const guessOn = (target: number) => tiers.guesses.find((g) => g.target === target);

  const toggleGuess = (target: number) => {
    const existing = guessOn(target);
    if (existing) {
      change({ ...tiers, guesses: tiers.guesses.filter((g) => g.target !== target) });
      return;
    }
    if (tiers.guesses.length >= TIERS_MAX_GUESSES) return;
    const order = Array.from({ length: TIERS_LIST_SIZE }, (_, i) => i);
    change({ ...tiers, guesses: [...tiers.guesses, { target, order }] });
  };

  const moveItem = (guess: TiersGuess, tier: number, delta: number) => {
    const swapWith = tier + delta;
    if (swapWith < 0 || swapWith >= TIERS_LIST_SIZE) return;
    const order = guess.order.slice();
    const tmp = order[tier];
    order[tier] = order[swapWith];
    order[swapWith] = tmp;
    change({
      ...tiers,
      guesses: tiers.guesses.map((g) => (g.target === guess.target ? { ...g, order } : g)),
    });
  };

  const guessables = view.seats.filter(
    (s) =>
      s.slot !== mySlot && state.status[s.slot] === 'active' && state.tiersLists[s.slot] !== null,
  );

  return (
    <aside className="orders">
      <div className="tiers-editor">
        <h3>Your tier list — {view.tiersTopic}</h3>
        {TIER_LABELS.map((label, i) => (
          <label key={label} className="tier-row">
            <span className="tier-label">{label}</span>
            <input
              value={tiers.list[i] ?? ''}
              disabled={locked}
              onChange={(e) => setEntry(i, e.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="tiers-editor">
        <h3>
          Read your rivals ({tiers.guesses.length}/{TIERS_MAX_GUESSES})
        </h3>
        <p className="muted hint">
          Reorder a rival&rsquo;s items as you think THEY ranked them. A good read pays you both; a
          wild one costs you.
        </p>
        {guessables.length === 0 && <p className="muted">Nobody has a readable list.</p>}
        {guessables.map((seat) => {
          const guess = guessOn(seat.slot);
          const items = state.tiersLists[seat.slot]?.items ?? [];
          return (
            <div key={seat.slot}>
              <button
                className={guess ? 'pledge-btn pledge-on' : 'pledge-btn'}
                disabled={locked || (!guess && tiers.guesses.length >= TIERS_MAX_GUESSES)}
                onClick={() => toggleGuess(seat.slot)}
              >
                <span className="seat-dot" style={{ background: playerColor(seat.slot) }} />
                {guess ? `Reading ${seat.name}` : `Read ${seat.name}`}
              </button>
              {guess &&
                guess.order.map((position, tier) => (
                  <div key={position} className="guess-item">
                    <span className="tier-label">{TIER_LABELS[tier]}</span>
                    <span>{items[position] ?? '?'}</span>
                    <span className="spacer" />
                    <button
                      disabled={locked || tier === 0}
                      onClick={() => moveItem(guess, tier, -1)}
                    >
                      ▲
                    </button>
                    <button
                      disabled={locked || tier === TIERS_LIST_SIZE - 1}
                      onClick={() => moveItem(guess, tier, 1)}
                    >
                      ▼
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Gate the pledge UI**

`packages/web/src/game/OrdersPanel.tsx` — wrap the pledge `<div className="pledge">…</div>` block in `{view.contest === 'pact' && ( … )}`.

- [ ] **Step 3: Wire Game.tsx**

`packages/web/src/pages/Game.tsx`:

- Import `TiersPanel, { emptyTiers }`… — note `emptyTiers` is a named export: `import { TiersPanel, emptyTiers } from '../game/TiersPanel.js';`
- Draft re-seed effect: replace the `setDraft(...)` line with

```ts
const base = view.myOrders ?? emptyOrders(view.mySlot);
if (view.contest === 'tiers' && base.tiers === undefined) base.tiers = emptyTiers();
setDraft(base);
```

- Render, immediately after the `<OrdersPanel …/>` element inside the same conditional:

```tsx
<TiersPanel view={view} state={state} draft={draft} onDraftChange={changeDraft} />
```

(place it as a sibling — wrap both in a fragment `<>…</>`).

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm lint`.

```bash
git add packages/web/src/game packages/web/src/pages/Game.tsx
git commit -m "feat(web): tiers write-and-guess panel"
```

---

### Task 13: Web report section, golden-path check, balance runs

**Files:**

- Modify: `packages/web/src/game/ReportView.tsx`
- Verify: everything.

**Interfaces:**

- Consumes: `report.tiers ?? []`, `report.revealedTopic` (old stored reports lack both).

- [ ] **Step 1: Report section**

`packages/web/src/game/ReportView.tsx` — extend the engine type import with `TiersResult`; after the pacts `<ul>` add:

```tsx
{
  (report.tiers ?? []).length > 0 && (
    <div className="tiers-report">
      <h4>Tier lists revealed{report.revealedTopic ? ` — ${report.revealedTopic}` : ''}</h4>
      <ul className="report-list">
        {(report.tiers ?? []).map((t: TiersResult) => (
          <li key={`t${t.slot}`}>
            <Dot slot={t.slot} /> <strong>{seatName(t.slot)}</strong>
            {t.revealed !== null ? (
              <span className="muted"> — {t.revealed.join(' › ')}</span>
            ) : (
              <span className="muted"> — wrote no list</span>
            )}
            {t.guesses.map((g, i) => (
              <div key={i} className="muted">
                read {seatName(g.target)}: {g.score}/12
              </div>
            ))}
            {t.bestRead !== null && t.bestRead.score >= 10 && (
              <div className="concord">
                {seatName(t.bestRead.guesser)} read {seatName(t.slot)} like a book —{' '}
                {t.bestRead.score}/12
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Full verification**

- `pnpm typecheck && pnpm lint && pnpm test` — all green.
- `pnpm test:server` — all green.
- Balance sanity at three caps (PowerShell):

```powershell
pnpm exec tsx -e "import { playBotGame, rulesFor } from './packages/engine/src/index.js'; for (const cap of [15, 25, 35]) { const kinds = {}; for (let i = 0; i < 40; i++) { const s = playBotGame({ seed: 'bal-' + cap + '-' + i, playerCount: 4, rules: rulesFor(4, cap, 'tiers') }); kinds[s.kind] = (kinds[s.kind] ?? 0) + 1; if (s.turns > cap) throw new Error('overran cap'); } console.log(cap, kinds); }"
```

Expected: no cap overruns, no `condominium`/`concordat` kinds, a mix of decisive endings and `turn_cap`.

- Browser golden path (requires `pnpm dev:server` + `pnpm dev:web`): create a Tiers/Short game → lobby shows topic + editor → submit list → start with bots → turn 1 shows write panel + readable bot lists → guess one, lock → report shows reveals and scores. Verify a pact game still shows the pledge UI and no tiers panel.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/game/ReportView.tsx
git commit -m "feat(web): tiers reveals and read scores in the turn report"
```
