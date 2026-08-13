# Lobby Configuration, Game Presets, Anti-Turtle Economy & Tiers v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Game creation becomes one click on a preset card; the lobby becomes the config surface (players, fine-grained turn length and game length); all new games get an anti-turtle economy (no neutral growth, weaker neutrals, plunder on capture); Tiers v2 pays income instead of a combat multiplier — all without changing any active game.

**Architecture:** Six new fields join the engine's stored-per-game `RuleConfig`, with legacy defaults in `DEFAULT_RULES`/`rulesFor` equal to today's constants (that layer backfills old Firestore docs) and new-game values applied by a new `presetRules()` layer in `packages/engine/src/presets.ts`. The server gains a shared `effectiveRules()` helper (used at view, activation, and resolution time) plus a creator-only lobby `POST /api/games/:id/config` endpoint. The web client replaces the create form with preset cards and adds a `GameSetup` panel to the lobby.

**Tech Stack:** TypeScript monorepo (pnpm workspaces), Fastify + Firestore (server), React + Vite (web), Vitest (`// @vitest-environment jsdom` for web component tests; Firestore emulator via `pnpm test:server` for server tests).

**Spec:** `docs/superpowers/specs/2026-08-12-lobby-config-presets-design.md`

## Global Constraints

- Active/finished games must resolve byte-identically: legacy defaults are `warEconomyInterval: 5`, `neutralGrowthInterval: 3`, `neutralGarrisonDelta: 0`, `plunderIncome: 0`, `plunderCap: 3`, `tiersPayout: 'multiplier'`.
- Every preset applies the anti-turtle values: `neutralGrowthInterval: 0`, `neutralGarrisonDelta: -1`, `plunderIncome: 1`, `plunderCap: 3`.
- Preset defaults: Pact/Tiers → cap 25, 1440 min turns, `warEconomyInterval: 5`; Pact Blitz/Tiers v2 → cap 15, 60 min turns, `warEconomyInterval: 3`.
- Bounds (existing constants): players 2–12 (`MIN_PLAYERS`/`MAX_PLAYERS`), turn cap 10–50 (`MIN_TURN_CAP`/`MAX_TURN_CAP`), turn minutes 5–10080 (`MIN_TURN_MINUTES`/`MAX_TURN_MINUTES` in `games.ts`).
- The preset is immutable after creation. Only `playerCount`, `turnMinutes`, `turnCap` are lobby-editable, creator-only, lobby-status-only.
- Commands: engine/web tests `pnpm vitest run <path>`; server tests `pnpm test:server` (skipped without the emulator — never claim server tests pass from a bare `vitest` run showing "skipped"); full sweep `pnpm typecheck && pnpm test && pnpm lint`.
- Commit format: existing repo style — imperative summary line, no conventional-commit prefixes (see `git log`). End with the Claude co-author trailer.

---

### Task 1: RuleConfig economy & payout fields with legacy defaults

**Files:**
- Modify: `packages/engine/src/types.ts` (RuleConfig, ~line 322)
- Modify: `packages/engine/src/constants.ts` (DEFAULT_RULES, ~line 67)
- Test: `packages/engine/src/constants.test.ts`

**Interfaces:**
- Produces: `RuleConfig` gains `warEconomyInterval: number`, `neutralGrowthInterval: number`, `neutralGarrisonDelta: number`, `plunderIncome: number`, `plunderCap: number`, `tiersPayout: TiersPayout`; new exported type `TiersPayout = 'multiplier' | 'income'` in `types.ts`. All later tasks rely on these exact names.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test** — append to `packages/engine/src/constants.test.ts`:

```ts
describe('economy and payout rule fields', () => {
  it('legacy defaults reproduce the old constants exactly', () => {
    expect(DEFAULT_RULES.warEconomyInterval).toBe(5);
    expect(DEFAULT_RULES.neutralGrowthInterval).toBe(3);
    expect(DEFAULT_RULES.neutralGarrisonDelta).toBe(0);
    expect(DEFAULT_RULES.plunderIncome).toBe(0);
    expect(DEFAULT_RULES.plunderCap).toBe(3);
    expect(DEFAULT_RULES.tiersPayout).toBe('multiplier');
  });

  it('rulesFor passes the legacy defaults through untouched', () => {
    const rules = rulesFor(6, 25, 'tiers');
    expect(rules.warEconomyInterval).toBe(5);
    expect(rules.neutralGrowthInterval).toBe(3);
    expect(rules.neutralGarrisonDelta).toBe(0);
    expect(rules.plunderIncome).toBe(0);
    expect(rules.tiersPayout).toBe('multiplier');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/engine/src/constants.test.ts`
Expected: FAIL — the new fields are `undefined`.

- [ ] **Step 3: Implement** — in `types.ts`, above `RuleConfig`:

```ts
/** How tiers scores land on the game. */
export type TiersPayout = 'multiplier' | 'income';
```

and inside `RuleConfig` (after `eventInterval`):

```ts
  /** The war economy ramps: +1 income every N turns, for everyone. */
  warEconomyInterval: number;
  /** Neutral garrisons grow every N turns; 0 disables growth. */
  neutralGrowthInterval: number;
  /** Added to each mapgen neutral garrison at setup, floored at 1. */
  neutralGarrisonDelta: number;
  /** Bonus income next turn per territory captured this turn; 0 disables plunder. */
  plunderIncome: number;
  /** Most captures that pay plunder in one turn. */
  plunderCap: number;
  /** Whether tiers scores set a combat multiplier (v1) or pay income (v2). */
  tiersPayout: TiersPayout;
```

In `constants.ts` add to `DEFAULT_RULES` (values are the legacy-compat layer — see Global Constraints):

```ts
  warEconomyInterval: 5,
  neutralGrowthInterval: 3,
  neutralGarrisonDelta: 0,
  plunderIncome: 0,
  plunderCap: 3,
  tiersPayout: 'multiplier',
```

`rulesFor` spreads `DEFAULT_RULES`, so it passes them through with no change. Do **not** remove the `WAR_ECONOMY_INTERVAL`/`NEUTRAL_GROWTH_INTERVAL` constants yet — their call sites move in Task 2.

- [ ] **Step 4: Run tests to verify they pass** — same command, plus `pnpm typecheck` (note: `TEST_RULES` in `testing.ts` spreads `DEFAULT_RULES` so it stays complete automatically).

- [ ] **Step 5: Commit** — `git add -A && git commit` — message: `Engine: economy and payout knobs join RuleConfig with legacy defaults`

---

### Task 2: Rules-driven war economy, neutral growth and garrison delta

**Files:**
- Modify: `packages/engine/src/income.ts` (whole file is 79 lines)
- Modify: `packages/engine/src/resolve.ts:36,54,434,454,572-579`
- Modify: `packages/engine/src/setup.ts:3,8-11,59-63,64-66`
- Modify: `packages/engine/src/testing.ts:172`
- Modify: `packages/engine/src/constants.ts` (delete the two constants)
- Test: `packages/engine/src/income.test.ts` (new), `packages/engine/src/setup.test.ts` (new), `packages/engine/src/resolve.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `RuleConfig` fields.
- Produces: `computeIncome(state, map, slot, rules: RuleConfig): number` and `recomputeIncome(state, map, rules: RuleConfig): void` — the new 4th/3rd parameter is required; `createInitialState(map, rules)` now actually uses `rules` (parameter renamed from `_rules`); private `growNeutrals(state, rules)` in resolve.ts.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/income.test.ts` (new file):

```ts
import { describe, expect, it } from 'vitest';

import { DEFAULT_RULES } from './constants.js';
import { computeIncome } from './income.js';
import { lineMap, scenario } from './testing.js';

describe('rules-driven war economy', () => {
  it('ramp interval comes from the rules, not a constant', () => {
    const map = lineMap(4, 2);
    const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3], turn: 6 });
    const legacy = computeIncome(state, map, 0, DEFAULT_RULES); // floor(6/5) = 1 ramp
    const fast = computeIncome(state, map, 0, { ...DEFAULT_RULES, warEconomyInterval: 3 }); // floor(6/3) = 2
    expect(fast - legacy).toBe(1);
  });
});
```

`packages/engine/src/setup.test.ts` (new file):

```ts
import { describe, expect, it } from 'vitest';

import { DEFAULT_RULES } from './constants.js';
import { createInitialState } from './setup.js';
import { lineMap } from './testing.js';

function mapWithNeutrals() {
  const map = lineMap(6, 2);
  map.starts = [
    { slot: 0, capital: 0, extra: [] },
    { slot: 1, capital: 5, extra: [] },
  ];
  map.neutralGarrisons = { 1: 2, 2: 3, 3: 4 };
  return map;
}

describe('neutral garrison delta', () => {
  it('applies the delta with a floor of 1', () => {
    const state = createInitialState(mapWithNeutrals(), {
      ...DEFAULT_RULES,
      neutralGarrisonDelta: -2,
    });
    expect(state.armies[1]).toBe(1); // 2 - 2 floored at 1
    expect(state.armies[2]).toBe(1); // 3 - 2
    expect(state.armies[3]).toBe(2); // 4 - 2
  });

  it('legacy delta 0 seeds garrisons exactly as generated', () => {
    const state = createInitialState(mapWithNeutrals(), DEFAULT_RULES);
    expect([state.armies[1], state.armies[2], state.armies[3]]).toEqual([2, 3, 4]);
  });
});
```

Append to `packages/engine/src/resolve.test.ts`:

```ts
describe('rules-driven neutral growth', () => {
  it('grows on the rules interval and 0 disables it', () => {
    const map = lineMap(4, 2);
    const state = scenario(map, { owner: [0, null, null, 1], armies: [3, 1, 1, 3], turn: 2 });
    // next.turn is 3 — divisible by the legacy interval of 3.
    const grown = resolveTurn(state, [orders(0), orders(1)], { seed: 's', map, rules: TEST_RULES });
    expect(grown.next.armies[1]).toBe(2);
    const frozen = resolveTurn(state, [orders(0), orders(1)], {
      seed: 's',
      map,
      rules: { ...TEST_RULES, neutralGrowthInterval: 0 },
    });
    expect(frozen.next.armies[1]).toBe(1);
  });
});
```

(`lineMap`, `scenario`, `orders`, `TEST_RULES`, `resolveTurn` are already imported at the top of `resolve.test.ts` — extend the import lists only if a name is missing.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/engine/src/income.test.ts packages/engine/src/setup.test.ts packages/engine/src/resolve.test.ts`
Expected: income/setup tests FAIL (extra argument ignored ⇒ values equal / TS error); neutral-growth test FAIL (growth still fires at interval 0).

- [ ] **Step 3: Implement**

`income.ts` — thread rules through:

```ts
export function computeIncome(
  state: GameState,
  map: GeneratedMap,
  slot: Slot,
  rules: RuleConfig,
): number {
```

replace `Math.floor(state.turn / WAR_ECONOMY_INTERVAL)` with `Math.floor(state.turn / rules.warEconomyInterval)`; drop the `WAR_ECONOMY_INTERVAL` import (keep `BASE_INCOME`, `CAPTURED_CAPITAL_INCOME`, `TERRITORIES_PER_INCOME`); and:

```ts
export function recomputeIncome(state: GameState, map: GeneratedMap, rules: RuleConfig): void {
  for (let slot = 0; slot < state.playerCount; slot++) {
    state.income[slot] = computeIncome(state, map, slot, rules);
  }
  state.pendingBonusIncome.fill(0);
}
```

Callers:
- `setup.ts`: rename `_rules` → `rules`; apply the delta in the garrison loop:

```ts
  for (const [id, garrison] of Object.entries(map.neutralGarrisons)) {
    const territory = Number(id);
    if (state.owner[territory] === null) {
      state.armies[territory] = Math.max(1, garrison + rules.neutralGarrisonDelta);
    }
  }
```

  and `recomputeIncome(state, map, rules);`.
- `resolve.ts:454`: `recomputeIncome(next, map, rules);`
- `testing.ts:172`: `if (!options.income) recomputeIncome(state, map, DEFAULT_RULES);`
- `resolve.ts` `growNeutrals`:

```ts
/** Unclaimed land does not stay cheap: neutral garrisons grow on a schedule. */
function growNeutrals(state: GameState, rules: RuleConfig): void {
  if (rules.neutralGrowthInterval <= 0) return;
  if (state.turn % rules.neutralGrowthInterval !== 0) return;
  ...
```

  call site (line 434): `growNeutrals(next, rules);`; drop the `NEUTRAL_GROWTH_INTERVAL` import.
- `constants.ts`: delete `WAR_ECONOMY_INTERVAL` and `NEUTRAL_GROWTH_INTERVAL` (now expressed only as `DEFAULT_RULES` values — keep their explanatory comments on the fields).

- [ ] **Step 4: Run the full engine suite and typecheck**

Run: `pnpm vitest run packages/engine && pnpm typecheck`
Expected: PASS (typecheck catches any missed `computeIncome`/`recomputeIncome` caller — fix any it finds the same way).

- [ ] **Step 5: Commit** — message: `Engine: war economy, neutral growth and garrison seeding read per-game rules`

---

### Task 3: Plunder on capture

**Files:**
- Modify: `packages/engine/src/types.ts` (TurnReport, ~line 300)
- Modify: `packages/engine/src/resolve.ts` (after the bonus-income loop, ~line 426, and the report literal ~line 474)
- Test: `packages/engine/src/resolve.test.ts` (append)

**Interfaces:**
- Consumes: `rules.plunderIncome`, `rules.plunderCap` (Task 1).
- Produces: `export interface PlunderReport { slot: Slot; captures: number; income: number }` in types.ts; `TurnReport.plunder: PlunderReport[]`. Web Task 10 renders these fields.

- [ ] **Step 1: Write the failing test** — append to `resolve.test.ts`:

```ts
describe('plunder', () => {
  // Four provinces strike out into empty neutral land; a fifth player-owned
  // territory sits far away so player 1 stays alive.
  const plunderMap = () =>
    makeTestMap({
      playerCount: 2,
      territoryCount: 9,
      edges: [
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
        [0, 1],
        [1, 2],
        [2, 3],
        [7, 8],
      ],
    });
  const plunderState = (map: GeneratedMap) =>
    scenario(map, {
      owner: [0, 0, 0, 0, null, null, null, null, 1],
      armies: [2, 2, 2, 2, 0, 0, 0, 0, 5],
    });
  const raid = [
    orders(0, [move(0, 4, 1), move(1, 5, 1), move(2, 6, 1), move(3, 7, 1)]),
    orders(1),
  ];

  it('captures pay income next turn, capped per turn', () => {
    const map = plunderMap();
    const rules = { ...TEST_RULES, plunderIncome: 1, plunderCap: 3 };
    const { next, report } = resolveTurn(plunderState(map), raid, { seed: 's', map, rules });
    expect(report.plunder).toEqual([{ slot: 0, captures: 4, income: 3 }]);
    const baseline = resolveTurn(plunderState(map), raid, { seed: 's', map, rules: TEST_RULES });
    expect(next.income[0] - baseline.next.income[0]).toBe(3);
  });

  it('legacy rules produce no plunder entries', () => {
    const map = plunderMap();
    const { report } = resolveTurn(plunderState(map), raid, { seed: 's', map, rules: TEST_RULES });
    expect(report.plunder).toEqual([]);
  });
});
```

(`makeTestMap`, `move`, and `GeneratedMap` may need adding to the test file's imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/engine/src/resolve.test.ts`
Expected: FAIL — `report.plunder` is `undefined`.

- [ ] **Step 3: Implement**

`types.ts` — next to `TurnReport`:

```ts
/** Territory captured this turn converted to next-turn income. */
export interface PlunderReport {
  slot: Slot;
  /** Every territory taken, even past the paying cap. */
  captures: number;
  income: number;
}
```

and in `TurnReport` after `battles`:

```ts
  /** Expansion pays: capture income granted this turn; empty when plunder is off. */
  plunder: PlunderReport[];
```

`resolve.ts` — right after the `pendingBonusIncome` contest loop (line ~426), **before** `applyStorm` so a same-turn storm collapse cannot erase a paid-for capture:

```ts
  // Expansion pays immediately: each captured territory converts to income,
  // up to the per-turn cap. Counted before the storm so armies spent on a
  // province the storm then eats were still not spent for nothing.
  const plunder: PlunderReport[] = [];
  if (rules.plunderIncome > 0) {
    const captures = new Array<number>(state.playerCount).fill(0);
    for (let id = 0; id < next.owner.length; id++) {
      const owner = next.owner[id];
      if (owner !== null && owner !== state.owner[id]) captures[owner]++;
    }
    for (let slot = 0; slot < state.playerCount; slot++) {
      if (captures[slot] === 0) continue;
      const income = Math.min(captures[slot], rules.plunderCap) * rules.plunderIncome;
      next.pendingBonusIncome[slot] += income;
      plunder.push({ slot, captures: captures[slot], income });
    }
  }
```

add `plunder,` to the `TurnReport` literal (after `battles`), and `PlunderReport` to the types import.

- [ ] **Step 4: Run the engine suite** — `pnpm vitest run packages/engine && pnpm typecheck`. Expected: PASS (existing report-shape assertions don't enumerate keys, but if any snapshot-style test fails on the new field, update it deliberately).

- [ ] **Step 5: Commit** — message: `Engine: capturing territory pays plunder income, capped per turn`

---

### Task 4: ContestContext carries rules; tiers income payout

**Files:**
- Modify: `packages/engine/src/contest/types.ts:38-42`
- Modify: `packages/engine/src/resolve.ts:131`
- Modify: `packages/engine/src/contest/tiers.ts` (resolveTiers, ~lines 118-194)
- Modify: `packages/engine/src/types.ts` (TiersResult, ~line 146)
- Test: `packages/engine/src/contest/tiers.test.ts` (append + fix fixtures), `packages/engine/src/contest/pact.test.ts` (fix fixtures if it builds ContestContext literals)

**Interfaces:**
- Consumes: `rules.tiersPayout` (Task 1).
- Produces: `ContestContext.rules: RuleConfig` (required); `TiersResult.incomeDelta: number` (0 in multiplier games). The report UI (Task 10) reads `incomeDelta`.

- [ ] **Step 1: Write the failing tests** — append to `contest/tiers.test.ts`. The file already defines `LIST` (shuffle `[3, 0, 5, 1, 4, 2]`) and `stateWithList()`. The inverse of that shuffle — a perfect guess — is `[1, 3, 5, 0, 4, 2]`.

```ts
describe('income payout (tiers v2)', () => {
  const PERFECT = [1, 3, 5, 0, 4, 2]; // inverse of LIST.shuffle — scores 12
  const incomeContext = (): ContestContext => ({
    attacked: [
      [false, false],
      [false, false],
    ],
    aliveSlots: [0, 1],
    rules: { ...TEST_RULES, contest: 'tiers', tiersPayout: 'income' },
  });
  const guessInput = (order: number[]): TiersOrders => ({
    list: ['u', 'v', 'w', 'x', 'y', 'z'],
    guesses: [{ target: 0, order }],
  });

  it('a perfect read pays guesser and author in armies, multipliers stay flat', () => {
    const outcome = resolveTiers(stateWithList(), [null, guessInput(PERFECT)], incomeContext());
    expect(outcome.multiplier).toEqual([100, 100]);
    expect(outcome.bonusIncome[1]).toBe(3); // trunc((12 - 6) / 2)
    expect(outcome.bonusIncome[0]).toBe(3); // ceil((12 - 6) / 2) author bonus
    expect(outcome.results.find((r) => r.slot === 1)?.incomeDelta).toBe(3);
    expect(outcome.results.find((r) => r.slot === 0)?.incomeDelta).toBe(3);
  });

  it('a bad wager costs armies and the author earns nothing', () => {
    // Identity order scores 3 against LIST (one exact, one adjacent).
    const outcome = resolveTiers(stateWithList(), [null, guessInput(IDENTITY)], incomeContext());
    expect(outcome.multiplier).toEqual([100, 100]);
    expect(outcome.bonusIncome[1]).toBe(-1); // trunc((3 - 6) / 2)
    expect(outcome.bonusIncome[0]).toBe(0); // below neutral never pays the author
  });

  it('multiplier games report incomeDelta 0 and unchanged multipliers', () => {
    const outcome = resolveTiers(stateWithList(), [null, guessInput(PERFECT)], {
      attacked: [
        [false, false],
        [false, false],
      ],
      aliveSlots: [0, 1],
      rules: { ...TEST_RULES, contest: 'tiers' },
    });
    expect(outcome.multiplier[1]).toBe(112); // 100 + (12-6)*2 guess; nobody read slot 1
    expect(outcome.multiplier[0]).toBe(106); // 100 + author bonus max(0, 12-6)
    expect(outcome.results.every((r) => r.incomeDelta === 0)).toBe(true);
  });
});
```

Also update **every existing** `ContestContext` literal in `tiers.test.ts` and `pact.test.ts` (grep `aliveSlots`) to add `rules: TEST_RULES` (or `{ ...TEST_RULES, contest: 'tiers' }` where it reads better) — the field is required.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/engine/src/contest`
Expected: new tests FAIL (`incomeDelta` undefined, multiplier not flattened); existing tests still pass once fixtures carry `rules`.

- [ ] **Step 3: Implement**

`contest/types.ts`:

```ts
import type { GameState, RuleConfig, Slot } from '../types.js';
...
export interface ContestContext {
  /** `attacked[a][b]` — did slot a order an attack on slot b this turn? */
  attacked: boolean[][];
  aliveSlots: Slot[];
  /** The game's stored rules; contests read payout knobs from here. */
  rules: RuleConfig;
}
```

`resolve.ts:131`: `const contestContext = { attacked, aliveSlots, rules };`

`types.ts` `TiersResult`: add

```ts
  /** Armies granted (or forfeited) next turn; 0 in multiplier games. */
  incomeDelta: number;
```

`contest/tiers.ts` — beside the scoring constants:

```ts
/** Points-to-armies divisor for the income payout ('tiers v2'). */
const INCOME_DIVISOR = 2;
```

rename the `_context` parameter to `context`, and rework the per-slot loop:

```ts
  const incomeMode = context.rules.tiersPayout === 'income';

  for (let slot = 0; slot < playerCount; slot++) {
    if (state.status[slot] !== 'active') continue;

    const authorBonus = Math.max(0, (bestRead[slot]?.score ?? 0) - NEUTRAL_SCORE);
    let incomeDelta = 0;
    if (incomeMode) {
      // Everyone fights at 1.00; reads are paid (or charged) in armies instead.
      const guessIncome = guessResults[slot].reduce(
        (sum, guess) => sum + Math.trunc((guess.score - NEUTRAL_SCORE) / INCOME_DIVISOR),
        0,
      );
      incomeDelta = guessIncome + Math.ceil(authorBonus / INCOME_DIVISOR);
      bonusIncome[slot] = incomeDelta;
    } else {
      const guessContribution = guessResults[slot].reduce(
        (sum, guess) => sum + (guess.score - NEUTRAL_SCORE) * GUESS_WEIGHT,
        0,
      );
      // Being read well pays; being read badly costs the author nothing.
      multiplier[slot] = Math.min(
        MAX_MULTIPLIER,
        Math.max(MIN_MULTIPLIER, 100 + guessContribution + authorBonus),
      );
    }

    results.push({
      slot,
      revealed: state.tiersLists[slot]?.items.slice() ?? null,
      guesses: guessResults[slot],
      bestRead: bestRead[slot],
      multiplier: multiplier[slot],
      incomeDelta,
    });
  }
```

(`multiplier` stays initialised to 100 for every slot, so income mode needs no write.)

- [ ] **Step 4: Run the engine suite** — `pnpm vitest run packages/engine && pnpm typecheck`. Expected: PASS, including untouched multiplier-mode tests (byte-identical behavior).

- [ ] **Step 5: Commit** — message: `Engine: tiers income payout — reads pay armies and combat goes flat`

---

### Task 5: Presets module

**Files:**
- Create: `packages/engine/src/presets.ts`
- Modify: `packages/engine/src/index.ts` (add export line)
- Test: `packages/engine/src/presets.test.ts` (new)

**Interfaces:**
- Consumes: `rulesFor` (constants.ts), `ContestKind`, `RuleConfig`, `TiersPayout` (types.ts).
- Produces: `PresetId = 'pact' | 'tiers' | 'pact-blitz' | 'tiers-v2'`; `GamePreset { id, name, tagline, contest, tiersPayout, defaultTurnCap, defaultTurnMinutes, warEconomyInterval }`; `PRESETS: readonly GamePreset[]`; `presetById(id: string): GamePreset | null`; `presetRules(preset: GamePreset, playerCount: number, turnCap: number): RuleConfig`. Server Tasks 6–8 and web Tasks 9–10 import all of these from `@www/engine`. NOTE: the ids `'pact'` and `'tiers'` deliberately equal the `ContestKind` values so a legacy doc's contest can be used as a preset lookup key.

- [ ] **Step 1: Write the failing test** — `packages/engine/src/presets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { rulesFor } from './constants.js';
import { PRESETS, presetById, presetRules } from './presets.js';

describe('presets', () => {
  it('ships exactly four presets with contest-compatible classic ids', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['pact', 'tiers', 'pact-blitz', 'tiers-v2']);
    expect(presetById('nope')).toBeNull();
  });

  it('classic presets are the classic contests plus the anti-turtle economy', () => {
    const pact = presetById('pact')!;
    expect(pact.defaultTurnCap).toBe(25);
    expect(pact.defaultTurnMinutes).toBe(1440);
    expect(presetRules(pact, 6, 25)).toEqual({
      ...rulesFor(6, 25, 'pact'),
      neutralGrowthInterval: 0,
      neutralGarrisonDelta: -1,
      plunderIncome: 1,
      plunderCap: 3,
    });
    expect(presetById('tiers')!.contest).toBe('tiers');
    expect(presetById('tiers')!.tiersPayout).toBe('multiplier');
  });

  it('blitz presets run short, hot games', () => {
    for (const id of ['pact-blitz', 'tiers-v2'] as const) {
      const preset = presetById(id)!;
      expect(preset.defaultTurnCap).toBe(15);
      expect(preset.defaultTurnMinutes).toBe(60);
      const rules = presetRules(preset, 6, preset.defaultTurnCap);
      expect(rules.warEconomyInterval).toBe(3);
      expect(rules.stormFirstWave).toBe(6); // rulesFor already scales storm to the cap
    }
  });

  it('tiers v2 pays income', () => {
    const rules = presetRules(presetById('tiers-v2')!, 4, 15);
    expect(rules.contest).toBe('tiers');
    expect(rules.tiersPayout).toBe('income');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/engine/src/presets.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement** — `packages/engine/src/presets.ts`:

```ts
/**
 * Game presets — the identity a game is created with.
 *
 * A preset fixes the contest, the payout mode and the pacing; players, turn
 * length and game length stay lobby-editable. Two layers of defaults exist on
 * purpose: DEFAULT_RULES/rulesFor is the legacy layer that backfills games
 * created before a knob existed, and presetRules is what new games actually
 * get. Every preset applies the anti-turtle economy — growth off, cheap
 * neutrals, plunder — because mechanics that reward doing nothing are not fun.
 */

import { rulesFor } from './constants.js';
import type { ContestKind, RuleConfig, TiersPayout } from './types.js';

export type PresetId = 'pact' | 'tiers' | 'pact-blitz' | 'tiers-v2';

export interface GamePreset {
  id: PresetId;
  name: string;
  tagline: string;
  contest: ContestKind;
  tiersPayout: TiersPayout;
  defaultTurnCap: number;
  defaultTurnMinutes: number;
  /** The war economy ramps +1 income every N turns; blitz presets ramp hotter. */
  warEconomyInterval: number;
}

export const PRESETS: readonly GamePreset[] = [
  {
    id: 'pact',
    name: 'Pact',
    tagline: 'Pledge & betray — the classic game.',
    contest: 'pact',
    tiersPayout: 'multiplier',
    defaultTurnCap: 25,
    defaultTurnMinutes: 1440,
    warEconomyInterval: 5,
  },
  {
    id: 'tiers',
    name: 'Tiers',
    tagline: 'Read your rivals — lists drive combat.',
    contest: 'tiers',
    tiersPayout: 'multiplier',
    defaultTurnCap: 25,
    defaultTurnMinutes: 1440,
    warEconomyInterval: 5,
  },
  {
    id: 'pact-blitz',
    name: 'Pact Blitz',
    tagline: 'The classic, fast — early storm, hot economy.',
    contest: 'pact',
    tiersPayout: 'multiplier',
    defaultTurnCap: 15,
    defaultTurnMinutes: 60,
    warEconomyInterval: 3,
  },
  {
    id: 'tiers-v2',
    name: 'Tiers v2',
    tagline: 'Reads pay armies, not combat luck — fast-paced.',
    contest: 'tiers',
    tiersPayout: 'income',
    defaultTurnCap: 15,
    defaultTurnMinutes: 60,
    warEconomyInterval: 3,
  },
];

export function presetById(id: string): GamePreset | null {
  return PRESETS.find((preset) => preset.id === id) ?? null;
}

/** The rules a NEW game gets: legacy base, preset pacing, anti-turtle economy. */
export function presetRules(
  preset: GamePreset,
  playerCount: number,
  turnCap: number,
): RuleConfig {
  return {
    ...rulesFor(playerCount, turnCap, preset.contest),
    warEconomyInterval: preset.warEconomyInterval,
    neutralGrowthInterval: 0,
    neutralGarrisonDelta: -1,
    plunderIncome: 1,
    plunderCap: 3,
    tiersPayout: preset.tiersPayout,
  };
}
```

`index.ts` — after the constants export line:

```ts
export { PRESETS, presetById, presetRules, type GamePreset, type PresetId } from './presets.js';
```

- [ ] **Step 4: Run test to verify it passes** — same command plus `pnpm typecheck`.

- [ ] **Step 5: Commit** — message: `Engine: four game presets — classic Pact/Tiers, Pact Blitz, Tiers v2`

---

### Task 6: Server resolves every game through effectiveRules

**Files:**
- Modify: `packages/server/src/store.ts` (add helper + GameDoc.presetId)
- Modify: `packages/server/src/games.ts:189-192` (getView), `:276-290` (activate)
- Modify: `packages/server/src/resolve.ts:103-107`
- Test: `packages/server/src/store.test.ts` (append)

**Interfaces:**
- Consumes: `rulesFor` from `@www/engine`.
- Produces: `effectiveRules(doc: GameDoc): RuleConfig` exported from `store.ts`; `GameDoc.presetId?: string`. Tasks 7–8 consume both.

**Why:** `resolveGameTurn` currently passes `game.rules` raw into the engine. Task 1 made the new fields required on `RuleConfig`, so a legacy doc's stored rules (which lack them) would resolve with `undefined` intervals — NaN incomes. One helper, used at view, activation and resolution time, is the compatibility guarantee.

- [ ] **Step 1: Write the failing test** — append to `packages/server/src/store.test.ts` (this test needs no emulator; put it outside the `describe.skipIf` block if one wraps the file, in its own `describe`):

```ts
import { effectiveRules, type GameDoc } from './store.js';

describe('effectiveRules', () => {
  it('backfills fields legacy docs never stored, and stored fields win', () => {
    const doc = {
      playerCount: 4,
      rules: { contest: 'pact', turnCap: 25, dominationShare: 0.7 },
    } as unknown as GameDoc;
    const rules = effectiveRules(doc);
    expect(rules.warEconomyInterval).toBe(5);
    expect(rules.neutralGrowthInterval).toBe(3);
    expect(rules.neutralGarrisonDelta).toBe(0);
    expect(rules.plunderIncome).toBe(0);
    expect(rules.tiersPayout).toBe('multiplier');
    expect(rules.dominationShare).toBe(0.7); // stored rules always win
  });
});
```

(Adjust the import line to merge with existing imports from `./store.js`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:server` (or `pnpm vitest run packages/server/src/store.test.ts` — this particular test runs without the emulator)
Expected: FAIL — `effectiveRules` not exported.

- [ ] **Step 3: Implement**

`store.ts` — add `presetId?: string;` to `GameDoc` (after `seed`), and:

```ts
import { rulesFor } from '@www/engine';
import type { RuleConfig } from '@www/engine';

/**
 * The rules a game actually plays under. Stored rules win; rulesFor only
 * fills fields that games predating them never stored — the legacy-defaults
 * layer that keeps active games resolving exactly as they always did.
 */
export function effectiveRules(doc: GameDoc): RuleConfig {
  return {
    ...rulesFor(doc.playerCount, doc.rules.turnCap, doc.rules.contest ?? 'pact'),
    ...doc.rules,
  };
}
```

(`doc.rules.turnCap` may be `undefined` on the oldest docs; `rulesFor`'s default parameter handles that.)

Replace the three consumers:
- `games.ts` getView: delete the inline merge (`const rules = { ...rulesFor(...), ...game.rules }`) in favour of `const rules = effectiveRules(game);` (keep the `contest` const above it).
- `games.ts` `activate()`: `const state = createInitialState(map, effectiveRules(doc));`
- `server/resolve.ts` `resolveGameTurn`: `rules: effectiveRules(game),` in the `resolveTurn` context (add the import).

- [ ] **Step 4: Run the server suite** — `pnpm test:server` and `pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — message: `Server: one effectiveRules helper backfills legacy docs at view, activation and resolution`

---

### Task 7: Lobby config endpoint

**Files:**
- Modify: `packages/server/src/api-types.ts` (UpdateConfigRequest)
- Modify: `packages/server/src/games.ts` (new updateConfig function)
- Modify: `packages/server/src/app.ts` (new route)
- Test: `packages/server/src/games.test.ts`, `packages/server/src/app.test.ts` (append)

**Interfaces:**
- Consumes: `effectiveRules` (Task 6), `presetById`/`presetRules` (Task 5), existing bounds constants.
- Produces: `UpdateConfigRequest { playerCount?: number; turnMinutes?: number; turnCap?: number }`; `updateConfig(db, gameId, user, req): Promise<GameView>`; route `POST /api/games/:id/config`. Web Task 9 calls the route; Task 8's test helper calls `updateConfig`.

- [ ] **Step 1: Write the failing tests** — append to `games.test.ts` (inside the emulator-gated describe; `carol` is a third `AuthedUser` — add `const carol: AuthedUser = { uid: 'u-carol', name: 'Carol', email: null };` beside alice/bob):

```ts
describe('updateConfig', () => {
  it('creator retunes players, turn length and cap; rules and map follow', async () => {
    const id = await createGame(db, alice, { playerCount: 4, turnMinutes: 60 });
    const view = await updateConfig(db, id, alice, {
      playerCount: 6,
      turnMinutes: 45,
      turnCap: 15,
    });
    expect(view.playerCount).toBe(6);
    expect(view.turnMinutes).toBe(45);
    expect(view.turnCap).toBe(15);
    expect(view.rules.stormFirstWave).toBe(6); // rebuilt for the new cap
    expect(view.map.playerCount).toBe(6); // map regenerated
    expect(view.seats).toHaveLength(6);
    expect(view.seats[0].taken).toBe(true); // creator kept their seat
  });

  it('rejects non-creators, non-lobby games, and out-of-bounds values', async () => {
    const id = await createGame(db, alice, { playerCount: 2, turnMinutes: 60 });
    await expect(updateConfig(db, id, bob, { turnCap: 15 })).rejects.toThrow(HttpError);
    await expect(updateConfig(db, id, alice, { playerCount: 1 })).rejects.toThrow(HttpError);
    await expect(updateConfig(db, id, alice, { playerCount: 13 })).rejects.toThrow(HttpError);
    await expect(updateConfig(db, id, alice, { turnMinutes: 4 })).rejects.toThrow(HttpError);
    await expect(updateConfig(db, id, alice, { turnCap: 9 })).rejects.toThrow(HttpError);
    await expect(updateConfig(db, id, alice, { turnCap: 51 })).rejects.toThrow(HttpError);
    await joinGame(db, id, bob); // fills the last seat — game activates
    await expect(updateConfig(db, id, alice, { turnCap: 15 })).rejects.toThrow(HttpError);
  });

  it('never unseats anyone: shrinking below an occupied index is refused', async () => {
    const id = await createGame(db, alice, { playerCount: 4, turnMinutes: 60 });
    await joinGame(db, id, bob); // seat 1
    await joinGame(db, id, carol); // seat 2
    await expect(updateConfig(db, id, alice, { playerCount: 2 })).rejects.toThrow(HttpError);
    const view = await updateConfig(db, id, alice, { playerCount: 3 });
    expect(view.seats.map((s) => s.taken)).toEqual([true, true, true]);
  });
});
```

And to `app.test.ts` (inside the lifecycle describe, as its own `it`):

```ts
  it('exposes lobby config over HTTP', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: H('tok-a'),
      payload: { playerCount: 4, turnMinutes: 60 },
    });
    const { id } = create.json<{ id: string }>();
    const config = await app.inject({
      method: 'POST',
      url: `/api/games/${id}/config`,
      headers: H('tok-a'),
      payload: { turnCap: 15, turnMinutes: 30 },
    });
    expect(config.statusCode).toBe(200);
    expect(config.json<{ turnCap: number; turnMinutes: number }>()).toMatchObject({
      turnCap: 15,
      turnMinutes: 30,
    });
    const denied = await app.inject({
      method: 'POST',
      url: `/api/games/${id}/config`,
      headers: H('tok-b'),
      payload: { turnCap: 20 },
    });
    expect(denied.statusCode).toBe(403);
  });
```

(NOTE: these tests use the **old** `createGame` shape on purpose — it changes in Task 8, which also migrates them.)

- [ ] **Step 2: Run tests to verify they fail** — `pnpm test:server`. Expected: FAIL — `updateConfig` not exported, route 404 (Fastify returns 404 for unknown routes).

- [ ] **Step 3: Implement**

`api-types.ts`:

```ts
export interface UpdateConfigRequest {
  playerCount?: number;
  turnMinutes?: number;
  turnCap?: number;
}
```

`games.ts` (imports: `presetById`, `presetRules`, `MIN_TURN_CAP`, `MAX_TURN_CAP` from `@www/engine`; `effectiveRules`, `serializeMap` already imported from store):

```ts
/**
 * Creator-only lobby tuning. The preset is the game's identity and immutable;
 * everything else — table size, clock, length — is negotiable until start.
 */
export async function updateConfig(
  db: Firestore,
  gameId: string,
  user: AuthedUser,
  req: UpdateConfigRequest,
): Promise<GameView> {
  const doc = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) throw new HttpError(404, 'game not found');
    const game = snap.data() as GameDoc;
    if (game.createdBy !== user.uid) throw new HttpError(403, 'only the creator can configure');
    if (game.status !== 'lobby') throw new HttpError(409, 'game already started');

    const playerCount = req.playerCount ?? game.playerCount;
    const turnMinutes = req.turnMinutes ?? game.turnMinutes;
    const turnCap = req.turnCap ?? effectiveRules(game).turnCap;
    if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
      throw new HttpError(400, `playerCount must be an integer in [${MIN_PLAYERS}, ${MAX_PLAYERS}]`);
    }
    if (
      !Number.isInteger(turnMinutes) ||
      turnMinutes < MIN_TURN_MINUTES ||
      turnMinutes > MAX_TURN_MINUTES
    ) {
      throw new HttpError(
        400,
        `turnMinutes must be an integer in [${MIN_TURN_MINUTES}, ${MAX_TURN_MINUTES}]`,
      );
    }
    if (!Number.isInteger(turnCap) || turnCap < MIN_TURN_CAP || turnCap > MAX_TURN_CAP) {
      throw new HttpError(400, `turnCap must be an integer in [${MIN_TURN_CAP}, ${MAX_TURN_CAP}]`);
    }

    // Classic preset ids equal the contest kinds, so a legacy lobby without a
    // presetId still resolves to the preset matching its contest.
    const preset = presetById(game.presetId ?? game.rules.contest ?? 'pact');
    if (preset === null) throw new HttpError(500, 'game has no recognisable preset');

    if (playerCount !== game.playerCount) {
      if (game.seats.slice(playerCount).some((seat) => seat !== null)) {
        throw new HttpError(409, 'players are already seated beyond that count');
      }
      game.mapJson = serializeMap(generateMap(randomUUID(), playerCount));
      game.seats = Array.from({ length: playerCount }, (_, slot) => game.seats[slot] ?? null);
      game.playerCount = playerCount;
    }
    game.turnMinutes = turnMinutes;
    game.rules = presetRules(preset, playerCount, turnCap);

    tx.set(games(db).doc(gameId), game);
    return game;
  });
  return getView(db, gameId, user, doc);
}
```

`app.ts` — after the `/games/:id/start` route (add `UpdateConfigRequest` to the type import and `updateConfig` to the games import):

```ts
      api.post('/games/:id/config', async (req) => {
        const { id } = req.params as { id: string };
        return updateConfig(db, id, req.user, req.body as UpdateConfigRequest);
      });
```

- [ ] **Step 4: Run the server suite** — `pnpm test:server && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — message: `Server: creator tunes players, turn length and cap in the lobby`

---

### Task 8: Create games from a preset

**Files:**
- Modify: `packages/server/src/api-types.ts` (CreateGameRequest, GameView)
- Modify: `packages/server/src/games.ts` (createGame, getView)
- Modify: `packages/server/src/testing.ts` (createTestGame helper)
- Modify: `packages/server/src/games.test.ts`, `app.test.ts`, `tiers.test.ts`, `tick.test.ts`, `notify.test.ts` (migrate every `createGame(`/create-payload call site)
- Test: `packages/server/src/games.test.ts` (new preset assertions)

**Interfaces:**
- Consumes: `presetById`, `presetRules` (Task 5), `updateConfig` (Task 7).
- Produces: `CreateGameRequest { presetId: string }`; `GameView.presetId: string | null` and `GameView.presetName: string`; `createTestGame(db, user, opts?)` in server testing.ts. Web Tasks 9–10 consume the view fields.

- [ ] **Step 1: Write the failing tests** — in `games.test.ts`, replace the "creates a lobby game with creator in seat 0" test body's create call with the new shape and extend it:

```ts
  it('creates a lobby game from a preset', async () => {
    const id = await createGame(db, alice, { presetId: 'tiers-v2' });
    const view = await getView(db, id, alice);
    expect(view.status).toBe('lobby');
    expect(view.mySlot).toBe(0);
    expect(view.playerCount).toBe(4);
    expect(view.turnMinutes).toBe(60);
    expect(view.turnCap).toBe(15);
    expect(view.contest).toBe('tiers');
    expect(view.presetId).toBe('tiers-v2');
    expect(view.presetName).toBe('Tiers v2');
    expect(view.rules.tiersPayout).toBe('income');
    expect(view.rules.plunderIncome).toBe(1);
    expect(view.rules.neutralGrowthInterval).toBe(0);
  });

  it('rejects unknown presets', async () => {
    await expect(createGame(db, alice, { presetId: 'ranked' })).rejects.toThrow(HttpError);
  });
```

- [ ] **Step 2: Run tests to verify they fail** — `pnpm test:server`. Expected: the two new tests FAIL (TS error / 400).

- [ ] **Step 3: Implement**

`api-types.ts`:

```ts
export interface CreateGameRequest {
  /** One of the engine's PRESETS ids; the preset is immutable after creation. */
  presetId: string;
}
```

`GameView` — after `rules`:

```ts
  /** Null on games created before presets existed. */
  presetId: string | null;
  presetName: string;
```

`games.ts` `createGame` — replace the validation and doc construction (drop the old playerCount/turnMinutes/contest/turnCap handling; `MIN_TURN_MINUTES`/`MAX_TURN_MINUTES` stay for updateConfig):

```ts
const LOBBY_START_PLAYERS = 4;

export async function createGame(
  db: Firestore,
  user: AuthedUser,
  req: CreateGameRequest,
): Promise<string> {
  const preset = presetById(typeof req.presetId === 'string' ? req.presetId : '');
  if (preset === null) throw new HttpError(400, 'unknown preset');
  const playerCount = LOBBY_START_PLAYERS;

  // The map ships to clients (and embeds its own seed), so it must not share
  // the combat seed — that one stays server-side and decides battle rolls.
  const seed = randomUUID();
  const map = generateMap(randomUUID(), playerCount);
  const seats: GameDoc['seats'] = Array.from({ length: playerCount }, () => null);
  seats[0] = { uid: user.uid, name: user.name, email: user.email, isBot: false };

  const doc: GameDoc = {
    status: 'lobby',
    createdBy: user.uid,
    createdAt: Timestamp.now(),
    playerCount,
    seats,
    turn: 1,
    deadlineAt: null,
    turnMinutes: preset.defaultTurnMinutes,
    remindedTurn: 0,
    seed,
    presetId: preset.id,
    rules: presetRules(preset, playerCount, preset.defaultTurnCap),
    stateJson: null,
    mapJson: serializeMap(map),
  };
  // ... (ref.set / usersCol block unchanged)
```

`getView` — beside the existing `contest` const:

```ts
  const preset = presetById(game.presetId ?? contest);
```

and in the returned view:

```ts
    presetId: game.presetId ?? null,
    presetName: preset?.name ?? (contest === 'tiers' ? 'Tiers' : 'Pact'),
```

`server/src/testing.ts` — test helper so call sites stay one-liners:

```ts
import type { PresetId } from '@www/engine';
import { createGame, updateConfig } from './games.js';

/** Create-and-configure in one call; most tests want a small, fast table. */
export async function createTestGame(
  db: Firestore,
  user: AuthedUser,
  opts: { presetId?: PresetId; playerCount?: number; turnMinutes?: number; turnCap?: number } = {},
): Promise<string> {
  const id = await createGame(db, user, { presetId: opts.presetId ?? 'pact' });
  if (opts.playerCount !== undefined || opts.turnMinutes !== undefined || opts.turnCap !== undefined) {
    await updateConfig(db, id, user, {
      playerCount: opts.playerCount,
      turnMinutes: opts.turnMinutes,
      turnCap: opts.turnCap,
    });
  }
  return id;
}
```

Migrate call sites — `grep -rn "createGame(" packages/server/src/*.test.ts` and `grep -n "playerCount" packages/server/src/app.test.ts`:
- `createGame(db, alice, { playerCount: 2, turnMinutes: 60 })` → `createTestGame(db, alice, { playerCount: 2, turnMinutes: 60 })`.
- Tiers server tests use `{ ..., contest: 'tiers' }` → `createTestGame(db, alice, { presetId: 'tiers', playerCount: 2, ... })`.
- The old "rejects bad player counts" creation test moves its meaning to updateConfig (already covered in Task 7) — replace it with the "rejects unknown presets" test above.
- `app.test.ts` HTTP payloads `{ playerCount: 2, turnMinutes: 60 }` → `{ presetId: 'pact' }` followed by a `POST /api/games/:id/config` inject with `{ playerCount: 2, turnMinutes: 60 }` where the test depends on a 2-seat table (the lifecycle test does — it joins bob to auto-start).
- IMPORTANT — tests that resolve turns and assert incomes/armies now run under the anti-turtle economy (plunder 1, delta −1, growth 0). Prefer asserting through the helper with an explicit `presetId: 'pact'`; where an existing assertion hard-codes an income or garrison number that shifts, recalculate it against the preset rules rather than forcing legacy values in.

- [ ] **Step 4: Run the server suite** — `pnpm test:server && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — message: `Server: games are created from a preset; lobby config carries the rest`

---

### Task 9: Web — API client and preset-card Home

**Files:**
- Modify: `packages/web/src/api.ts` (updateConfig)
- Modify: `packages/web/src/pages/Home.tsx` (create section)
- Modify: `packages/web/src/styles.css` (preset cards)
- Test: `packages/web/src/pages/Home.test.tsx` (new)

**Interfaces:**
- Consumes: `PRESETS` from `@www/engine`; `CreateGameRequest`/`UpdateConfigRequest` (Tasks 7–8).
- Produces: `api.updateConfig(id: string, req: UpdateConfigRequest): Promise<GameView>`; Home preset cards with `data-testid={preset-${id}}`. Task 10 uses `api.updateConfig`.

- [ ] **Step 1: Write the failing test** — `packages/web/src/pages/Home.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../api.js', () => ({
  api: { listGames: vi.fn().mockResolvedValue([]), createGame: vi.fn().mockResolvedValue({ id: 'g9' }) },
  ApiError: class extends Error {},
}));

const { api } = await import('../api.js');
const { Home } = await import('./Home.js');

describe('Home', () => {
  it('creates a game from a preset card', async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    expect(screen.getByText('Pact Blitz')).toBeDefined();
    expect(screen.getByText('Tiers v2')).toBeDefined();
    fireEvent.click(screen.getByTestId('preset-tiers-v2'));
    await waitFor(() => expect(vi.mocked(api.createGame)).toHaveBeenCalledWith({ presetId: 'tiers-v2' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/web/src/pages/Home.test.tsx`
Expected: FAIL — no preset cards rendered.

- [ ] **Step 3: Implement**

`api.ts` — add below `start`:

```ts
  updateConfig: (id: string, req: UpdateConfigRequest) =>
    apiFetch<GameView>('POST', `/api/games/${id}/config`, req),
```

(add `UpdateConfigRequest` to the type import).

`Home.tsx` — delete `TURN_LENGTHS`, `GAME_LENGTHS` and the `playerCount`/`turnMinutes`/`contest`/`turnCap` state; import `PRESETS` from `@www/engine`; replace the create handler and form:

```tsx
  const create = async (presetId: string) => {
    setCreating(true);
    try {
      const { id } = await api.createGame({ presetId });
      await navigate(`/g/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to create game');
      setCreating(false);
    }
  };
```

```tsx
      <section className="panel">
        <h2>New game</h2>
        <p className="muted">Pick a mode — players, turn length and game length are set in the lobby.</p>
        <div className="preset-grid">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              data-testid={`preset-${preset.id}`}
              className="preset-card"
              disabled={creating}
              onClick={() => void create(preset.id)}
            >
              <strong>{preset.name}</strong>
              <span>{preset.tagline}</span>
              <span className="muted">
                {preset.defaultTurnCap} turns · {formatTurnMinutes(preset.defaultTurnMinutes)}/turn
              </span>
            </button>
          ))}
        </div>
      </section>
```

with a tiny local helper above the component:

```ts
const formatTurnMinutes = (minutes: number): string =>
  minutes % 1440 === 0 && minutes >= 1440
    ? `${minutes / 1440}d`
    : minutes % 60 === 0 && minutes >= 60
      ? `${minutes / 60}h`
      : `${minutes}m`;
```

`styles.css` — follow the file's existing variable/spacing conventions:

```css
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.75rem;
}
.preset-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  align-items: flex-start;
  text-align: left;
  padding: 0.85rem 1rem;
}
```

- [ ] **Step 4: Run web tests** — `pnpm vitest run packages/web && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — message: `Web: create a game by picking a preset card`

---

### Task 10: Web — lobby Game setup panel

**Files:**
- Create: `packages/web/src/game/GameSetup.tsx`
- Modify: `packages/web/src/pages/Lobby.tsx` (mount panel, show preset name)
- Modify: `packages/web/src/styles.css` (if the form rows need anything beyond existing `.form-row`)
- Test: `packages/web/src/game/GameSetup.test.tsx` (new)

**Interfaces:**
- Consumes: `GameView.presetId/presetName/turnMinutes/turnCap/rules/playerCount/mySlot/seats` (Task 8), `api.updateConfig` (Task 9), `presetById`, `MIN_PLAYERS`, `MAX_PLAYERS`, `MIN_TURN_CAP`, `MAX_TURN_CAP` from `@www/engine`.
- Produces: `GameSetup({ view, onChanged })` component.

- [ ] **Step 1: Write the failing test** — `packages/web/src/game/GameSetup.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { GameView } from '@www/server/api-types';
import { rulesFor } from '@www/engine';

vi.mock('../api.js', () => ({
  api: { updateConfig: vi.fn() },
  ApiError: class extends Error {},
}));

const { api } = await import('../api.js');
const { GameSetup } = await import('./GameSetup.js');

const view = (over: Partial<GameView>): GameView =>
  ({
    id: 'g1',
    status: 'lobby',
    playerCount: 4,
    seats: [],
    turn: 1,
    deadlineAt: null,
    turnMinutes: 60,
    contest: 'pact',
    turnCap: 15,
    rules: rulesFor(4, 15, 'pact'),
    presetId: 'pact-blitz',
    presetName: 'Pact Blitz',
    tiersTopic: null,
    lobbyListSlots: [],
    map: {} as GameView['map'],
    state: null,
    mySlot: 0,
    myOrders: null,
    myLocked: false,
    lockedSlots: [],
    latestReport: null,
    result: null,
    ...over,
  }) as GameView;

describe('GameSetup', () => {
  it('creator edits player count', async () => {
    vi.mocked(api.updateConfig).mockResolvedValue(view({}));
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<GameSetup view={view({})} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText(/players/i), { target: { value: '6' } });
    await waitFor(() =>
      expect(vi.mocked(api.updateConfig)).toHaveBeenCalledWith('g1', { playerCount: 6 }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('turn length edits convert units to minutes on blur', async () => {
    vi.mocked(api.updateConfig).mockResolvedValue(view({}));
    render(<GameSetup view={view({ turnMinutes: 60 })} onChanged={vi.fn().mockResolvedValue(0)} />);
    const value = screen.getByLabelText(/^turn length$/i); // exact — the unit select is named 'turn length unit'
    fireEvent.change(value, { target: { value: '2' } }); // unit is 'hours' for 60m
    fireEvent.blur(value);
    await waitFor(() =>
      expect(vi.mocked(api.updateConfig)).toHaveBeenCalledWith('g1', { turnMinutes: 120 }),
    );
  });

  it('non-creators see settings read-only', () => {
    render(<GameSetup view={view({ mySlot: 1 })} onChanged={vi.fn()} />);
    expect(screen.queryByLabelText(/players/i)).toBeNull();
    expect(screen.getByText(/4 players/i)).toBeDefined();
    expect(screen.getByText(/15 turns/i)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/web/src/game/GameSetup.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement** — `packages/web/src/game/GameSetup.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { GameView, UpdateConfigRequest } from '@www/server/api-types';
import { MAX_PLAYERS, MIN_PLAYERS, MAX_TURN_CAP, MIN_TURN_CAP, presetById } from '@www/engine';

import { api, ApiError } from '../api.js';

type Unit = 'minutes' | 'hours' | 'days';
const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

const unitOf = (minutes: number): Unit =>
  minutes % 1440 === 0 && minutes >= 1440 ? 'days' : minutes % 60 === 0 && minutes >= 60 ? 'hours' : 'minutes';

const describeTurnLength = (minutes: number): string =>
  minutes % 1440 === 0 && minutes >= 1440
    ? `${minutes / 1440}-day`
    : minutes % 60 === 0 && minutes >= 60
      ? `${minutes / 60}-hour`
      : `${minutes}-minute`;

interface Props {
  view: GameView;
  onChanged: () => Promise<unknown>;
}

export function GameSetup({ view, onChanged }: Props) {
  const isCreator = view.mySlot === 0;
  const preset = view.presetId !== null ? presetById(view.presetId) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local drafts for the two number inputs; committed on blur.
  const [unit, setUnit] = useState<Unit>(unitOf(view.turnMinutes));
  const [turnValue, setTurnValue] = useState(String(view.turnMinutes / UNIT_MINUTES[unitOf(view.turnMinutes)]));
  const [capValue, setCapValue] = useState(String(view.turnCap));
  useEffect(() => {
    const u = unitOf(view.turnMinutes);
    setUnit(u);
    setTurnValue(String(view.turnMinutes / UNIT_MINUTES[u]));
    setCapValue(String(view.turnCap));
  }, [view.turnMinutes, view.turnCap]);

  const apply = async (req: UpdateConfigRequest) => {
    setBusy(true);
    setError(null);
    try {
      await api.updateConfig(view.id, req);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  };

  const commitTurnLength = (nextUnit: Unit, rawValue: string) => {
    const minutes = Math.round(Number(rawValue) * UNIT_MINUTES[nextUnit]);
    if (!Number.isFinite(minutes) || minutes === view.turnMinutes) return;
    void apply({ turnMinutes: minutes });
  };

  const commitCap = (rawValue: string) => {
    const turnCap = Number(rawValue);
    if (!Number.isInteger(turnCap) || turnCap === view.turnCap) return;
    void apply({ turnCap });
  };

  return (
    <div className="game-setup">
      <h3>
        Game setup — {view.presetName}
        {preset !== null && <span className="muted"> · {preset.tagline}</span>}
      </h3>
      {isCreator ? (
        <div className="form-row">
          <label>
            Players{' '}
            <select
              value={view.playerCount}
              disabled={busy}
              onChange={(e) => void apply({ playerCount: Number(e.target.value) })}
            >
              {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map(
                (n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Turn length{' '}
            <input
              type="number"
              min={1}
              value={turnValue}
              disabled={busy}
              onChange={(e) => setTurnValue(e.target.value)}
              onBlur={() => commitTurnLength(unit, turnValue)}
            />
          </label>
          <select
            aria-label="turn length unit"
            value={unit}
            disabled={busy}
            onChange={(e) => {
              const nextUnit = e.target.value as Unit;
              setUnit(nextUnit);
              commitTurnLength(nextUnit, turnValue);
            }}
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
          <label>
            Game length{' '}
            <input
              type="number"
              min={MIN_TURN_CAP}
              max={MAX_TURN_CAP}
              value={capValue}
              disabled={busy}
              onChange={(e) => setCapValue(e.target.value)}
              onBlur={() => commitCap(capValue)}
            />
          </label>
          <span className="muted">turns</span>
        </div>
      ) : (
        <p className="muted">
          {view.playerCount} players · {describeTurnLength(view.turnMinutes)} turns · {view.turnCap}{' '}
          turns
        </p>
      )}
      <p className="muted">
        Storm begins ~turn {view.rules.stormFirstWave} · standings decide at turn {view.turnCap}.
      </p>
      {error !== null && <p className="error">{error}</p>}
    </div>
  );
}
```

`Lobby.tsx` — under the `<h2>` line add:

```tsx
      <GameSetup view={view} onChanged={onChanged} />
```

with the import `import { GameSetup } from '../game/GameSetup.js';`.

- [ ] **Step 4: Run web tests** — `pnpm vitest run packages/web && pnpm typecheck`. Expected: PASS. If a test hits validation quirks (e.g. server 400 surfaced through the mocked ApiError), fix the component, not the test intent.

- [ ] **Step 5: Commit** — message: `Web: lobby game-setup panel — players, fine-grained turn length and game length`

---

### Task 11: Web — plunder and tiers income in the report and help panels

**Files:**
- Modify: `packages/web/src/game/ReportView.tsx` (plunder list + tiers income lines)
- Modify: `packages/web/src/game/HowCombatWorks.tsx` (income-mode copy + plunder bullet)
- Modify: `packages/web/src/pages/Game.tsx` (pass the new prop to HowCombatWorks — check its call site with grep)
- Test: none new (these are copy/JSX changes; the engine types force correct field access) — rely on `pnpm typecheck` and existing web tests.

**Interfaces:**
- Consumes: `TurnReport.plunder`, `TiersResult.incomeDelta` (Tasks 3–4), `view.rules.tiersPayout`.

- [ ] **Step 1: ReportView** — after the battles `<ul>` block (line ~121):

```tsx
      {(report.plunder ?? []).length > 0 && (
        <ul className="report-list">
          {(report.plunder ?? []).map((p) => (
            <li key={`pl${p.slot}`}>
              <Dot slot={p.slot} /> {seatName(p.slot)} plundered {p.captures}{' '}
              {p.captures === 1 ? 'province' : 'provinces'} (+{p.income}{' '}
              {p.income === 1 ? 'army' : 'armies'} next turn)
            </li>
          ))}
        </ul>
      )}
```

(`report.plunder ?? []` — reports stored before this feature lack the field.)

In the tiers section, inside the per-result `<li>` after the `bestRead` block, add the income line:

```tsx
                {view.rules.tiersPayout === 'income' && t.incomeDelta !== 0 && (
                  <div className={t.incomeDelta > 0 ? 'concord' : 'betrayal'}>
                    {t.incomeDelta > 0 ? '+' : ''}
                    {t.incomeDelta} armies from the tiers
                  </div>
                )}
```

(`view.rules` is always the effective rules from the server; `t.incomeDelta` may be undefined on pre-feature stored reports — guard with `(t.incomeDelta ?? 0) !== 0` and render `t.incomeDelta ?? 0`.)

- [ ] **Step 2: HowCombatWorks** — change the signature to take the payout and describe both economies:

```tsx
import type { ContestKind, TiersPayout } from '@www/engine';

export function HowCombatWorks({
  contest,
  tiersPayout,
}: {
  contest: ContestKind;
  tiersPayout: TiersPayout;
}) {
  const incomeMode = contest === 'tiers' && tiersPayout === 'income';
```

Replace the "Contest multiplier" `<li>` with:

```tsx
        {incomeMode ? (
          <li>
            <strong>Contest multiplier</strong> — none in this mode. Everyone fights at ×1.00;
            your tier-list reads pay (or cost) armies directly instead. Only the dice separate
            two equal stacks.
          </li>
        ) : (
          <li>
            <strong>Contest multiplier</strong> — ×0.80 to ×1.40 from {contestSource}. This is
            the biggest lever in the game: a 1.40 against a 0.80 is nearly a 2:1 edge before a
            die is rolled. Neutral garrisons always fight at ×1.00.
          </li>
        )}
```

and add a plunder bullet after "The cost of winning":

```tsx
        <li>
          <strong>Plunder</strong> — every territory you capture pays +1 army next turn (up to
          +3 a turn). Expansion pays for itself; sitting still does not.
        </li>
```

Update the call site in `Game.tsx` (grep `HowCombatWorks`) to pass `tiersPayout={view.rules.tiersPayout}`. If the game predates plunder, the bullet is mildly wrong for it — acceptable: help text describes current games, and active legacy games keep resolving correctly regardless. Gate it if trivial: `{view.rules.plunderIncome > 0 && (<li>…</li>)}`. Prefer the gate.

- [ ] **Step 3: Run web tests + typecheck** — `pnpm vitest run packages/web && pnpm typecheck`. Expected: PASS.

- [ ] **Step 4: Commit** — message: `Web: report and help panels surface plunder and tiers income`

---

### Task 12: Balance harness preset runs + full verification

**Files:**
- Modify: `tools/simulate/src/main.ts` (add `--preset` flag)
- Test: manual sim runs; full repo sweep.

**Interfaces:**
- Consumes: `presetById`, `presetRules` (Task 5), existing `playBotGame({ rules })` option.

- [ ] **Step 1: Add the flag** — in `parseArgs`, add `preset: null as string | null` to the defaults and a case:

```ts
      case '--preset':
        options.preset = value;
        i++;
        break;
```

Where games are constructed (the loop calling `playBotGame` — read the file to find it), resolve rules per player count:

```ts
    const preset = options.preset !== null ? presetById(options.preset) : null;
    if (options.preset !== null && preset === null) {
      console.error(`unknown preset: ${options.preset}`);
      process.exit(2);
    }
    // inside the per-playerCount loop:
    const rules = preset !== null ? presetRules(preset, playerCount, preset.defaultTurnCap) : undefined;
    // pass { ..., rules } into playBotGame's options
```

(`playBotGame` already accepts `rules?: RuleConfig` and defaults to `rulesFor(playerCount)` — the no-flag behavior is byte-identical legacy tuning.)

- [ ] **Step 2: Run the sims** — for each preset:

```
pnpm sim -- --games 400 --players 4,6 --preset pact --no-gates
pnpm sim -- --games 400 --players 4,6 --preset tiers --no-gates
pnpm sim -- --games 400 --players 4,6 --preset pact-blitz --no-gates
pnpm sim -- --games 400 --players 4,6 --preset tiers-v2 --no-gates
```

`--no-gates` because the gates were tuned for the legacy economy. Read the reports for: median game length (blitz presets should land well under 15; classic presets should not balloon past ~20), seat fairness, and degenerate endings (one victory route swallowing >70% of games). If a number is badly off, adjust ONLY the preset-layer values in `presets.ts`/`presetRules` (plunder cap, garrison delta, war economy interval) and re-run — never the legacy defaults. Also run the harness's default gated mode once — `pnpm sim -- --games 400 --players 4,6` — which must still pass, proving legacy tuning is untouched.

- [ ] **Step 3: Record findings** — write the observed medians and any retuning into the commit message body.

- [ ] **Step 4: Full sweep** — `pnpm typecheck && pnpm test && pnpm test:server && pnpm lint`. Expected: all PASS (server suite must show tests *run*, not skipped).

- [ ] **Step 5: Commit** — message: `Sim: --preset flag; balance notes for the four presets` (+ findings in the body)

---

## Self-Review Notes

- Spec coverage: presets (§1→T5), RuleConfig+call sites (§2→T1–T2), anti-turtle (§3→T2–T3), tiers v2 (§4→T4), server create/config/view (§5→T6–T8), web (§6→T9–T11), compatibility (§7→T6 helper + legacy defaults in T1; legacy-lobby activation covered because `activate()` uses `effectiveRules`), testing/balance (§8→every task + T12).
- The spec's "storm-collapsed capture still counts" rule is guaranteed structurally (plunder is counted before `applyStorm` in the same function) rather than by a dedicated test.
- Type consistency spot-checks: `computeIncome(state, map, slot, rules)` used in T2 tests and T2 implementation; `presetRules(preset, playerCount, turnCap)` consistent across T5/T7/T8/T12; `GameView.presetId/presetName` consistent across T8/T10; `TiersResult.incomeDelta` across T4/T11; `TurnReport.plunder` across T3/T11.
