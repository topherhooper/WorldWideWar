---
description: Design one new game preset, simulate it, and open a draft PR. One preset, one day.
argument-hint: <optional — a theme, a knob to lean on, or nothing at all>
allowed-tools: Bash(git fetch:*), Bash(git checkout:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git status:*), Bash(git diff:*), Bash(date:*), Bash(pnpm:*), Bash(pnpm exec:*), Read, Edit, Grep, Glob
---

# Preset of the day

Add exactly one preset to the catalogue in `packages/engine/src/presets.ts`, prove it plays,
and open a draft pull request. Nothing else.

<theme>
$ARGUMENTS
</theme>

If the theme is empty, pick your own. It is a nudge, not a specification — a preset that
ignores it and is good beats a preset that honours it and is not.

## What you do

1. **Branch off main.**

   ```bash
   git fetch origin main
   git checkout -B preset/$(date -u +%F) origin/main
   ```

2. **Read the catalogue.** `packages/engine/src/presets.ts`, all of it, including the header
   comment — it records what the blitz presets learned about short games, which is the kind
   of thing worth not rediscovering. Note every preset's tuning so you can be sure yours is
   not one of them wearing a hat.

3. **Compose today's preset.** Seven knobs, all of them already there:

   | Field                  | Range                    | What it does                                                        |
   | ---------------------- | ------------------------ | ------------------------------------------------------------------- |
   | `contest`              | `pact` \| `tiers`        | Which social contest drives combat                                  |
   | `tiersPayout`          | `multiplier` \| `income` | Tiers only: combat multiplier, or armies                            |
   | `defaultTurnCap`       | 10–50                    | Game length; storm timing derives from it in `rulesFor`             |
   | `defaultTurnMinutes`   | 5–10 080                 | Wall-clock pace, from a coffee break to a week                      |
   | `warEconomyInterval`   | 1–10                     | +1 income every N turns — the rising tide, for everyone             |
   | `neutralGarrisonDelta` | −3–0                     | How cheap the land grab is (−3 behaves as −2; garrisons floor at 1) |
   | `plunderIncome`        | 0–3                      | What taking ground pays, next turn, capped at `plunderCap`          |

   Add `featuredOn: '<date -u +%F>'` and a kebab-case `id` nobody has used.

   **One knob should be doing the work.** "Twenty-five turns at four hours" is a schedule,
   not a preset. Pick the lever, push it, and let the rest sit at whatever supports it — a
   cold war economy so early ground is the only ground, or plunder at 3 so the map never
   stops moving. Then say what shape of game that makes, in a `tagline` of 64 characters or
   fewer, in the voice of the ones already there: concrete, a little wry, never a feature
   list.

4. **Simulate it.**

   ```bash
   pnpm build && pnpm sim -- --preset <id> --games 200 --players 6
   ```

   The build is not optional: the harness imports `@www/engine` as a package, which
   resolves to `dist`, so without it the run fails with `unknown preset: <id>` and you
   spend ten minutes doubting the id.

   The harness exits non-zero on a failed gate. A failure is a fact about the preset, not an
   obstacle: retune within the ranges above and run it again. Two or three attempts is
   normal. Keep the final report — it goes in the pull request.

   If three honest attempts cannot clear the gates, ship the preset as a draft pull request
   anyway with the failing numbers quoted and say which gate resisted and what you tried.
   That is a useful day. Silently loosening the preset until the gates stop complaining is
   not.

5. **Run the gate.**

   ```bash
   pnpm format && pnpm lint && pnpm typecheck && pnpm test
   ```

   `packages/engine/src/presets.test.ts` validates every entry in the catalogue, so it
   validates yours. If it complains, the preset is wrong — fix the preset. Never the bound.

6. **Commit, push, open a draft pull request.**

   ```bash
   git add packages/engine/src/presets.ts
   git commit -m "feat(engine): preset of the day — <name>"
   git push -u origin preset/$(date -u +%F)
   ```

   The PR body is the squash commit message and becomes permanent history: `## Summary`
   naming the preset and the one sentence about what makes it a different game, then the
   simulation report as a fenced block. Draft, always. Nothing generated merges itself.

7. **Print the preset's name, id and PR link. Stop.**

## Hard rules

These are what keep a daily generator from becoming a daily refactor.

- **One preset. One file.** `packages/engine/src/presets.ts`, appended. If you are editing
  anything else, you have left the task.
- **Never edit or delete an existing preset.** The catalogue is append-only: finished games
  store their `presetId` and still have to be able to name their mode. Retuning a preset
  someone is mid-game on rewrites the rules under them.
- **No new fields on `GamePreset`, and no new constants.** A generator that can add knobs
  can add unreviewed mechanics every morning. If today's idea needs a knob that does not
  exist, that is an idea doc (`/new-idea`), not a preset.
- **No new preset may duplicate another's tuning.** The test enforces it; the point is that
  you notice before the test does.
- **Do not touch the four evergreen presets** — `pact`, `tiers`, `pact-blitz`, `tiers-v2`.
  They have no `featuredOn` and are carded every day; yours is carded on its date only.
- **Do not change a test to make your preset pass.**

## Scheduling it

The schedule is not in this repository. To run this daily, create a routine that fires

```
/daily-preset
```

on `0 7 * * *` (UTC) against this repo's default branch. Each firing is independent: it
branches from `main`, so a day whose pull request has not merged yet does not block the
next one, and two unmerged days conflict only if they claim the same `featuredOn` — which
they cannot, because the date is the branch name.
