# Every Founding Capital Burns, Killing Decapitation — Idea

Date: 2026-08-14
Status: Captured — not yet brainstormed
Source: Player group text thread, 2026-08-13. Originally filed as GitHub issue #11
before this project moved to in-repo idea tracking.

## Raw dump

> **Sam:** Also it sounds like the world edge is going to collapse inward a la PUBG, but
> all of the capitals are on the edge of the map

> **Topher:** I've asked the supercomputer and it says the game is better this way

> **Sam:** Oh, that settles that then 🖥️

> **Sam:** Sam, will the storm ever collapse our capital territory?

## What's being asked

- Decide whether capitals burning in the storm is a designed constraint or an accident.
- If designed, tell players — there is a strategic clock nobody knows about.

## Already verified

Confirmed in code while this was a GitHub issue. **Capitals are not protected.** The
capital is chosen by radius and the storm is scheduled by radius, and the two rules are
independent of each other.

For a 4-player game at the default 25-turn cap:

- Capitals sit at `CAPITAL_RADIUS_FRACTION = 0.72` of the world radius, r ≈ 7240
  (`mapgen/generate.ts:64`, `:613`).
- `buildCollapseWaves()` (`generate.ts:655-676`) sorts each wedge by descending radius
  and marks **all but the single innermost local** as collapsible. At 4 players
  `perWedge = 7` and `waveCount = 6`, so there is exactly one local per wave; only
  r ≈ 3411 and the map centre survive.
- The capital is the 4th-largest radius → **wave 3**.
- `stormFirstWave = 10`, `stormInterval = 2` (`constants.ts:188-189`) → wave 3 fires on
  **turn 16**.

All four capitals burn on the same turn, symmetrically, so this is not a fairness
problem. The consequences:

- Every army stationed in the capital is destroyed (`storm.ts:41-63`) — the land is
  gone, not captured.
- The capital relocates to the strongest-garrison territory in the player's largest
  connected holding, and supply re-anchors (`resolve.ts:579-591`, `supply.ts:59-88`).
  A `capital_fell` event is emitted. The player is not eliminated. This part works.
- **Decapitation victory is the casualty.** It is scored on _founding_ capitals
  (`victory.ts:260-291`), deliberately — the code notes "a relocated capital is a
  consolation prize." `victory.ts:272` skips any player whose founding capital is
  collapsed. From turn 16 the route is closed for the whole table, permanently. It must
  land on turn ≤ 15.
- The same term is a late tiebreak in `rankPlayers` (`victory.ts:471-473`) that goes to
  zero for everyone after turn 16 and stops discriminating.

Turn 16 is the default-cap figure; the wave-3 turn is 9 at cap 15 and 26 at cap 50.

Nothing asserts or explains any of this. No test covers capitals versus waves
(`mapgen/generate.test.ts:135-158` checks survivor counts and the centre only),
`mapgen/validate.ts` never mentions collapse, and `HowToWin.tsx:102-104` says the storm
collapses "the map's edge" — which reads like it eats the rim, not your capital on a
known turn.

## Open questions

- Is "decapitation has a turn-15 deadline" intended? Everything downstream depends on
  this answer.
- If intended: where does it get said? `HowToWin.tsx` describes decapitation without
  mentioning the clock.
- If not intended: spare the capital's ring from collapse, or score decapitation on
  current rather than founding capitals? The first changes map generation and the
  balance sweep; the second changes the victory condition's character — the code's own
  comment argues founding capitals are the point.
- Should there be a test pinning whichever answer is chosen? Right now the behavior is
  emergent from two unrelated constants and would change silently if either moved.

## Constraints & non-goals

- Topher's stated position, twice, is that the current design is deliberate: "I've asked
  the supercomputer and it says the game is better this way." Treat the burning as
  intended unless he says otherwise — which makes this primarily a docs question.

## Suggested next step

Brainstorm, and it needs Topher's answer to the first open question before a spec can be
written. Not a `/one-shot` candidate.
