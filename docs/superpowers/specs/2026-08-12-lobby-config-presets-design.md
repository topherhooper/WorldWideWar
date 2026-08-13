# Lobby Configuration, Game Presets & Tiers v2 — Design

Date: 2026-08-12
Status: Approved pending spec review

## Summary

Three connected changes:

1. **Presets replace the creation form.** Creating a game is one click on a preset card; the
   preset fixes the game's identity (contest, payout mode, pacing) and seeds sensible defaults
   for everything else. The preset is immutable after creation.
2. **The lobby becomes the configuration surface.** The creator edits players, turn length and
   game length inside the lobby until the game starts; everyone seated sees the live settings.
   Turn length and game length become fine-grained inputs instead of fixed menus.
3. **Tiers v2 and Pact Blitz** — two new fast-paced presets. Tiers v2 additionally changes the
   tiers payout: guess scores pay **income** directly instead of a combat multiplier. Active
   games are untouched: the pacing numbers a game plays under move into its stored rules, and
   the classic Pact and Tiers presets reproduce today's tuning exactly.

## 1. Presets

New module `packages/engine/src/presets.ts`:

```ts
export type PresetId = 'pact' | 'tiers' | 'pact-blitz' | 'tiers-v2';
export type TiersPayout = 'multiplier' | 'income';

export interface GamePreset {
  id: PresetId;
  name: string;
  tagline: string;
  contest: ContestKind;
  tiersPayout: TiersPayout;
  defaultTurnCap: number;
  defaultTurnMinutes: number;
  /** Pacing overrides layered onto rulesFor. */
  warEconomyInterval: number;
  neutralGrowthInterval: number;
}

export const PRESETS: readonly GamePreset[];
export function presetById(id: string): GamePreset | null;
export function presetRules(preset: GamePreset, playerCount: number, turnCap: number): RuleConfig;
```

| Preset | Contest | Payout | Cap | Turn | War economy | Neutral growth |
| ------------- | ----- | ---------- | -- | ----- | ---------- | -------------- |
| Pact | pact | multiplier | 25 | 24 h | every 5 turns | every 3 turns |
| Tiers | tiers | multiplier | 25 | 24 h | every 5 turns | every 3 turns |
| Pact Blitz | pact | multiplier | 15 | 1 h | every 3 turns | every 2 turns |
| Tiers v2 | tiers | income | 15 | 1 h | every 3 turns | every 2 turns |

`presetRules` wraps the existing `rulesFor(playerCount, turnCap, contest)` and overlays the
preset's pacing fields plus `tiersPayout`. Storm timing needs no new knob: `rulesFor` already
derives `stormFirstWave` and `stormInterval` from the turn cap, so a 15-turn blitz gets its
storm around turn 6 for free.

Blitz pacing numbers (war economy 3, neutral growth 2) are first-pass values on the existing
tuning surface; the balance harness (`pnpm sim`) validates them during implementation and they
live in `presets.ts` where retuning is a one-line change.

## 2. RuleConfig grows pacing and payout fields

Three fields join `RuleConfig`, each defaulting to today's constant so the stored-rules-win
merge in `games.ts` (`{ ...rulesFor(...), ...game.rules }`) leaves every existing game playing
exactly as it does now:

```ts
interface RuleConfig {
  // ...existing fields...
  /** The war economy ramps: +1 income every N turns, for everyone. */
  warEconomyInterval: number; // default 5
  /** Neutral garrisons grow every N turns. */
  neutralGrowthInterval: number; // default 3
  /** How tiers scores land: combat multiplier (v1) or direct income (v2). */
  tiersPayout: TiersPayout; // default 'multiplier'
}
```

Call-site changes:

- `income.ts` reads `rules.warEconomyInterval` instead of `WAR_ECONOMY_INTERVAL`
  (`computeIncome`/`recomputeIncome` gain access to rules via their existing callers).
- `resolve.ts:574` reads `ctx.rules.neutralGrowthInterval` instead of `NEUTRAL_GROWTH_INTERVAL`.
- The old constants remain only as the defaults inside `DEFAULT_RULES`.

## 3. Tiers v2 — income replaces the multiplier

`ContestContext` (`packages/engine/src/contest/types.ts`) gains `rules: RuleConfig` — the
resolution pipeline already holds the rules and both contests are called through the one
interface, so this is threading, not restructuring. Then in `resolveTiers`
(`packages/engine/src/contest/tiers.ts`), when `context.rules.tiersPayout === 'income'`:

- **Every player's combat multiplier is 100.** Combat variance comes only from the dice nudge.
- Guess points convert to armies through the existing `bonusIncome` →
  `pendingBonusIncome` channel the pact already uses for the courted bonus:
  - Per guess: `Math.trunc((score − NEUTRAL_SCORE) / 2)` income — range −3…+3 per guess,
    −6…+6 across the two-guess maximum. A wild guess still costs, now in armies.
  - Author: `Math.ceil(Math.max(0, bestRead − NEUTRAL_SCORE) / 2)` income — 0…+3. Being
    read well still pays the author and being illegible still earns nothing.
- A player's total tiers income delta may be negative; `computeIncome` already floors the
  final figure at 0, so nobody pays armies they do not have.
- `TiersResult` gains `incomeDelta: number` (0 in multiplier games) so reports and panels can
  say "+2 armies from your read of Dana" explicitly. Divisors are constants in `tiers.ts`
  beside the existing scoring weights.

Multiplier-mode resolution is untouched — same code path, same numbers, byte-identical
reports for classic Tiers games.

## 4. Server

**Create.** `CreateGameRequest` becomes `{ presetId: string }`. Validation: `presetById` must
resolve. The doc stores `presetId` and is created with the preset's defaults:
`playerCount: 4`, `turnMinutes: preset.defaultTurnMinutes`, `rules: presetRules(preset, 4,
preset.defaultTurnCap)`. `GameDoc` gains `presetId?: string` (absent on legacy docs).

**Configure.** New endpoint `POST /api/games/:id/config`, creator-only, lobby-only:

```ts
interface UpdateConfigRequest {
  playerCount?: number; // 2–12 (MIN_PLAYERS–MAX_PLAYERS)
  turnMinutes?: number; // 5–10080, any integer
  turnCap?: number;     // 10–50 (MIN_TURN_CAP–MAX_TURN_CAP), any integer
}
```

Runs in a transaction. Rules are rebuilt with `presetRules(preset, playerCount, turnCap)` on
any change so player-count- and cap-derived values (domination share, storm timing) stay
consistent. Changing `playerCount`:

- rejected with 409 if any seat at index ≥ the new count is taken (seats keep their indices;
  nobody is ever silently unseated or moved);
- regenerates the map with a fresh seed and resizes the seats array.

Legacy games without `presetId` never hit this endpoint's preset lookup in practice (they are
all active or finished), but the code falls back to the preset matching their stored contest.

**View.** `GameView` gains `presetId: string | null` and `presetName: string` (derived, with
the contest-based fallback for legacy docs). Existing fields already expose `turnMinutes`,
`turnCap`, `contest`, and full `rules` — the lobby reads live values from there, including
`rules.stormFirstWave` for the "storm begins ~turn N" hint.

## 5. Web

**Home.** The four-field form is replaced by four preset cards (name, tagline, default cap and
turn length on each). Clicking a card calls `createGame({ presetId })` and navigates to the
lobby. The "Your games" list is unchanged.

**Lobby.** New "Game setup" panel above the seat list, titled with the preset name and tagline:

- **Players** — select 2–12. Errors from the server (seats occupied) surface inline.
- **Turn length** — number input + unit select (minutes / hours / days), stored as minutes,
  bounds 5 min–1 week enforced client- and server-side.
- **Game length** — number input, 10–50 turns, with the live hint
  "storm begins ~turn {rules.stormFirstWave} · standings decide at turn {turnCap}".

The creator sees editable controls; each change fires the config call immediately (selects) or
on blur/debounce (number inputs), then refreshes the view. Non-creators see the same values
read-only, updated by the lobby's existing refresh mechanism. The rest of the lobby (seats,
tier-list editor, start/delete) is unchanged.

## 6. Compatibility

- **Active/finished games:** stored rules win in the merge; new `RuleConfig` fields default to
  the current constants; classic presets emit today's numbers. No behavior change, no
  migration.
- **Legacy lobby games** (created before this ships, still in lobby): no `presetId` → treated
  as the preset matching their contest; config editing works.
- `CreateGameRequest`'s old shape is dropped — the web client is the only consumer and ships
  in the same deploy.

## 7. Testing

- **Engine:** `presets.test.ts` — each preset's rules against expected values; classic presets
  produce rules deep-equal to today's `rulesFor` output plus defaulted new fields.
  `tiers.test.ts` additions — income mode: multipliers all 100, income deltas per the formula,
  negative wagers, author bonus, `incomeDelta` in results; multiplier mode unchanged.
  Income/resolve tests for rules-driven `warEconomyInterval`/`neutralGrowthInterval`.
- **Server:** create-with-preset (each id, bad id 400); config endpoint — authorization (403
  non-creator), lifecycle (409 active), bounds (400), player-count shrink with occupied seat
  (409), map regeneration on player-count change, rules rebuild on cap change; legacy-doc view
  fallback.
- **Web:** Home renders presets and creates; Lobby config panel — creator editable,
  non-creator read-only, unit conversion for turn length, server error surfacing.
- **Balance:** run `pnpm sim` for Pact Blitz and Tiers v2 configurations; adjust blitz pacing
  numbers if gates fail badly (gates are tuned for standard pace — treat results as a sanity
  check, not a hard gate, and record findings in the plan).

## Out of scope

- Switching presets inside the lobby (delete + recreate covers it).
- A pace dial or per-knob rule editing beyond players / turn length / game length.
- Retuning the classic presets — their numbers do not move.
- Sim-harness gate profiles specific to blitz pacing (follow-up if blitz feel is off).
