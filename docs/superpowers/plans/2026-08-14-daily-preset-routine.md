# Daily Game Preset Routine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a scheduled Claude session add one game preset per day without the catalogue, the home page or the test suite degrading, per the approved spec `docs/superpowers/specs/2026-08-14-daily-preset-routine-design.md`.

**Architecture:** `PRESETS` becomes an append-only dated catalogue: `GamePreset` gains an optional `featuredOn` ISO date, `PresetId` widens to `string`, and one new pure selector `presetsForDate(isoDate)` returns the evergreen presets plus that day's daily. The web home page calls it with the current UTC date instead of mapping `PRESETS`, so the grid features one daily at a time while `presetById` keeps resolving every preset ever shipped. `presets.test.ts` is rewritten from an exact-list assertion into a validator run over every entry — bounds, uniqueness and tuning novelty — which is what makes a generated preset either land or turn CI red. The generator's instructions live in `.claude/commands/daily-preset.md`; the schedule that invokes it lives outside this repository.

**Tech Stack:** TypeScript ESM monorepo (pnpm), Vitest, Fastify + Firestore (server, tested against the emulator), React 19 + react-router (web).

## Global Constraints

- **The catalogue is append-only.** A daily preset is never edited or deleted after it ships: finished games store `presetId`, and `GameView.presetName` resolves through `presetById` forever. Retuning a preset that has already been played rewrites history for games in flight.
- **The engine stays clock-free.** `presetsForDate` takes the date as an argument. The web client supplies it; ESLint's purity rules would reject anything else.
- **Stored documents predate your change.** `featuredOn` is optional and read only by the home page. Legacy `GameDoc`s without `presetId` keep falling back through `presetById(game.presetId ?? contest)` exactly as they do now.
- **`exactOptionalPropertyTypes` is on.** `featuredOn?: string` means absent or a string, never explicitly `undefined` — build preset literals without the key rather than with `featuredOn: undefined`.
- **No new tuning knobs.** Everything in this plan composes the fields `GamePreset` already has.
- Commands: full gate `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm test:server`. `pnpm format:check` is unreliable locally — use `pnpm exec prettier --check --end-of-line auto .`
- Commit after every task, ticking that task's checkboxes in this file in the same commit, then push.

## File Structure

| File                               | Role                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `packages/engine/src/constants.ts` | Gains `MIN_TURN_MINUTES` / `MAX_TURN_MINUTES` beside the turn-cap bounds |
| `packages/engine/src/presets.ts`   | `featuredOn`, `PresetId` widened, `presetsForDate`, and the seeded daily |
| `packages/engine/src/index.ts`     | Exports `presetsForDate`                                                 |
| `packages/server/src/games.ts`     | Imports the turn-length bounds instead of declaring them                 |
| `packages/web/src/pages/Home.tsx`  | Features today's preset; pill on the daily card                          |
| `packages/web/src/styles.css`      | `.preset-badge`                                                          |
| `.claude/commands/daily-preset.md` | The routine's instructions                                               |
| `CLAUDE.md`                        | The `preset/<date>` branch convention and a pointer to the command       |

Tests: `packages/engine/src/presets.test.ts` (rewritten as a validator), `packages/web/src/pages/Home.test.tsx` (the pill).

---

### Task 1: Move the turn-length bounds into the engine

The preset validator has to check the same bound the server enforces, and the engine cannot import the server. Move the constants to where both can read them.

**Files:**

- Modify: `packages/engine/src/constants.ts` (~4 lines, after `MAX_TURN_CAP` at ~line 60)
- Modify: `packages/server/src/games.ts` (delete lines 67–68, add two imports)

**Interfaces:**

- Consumes: nothing new
- Produces: `MIN_TURN_MINUTES`, `MAX_TURN_MINUTES` from `@www/engine` (already re-exported by `export * from './constants.js'`)

**Steps:**

- [x] Add to `packages/engine/src/constants.ts`, immediately below `MAX_TURN_CAP`:

  ```ts
  /** Creation-time bounds on the configurable turn length, in minutes. */
  export const MIN_TURN_MINUTES = 5;
  export const MAX_TURN_MINUTES = 10_080; // one week
  ```

- [x] Delete the two `const MIN_TURN_MINUTES` / `MAX_TURN_MINUTES` declarations from `packages/server/src/games.ts` (~line 67) and add both names to the existing `@www/engine` import block, alphabetically after `MAX_TURN_CAP` and `MIN_TURN_CAP` respectively.
- [x] Run `pnpm typecheck && pnpm exec vitest run packages/engine` — green; the server's bound checks and their error strings are unchanged.
- [x] Commit: `refactor(engine): move the turn-length bounds into constants`

---

### Task 2: Dated presets

**Files:**

- Modify: `packages/engine/src/presets.ts` (~15 lines)
- Modify: `packages/engine/src/index.ts` (1 line)
- Modify: `packages/engine/src/presets.test.ts` (~25 lines of new cases)

**Interfaces:**

- Consumes: `PRESETS`
- Produces: `GamePreset.featuredOn?: string`, `PresetId = string`, `presetsForDate(isoDate: string): GamePreset[]`

**Steps:**

- [x] Write the failing cases in `presets.test.ts`:

  ```ts
  describe('presetsForDate', () => {
    it('offers every evergreen preset on any date', () => {
      const ids = presetsForDate('2026-08-14').map((p) => p.id);
      for (const preset of PRESETS.filter((p) => p.featuredOn === undefined)) {
        expect(ids).toContain(preset.id);
      }
    });

    it('offers a daily preset on its date and no other', () => {
      for (const daily of PRESETS.filter((p) => p.featuredOn !== undefined)) {
        expect(presetsForDate(daily.featuredOn!).map((p) => p.id)).toContain(daily.id);
        expect(presetsForDate('1999-12-31').map((p) => p.id)).not.toContain(daily.id);
      }
    });

    it('stays playable by id after its day', () => {
      for (const daily of PRESETS.filter((p) => p.featuredOn !== undefined)) {
        expect(presetById(daily.id)).not.toBeNull();
      }
    });
  });
  ```

- [x] Run `pnpm exec vitest run packages/engine/src/presets.test.ts` — fails, `presetsForDate` is not exported.
- [x] In `packages/engine/src/presets.ts`: change `export type PresetId = 'pact' | ...` to

  ```ts
  /**
   * A preset id. Deliberately not a union: the catalogue grows by one preset a
   * day (see `.claude/commands/daily-preset.md`), so tomorrow's id cannot be
   * enumerated at compile time. `presetById` is the check.
   */
  export type PresetId = string;
  ```

- [x] Add to `GamePreset`, after `plunderIncome`:

  ```ts
  /**
   * The UTC date (`YYYY-MM-DD`) this preset is the preset of the day. Absent
   * means evergreen — carded on the home page every day. A daily preset is
   * carded only on its date but stays creatable by id forever, because games
   * that were created under it still have to name it.
   */
  featuredOn?: string;
  ```

- [x] Append below `presetById`:

  ```ts
  /** What the home page offers on a given UTC date: the evergreens, plus that day's daily. */
  export function presetsForDate(isoDate: string): GamePreset[] {
    return PRESETS.filter(
      (preset) => preset.featuredOn === undefined || preset.featuredOn === isoDate,
    );
  }
  ```

- [x] Export it: in `packages/engine/src/index.ts`, extend the presets line to `export { PRESETS, presetById, presetRules, presetsForDate, type GamePreset, type PresetId } from './presets.js';`
- [x] Run `pnpm exec vitest run packages/engine && pnpm typecheck` — green.
- [x] Commit: `feat(engine): date presets so one can be featured per day`

---

### Task 3: Preset invariants

Rewrite `presets.test.ts` so it validates any preset instead of recognising four. This is the gate the daily routine is written against: a generated preset that breaks a bound turns CI red without anyone having predicted that particular preset.

**Files:**

- Modify: `packages/engine/src/presets.test.ts` (~110 lines, replacing the exact-list assertion)

**Interfaces:**

- Consumes: `PRESETS`, `MIN_TURN_CAP`, `MAX_TURN_CAP`, `MIN_TURN_MINUTES`, `MAX_TURN_MINUTES`
- Produces: nothing exported — `problemsWith` is test-local on purpose

**Steps:**

- [x] Replace the `'ships exactly four presets…'` case with the validator and its cases:

  ```ts
  /** Every rule a preset must satisfy, as a list of complaints. Empty means valid. */
  function problemsWith(preset: GamePreset, all: readonly GamePreset[]): string[] {
    const problems: string[] = [];
    const say = (ok: boolean, complaint: string): void => {
      if (!ok) problems.push(complaint);
    };

    say(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(preset.id), 'id must be kebab-case');
    say(all.filter((p) => p.id === preset.id).length === 1, 'id must be unique');
    say(preset.name.trim().length > 0, 'name must not be blank');
    say(preset.tagline.trim().length > 0, 'tagline must not be blank');
    say(preset.tagline.length <= 64, 'tagline must fit a card (64 chars)');
    say(preset.contest === 'pact' || preset.contest === 'tiers', 'contest must be a real contest');
    say(
      preset.tiersPayout === 'multiplier' || preset.tiersPayout === 'income',
      'tiersPayout must be a real payout',
    );

    const inRange = (value: number, lo: number, hi: number): boolean =>
      Number.isInteger(value) && value >= lo && value <= hi;
    say(inRange(preset.defaultTurnCap, MIN_TURN_CAP, MAX_TURN_CAP), 'turn cap out of bounds');
    say(
      inRange(preset.defaultTurnMinutes, MIN_TURN_MINUTES, MAX_TURN_MINUTES),
      'turn length out of bounds',
    );
    say(inRange(preset.warEconomyInterval, 1, 10), 'warEconomyInterval out of bounds');
    // -3 is the floor because garrisons floor at 1: below -2 the knob stops
    // doing anything, so a preset reaching for it has misunderstood the lever.
    say(inRange(preset.neutralGarrisonDelta, -3, 0), 'neutralGarrisonDelta out of bounds');
    say(inRange(preset.plunderIncome, 0, 3), 'plunderIncome out of bounds');

    if (preset.featuredOn !== undefined) {
      say(/^\d{4}-\d{2}-\d{2}$/.test(preset.featuredOn), 'featuredOn must be an ISO date');
      say(
        all.filter((p) => p.featuredOn === preset.featuredOn).length === 1,
        'two presets claim the same day',
      );
    }

    // Novelty, mechanically: a preset that tunes identically to another one is
    // the same game under a different name.
    const tuning = (p: GamePreset): string =>
      [
        p.contest,
        p.tiersPayout,
        p.defaultTurnCap,
        p.defaultTurnMinutes,
        p.warEconomyInterval,
        p.neutralGarrisonDelta,
        p.plunderIncome,
      ].join('/');
    say(
      all.filter((p) => tuning(p) === tuning(preset)).length === 1,
      'tuning duplicates another preset',
    );

    return problems;
  }

  describe('every preset in the catalogue', () => {
    it.each(PRESETS.map((preset) => [preset.id, preset] as const))('%s is valid', (_id, preset) => {
      expect(problemsWith(preset, PRESETS)).toEqual([]);
    });

    it('still contains the four evergreen presets, undated', () => {
      const evergreen = PRESETS.filter((p) => p.featuredOn === undefined).map((p) => p.id);
      expect(evergreen).toEqual(['pact', 'tiers', 'pact-blitz', 'tiers-v2']);
      expect(presetById('nope')).toBeNull();
    });
  });

  describe('the validator itself', () => {
    const valid = presetById('pact')!;
    const bend = (patch: Partial<GamePreset>): GamePreset => ({
      ...valid,
      ...patch,
      id: 'candidate',
    });

    it.each([
      ['Candidate', { defaultTurnCap: 500 }, 'turn cap out of bounds'],
      ['Candidate', { defaultTurnMinutes: 1 }, 'turn length out of bounds'],
      ['Candidate', { neutralGarrisonDelta: -40 }, 'neutralGarrisonDelta out of bounds'],
      ['Candidate', { plunderIncome: 99 }, 'plunderIncome out of bounds'],
      ['Candidate', { warEconomyInterval: 0 }, 'warEconomyInterval out of bounds'],
      ['Candidate', { tagline: '' }, 'tagline must not be blank'],
      ['Candidate', { featuredOn: '14/08/2026' }, 'featuredOn must be an ISO date'],
      ['Candidate', { id: 'Not Kebab' }, 'id must be kebab-case'],
    ] as const)('rejects %s with %j', (_name, patch, complaint) => {
      const candidate = { ...bend(patch), ...('id' in patch ? { id: patch.id! } : {}) };
      expect(problemsWith(candidate, [...PRESETS, candidate])).toContain(complaint);
    });

    it('rejects a preset that tunes identically to a shipped one', () => {
      const clone: GamePreset = { ...presetById('pact-blitz')!, id: 'pact-blitz-again' };
      expect(problemsWith(clone, [...PRESETS, clone])).toContain(
        'tuning duplicates another preset',
      );
    });
  });
  ```

- [x] Run `pnpm exec vitest run packages/engine/src/presets.test.ts` — the catalogue cases and the validator-itself cases must both be green. If a validator-itself case passes vacuously (the complaint string never appears), the guard is not live; fix it before moving on.
- [x] Run `pnpm lint && pnpm typecheck` — green.
- [x] Commit: `test(engine): validate every preset instead of listing four`

---

### Task 4: Home features today's preset

**Files:**

- Modify: `packages/web/src/pages/Home.tsx` (~6 lines)
- Modify: `packages/web/src/styles.css` (~8 lines, after `.preset-card`)
- Modify: `packages/web/src/pages/Home.test.tsx` (~10 lines)

**Interfaces:**

- Consumes: `presetsForDate` from `@www/engine`, `useNow()`
- Produces: nothing exported

**Steps:**

- [x] In `Home.test.tsx`, add a case asserting the evergreen cards render and that a card carrying `featuredOn` shows the pill, driven off the catalogue rather than a hard-coded id:

  ```ts
  it('features the daily preset for today', () => {
    const today = new Date().toISOString().slice(0, 10);
    const daily = PRESETS.find((p) => p.featuredOn === today);
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Preset of the day')).toHaveLength(daily === undefined ? 0 : 1);
    for (const preset of PRESETS.filter((p) => p.featuredOn !== undefined && p.featuredOn !== today)) {
      expect(screen.queryByTestId(`preset-${preset.id}`)).toBeNull();
    }
  });
  ```

- [x] Run `pnpm exec vitest run packages/web/src/pages/Home.test.tsx` — fails; every preset still renders.
- [x] In `Home.tsx`, replace the `PRESETS` import with `presetsForDate`, and inside the component:

  ```tsx
  // UTC on both ends: the routine stamps a UTC date, so the preset of the day
  // rolls over at the same instant for everyone.
  const presets = presetsForDate(new Date(now).toISOString().slice(0, 10));
  ```

  then map `presets` instead of `PRESETS`, adding inside the card:

  ```tsx
  {
    preset.featuredOn !== undefined && <span className="preset-badge">Preset of the day</span>;
  }
  ```

- [x] Add to `styles.css`, after `.preset-card`:

  ```css
  .preset-badge {
    background: var(--accent);
    color: #14141c;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.1rem 0.5rem;
    border-radius: 99px;
  }
  ```

- [x] Run `pnpm exec vitest run packages/web && pnpm typecheck` — green.
- [x] Commit: `feat(web): feature one preset of the day on the home page`

---

### Task 5: The `/daily-preset` command

**Files:**

- Create: `.claude/commands/daily-preset.md` (~90 lines)
- Modify: `CLAUDE.md` (~6 lines: the branch convention, and a pointer under the workflow table)

**Interfaces:**

- Consumes: `PRESETS`, `pnpm sim -- --preset <id>`
- Produces: the routine's contract

**Steps:**

- [x] Write `.claude/commands/daily-preset.md` with frontmatter (`description`, `allowed-tools` covering Bash for git/pnpm, Read, Edit, Grep) and these sections: what to do (branch `preset/<YYYY-MM-DD>` off `main`; read `presets.ts`; compose a preset no existing tuning tuple matches; append it with today's UTC date from `date -u +%F`; `pnpm sim -- --preset <id> --games 200 --players 6`; the full gate; commit `feat(engine): preset of the day — <name>`; push; draft PR carrying the simulation report), the hard rules from the spec, a short note on what makes a preset interesting rather than merely different (which knob is doing the work, and what that does to the shape of the game), and the cron plus prompt to schedule it with.
- [x] Add to `CLAUDE.md` under `## Conventions`, in the branches bullet: `preset/<YYYY-MM-DD>` for the daily preset routine, and a one-line pointer to the command beneath the workflow table.
- [x] Run `pnpm exec prettier --write .claude/commands/daily-preset.md CLAUDE.md`.
- [x] Commit: `docs: the daily preset routine`

---

### Task 6: Run the routine once

The acceptance test for everything above: follow `/daily-preset` by hand and land its output. It gives `featuredOn` and the pill a real caller, and it is the only way to find out whether the command's instructions are actually followable.

**Files:**

- Modify: `packages/engine/src/presets.ts` (one appended preset)

**Interfaces:**

- Consumes: the command written in Task 5
- Produces: the first dated preset

**Steps:**

- [ ] Compose today's preset per the command, appended to `PRESETS` with `featuredOn: '<today, UTC>'`. It must survive `problemsWith` — in particular the tuning-tuple check, so it cannot be a rename of an existing preset.
- [ ] Run `pnpm sim -- --preset <id> --games 200 --players 6`. Record the gate results. If a gate fails, retune within the validator's bounds and re-run; do not widen a bound to accommodate the preset.
- [ ] Run `pnpm exec vitest run packages/engine packages/web` — the validator accepts it, the home page features it, and no case needed editing to make that true. Any test that had to change is a sign the groundwork is wrong, not the preset.
- [ ] Run the full gate: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`.
- [ ] Commit: `feat(engine): preset of the day — <name>`

---

## Self-review notes

- **The turn-length bounds moved packages** (Task 1), which is adjacent code this plan otherwise had no business touching. The alternative was the engine's validator hard-coding `10_080` next to a comment saying "keep in step with `games.ts`", which is the duplication that goes stale first. The move is two constants and one import block; the server's validation and its error strings are byte-identical.
- **Task 6 ships a preset**, which is content rather than groundwork. Without it `featuredOn`, `presetsForDate`'s daily branch and the pill have no caller in this diff, and the command's instructions would ship unexecuted.
- **`problemsWith` stays inside the test file.** It is tempting to export it so the `/daily-preset` command can call it directly, but the command runs `pnpm test`, which runs it already. An exported validator with one caller in the same package is an abstraction the spec did not ask for.
