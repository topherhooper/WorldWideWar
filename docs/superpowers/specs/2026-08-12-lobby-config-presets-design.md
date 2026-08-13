# Lobby Configuration, Game Presets, Anti-Turtle Economy & Tiers v2 — Design

Date: 2026-08-12
Status: Approved pending spec review

## Summary

Four connected changes:

1. **Presets replace the creation form.** Creating a game is one click on a preset card; the
   preset fixes the game's identity (contest, payout mode, pacing) and seeds sensible defaults
   for everything else. The preset is immutable after creation.
2. **The lobby becomes the configuration surface.** The creator edits players, turn length and
   game length inside the lobby until the game starts; everyone seated sees the live settings.
   Turn length and game length become fine-grained inputs instead of fixed menus.
3. **An anti-turtle economy, for every new game.** Neutral garrison growth rewarded sitting
   still in practice — neutrals fattened into stacks nobody would burn armies on and the map
   froze. It is removed for all new games; neutrals start weaker; and capturing territory pays
   immediate, visible plunder income. Expansion becomes the correct *and* obvious move.
4. **Tiers v2 and Pact Blitz** — two new fast-paced presets. Tiers v2 additionally changes the
   tiers payout: guess scores pay **income** directly instead of a combat multiplier.

**Active games are untouched throughout.** Every number that changes moves into stored
per-game rules, and the legacy-default layer (`DEFAULT_RULES` / `rulesFor`) keeps emitting
today's values so the stored-rules-win merge resolves old games exactly as before. What changes
is what *newly created* games get, via a second layer (`presetRules`).

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
}

export const PRESETS: readonly GamePreset[];
export function presetById(id: string): GamePreset | null;
export function presetRules(preset: GamePreset, playerCount: number, turnCap: number): RuleConfig;
```

| Preset | Contest | Payout | Cap | Turn | War economy |
| ---------- | ----- | ---------- | -- | ---- | ------------- |
| Pact | pact | multiplier | 25 | 24 h | every 5 turns |
| Tiers | tiers | multiplier | 25 | 24 h | every 5 turns |
| Pact Blitz | pact | multiplier | 15 | 1 h | every 3 turns |
| Tiers v2 | tiers | income | 15 | 1 h | every 3 turns |

All four presets share the anti-turtle economy (§3): `neutralGrowthInterval: 0`,
`neutralGarrisonDelta: -1`, `plunderIncome: 1`, `plunderCap: 3`.

`presetRules` wraps the existing `rulesFor(playerCount, turnCap, contest)` and overlays the
preset's pacing fields, the anti-turtle values, and `tiersPayout`. Storm timing needs no new
knob: `rulesFor` already derives `stormFirstWave` and `stormInterval` from the turn cap, so a
15-turn blitz gets its storm around turn 6 for free.

Blitz pacing and the anti-turtle numbers are first-pass values on the existing tuning surface;
the balance harness (`pnpm sim`) validates them during implementation and they live in
`presets.ts` where retuning is a one-line change.

## 2. RuleConfig grows economy and payout fields

Six fields join `RuleConfig`. **Their defaults in `DEFAULT_RULES`/`rulesFor` equal today's
behavior** — that layer exists for the stored-rules-win merge in `games.ts`
(`{ ...rulesFor(...), ...game.rules }`), so legacy docs missing these fields resolve exactly
as they do now. New games never see these defaults; they are created through `presetRules`.

```ts
interface RuleConfig {
  // ...existing fields...
  /** The war economy ramps: +1 income every N turns. */
  warEconomyInterval: number; // legacy default 5
  /** Neutral garrisons grow every N turns; 0 = never. */
  neutralGrowthInterval: number; // legacy default 3; every preset sets 0
  /** Added to each mapgen neutral garrison at setup, floored at 1. */
  neutralGarrisonDelta: number; // legacy default 0; every preset sets -1
  /** Bonus income next turn per territory captured this turn. */
  plunderIncome: number; // legacy default 0; every preset sets 1
  /** Most captures that pay plunder in one turn. */
  plunderCap: number; // default 3
  /** How tiers scores land: combat multiplier (v1) or direct income (v2). */
  tiersPayout: TiersPayout; // default 'multiplier'
}
```

Call-site changes:

- `income.ts` reads `rules.warEconomyInterval` instead of `WAR_ECONOMY_INTERVAL`.
- `resolve.ts` `growNeutrals` reads `ctx.rules.neutralGrowthInterval`; an interval of 0
  disables growth entirely.
- `setup.ts` applies `neutralGarrisonDelta` when seeding armies from `map.neutralGarrisons`,
  flooring each garrison at 1. Mapgen is untouched — the map still records its baseline
  garrisons (2, +1 centre, +1 crossroads).
- The old constants remain only as the legacy defaults inside `DEFAULT_RULES`.

## 3. Anti-turtle economy

The problem: growing neutrals made expansion steadily pricier, capturing cost armies now for
+1 income per 3 territories later, and the player who hoarded armies beat the player who spent
them cracking neutral stacks. Several mechanics quietly told players the best move was no move.

Three changes, applied to **all presets** (new games only):

1. **Neutral growth removed** (`neutralGrowthInterval: 0`). Neutrals stay the cheap land grab
   they start as; the map never freezes behind fattened garrisons.
2. **Weaker neutral starts** (`neutralGarrisonDelta: -1`). Baseline neutrals hold 1 army
   (centre and crossroads 2), so the early rush is fast and the first turns are about racing
   rivals, not grinding garrisons.
3. **Plunder on capture** (`plunderIncome: 1`, `plunderCap: 3`). Each territory you capture —
   neutral or rival — pays +1 income next turn, up to +3 per turn. Expansion pays immediately
   and legibly, not vaguely through the /3 income divisor.

Plunder resolution: captures are counted when resolution transfers ownership (combat wins and
walk-ins alike); a capture the storm collapses the same turn still counts — the armies were
spent. The bonus flows through the existing `pendingBonusIncome` channel. `TurnReport` gains
`plunder: { slot: Slot; captures: number; income: number }[]` (entries only for slots that
plundered) so the report can say "Dana plundered 3 provinces (+3 armies)"; `ReportView` and
the income affordances in the web client surface it.

Idle-army decay was considered and rejected for now — invasive to engine state for unclear
gain once expansion actually pays.

## 4. Tiers v2 — income replaces the multiplier

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
reports for active Tiers games.

## 5. Server

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

## 6. Web

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

Help panels (`HowCombatWorks`, `HowToWin`) describe plunder, and describe tiers income when
`tiersPayout === 'income'` instead of the multiplier text.

## 7. Compatibility

- **Active/finished games:** stored rules win in the merge; the new `RuleConfig` fields
  default to today's constants in the legacy layer; setup-time changes (garrison delta) only
  ever run at creation. No behavior change, no migration.
- **Legacy lobby games** (created before this ships, still in lobby): no `presetId` → treated
  as the preset matching their contest; config editing works. They were created under the old
  map/setup path but activate under the new code — `neutralGarrisonDelta` defaults to 0 for
  them via the merge, so their neutrals seed as generated.
- **"Classic" presets are today's contests, not today's economy:** new Pact/Tiers games get
  the anti-turtle economy deliberately. Nothing labeled classic promises the old neutral
  growth back.
- `CreateGameRequest`'s old shape is dropped — the web client is the only consumer and ships
  in the same deploy.

## 8. Testing

- **Engine:** `presets.test.ts` — each preset's rules against expected values, including the
  anti-turtle fields on all four. `tiers.test.ts` additions — income mode: multipliers all
  100, income deltas per the formula, negative wagers, author bonus, `incomeDelta` in results;
  multiplier mode unchanged. `setup` tests for the garrison delta and its floor. `resolve`
  tests for interval-0 neutral growth, rules-driven `warEconomyInterval`, and plunder
  (counting, cap, storm-collapsed capture, report entries).
- **Server:** create-with-preset (each id, bad id 400); config endpoint — authorization (403
  non-creator), lifecycle (409 active), bounds (400), player-count shrink with occupied seat
  (409), map regeneration on player-count change, rules rebuild on cap change; legacy-doc view
  fallback (rules merge yields today's values).
- **Web:** Home renders presets and creates; Lobby config panel — creator editable,
  non-creator read-only, unit conversion for turn length, server error surfacing; ReportView
  plunder line; TiersPanel income mode.
- **Balance:** run `pnpm sim` with `presetRules` output for all four presets — the harness
  gates (seat fairness, game length, betrayal rate, shared-win rate) were tuned before the
  anti-turtle economy, so treat failures as signals to retune the new numbers (plunder cap,
  garrison delta, blitz pacing) and record findings in the plan.

## Out of scope

- Switching presets inside the lobby (delete + recreate covers it).
- A pace dial or per-knob rule editing beyond players / turn length / game length.
- Idle-army decay or supply-based turtle punishment (revisit if plunder is not enough).
- Sim-harness gate profiles specific to blitz pacing (follow-up if blitz feel is off).
