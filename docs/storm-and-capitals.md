# The storm: warning timing, and what it burns

Two findings from the player thread, 2026-08-13, confirmed in code. Both are
emergent from constants that were set independently, so both would change
silently if either constant moved.

## The storm warning does not say when the land burns — and the answer is "now"

> **Sam:** Topher does "storm warning" that's tucked away in the last turn report
> mean we need to move off of our sea-lanes this turn? Or is it next turn?

The rendered text (`packages/web/src/game/ReportView.tsx:135-140`) is the entire
message — `Storm warning: <names>` — and states no timing at all.

Tracing `resolveTurn` for turn T:

- `resolve.ts:429` sets `next.turn = T+1`
- `resolve.ts:456` calls `warnedTerritories(map, next.turn)`, and `storm.ts:29` looks
  ahead one further turn — so the warning names the wave collapsing on turn **T+2**
- That wave is applied by `applyStorm` during the resolution of turn **T+1**

A player reads the warning in turn T's report *while writing orders for turn T+1*,
and the warned land burns when those very orders resolve. Read as "it burns next
turn," a player marches into the doomed territory and loses the whole stack —
`applyStorm` destroys everything standing on collapsed ground (`storm.ts:53-59`).

Aggravating:

- `MapView.tsx` never reads `Territory.wave`, so doomed territories look identical
  to safe ones at order-entry time. The dev tool already shades by wave
  (`tools/mapviz/src/render.ts:64-65`).
- The warning is emitted with `wave: next.wavesCollapsed` (`resolve.ts:459`) — the
  count of already-collapsed waves, not the index of the warned one. Nothing reads
  it today, so it is harmless and wrong, and will mislead the next reader.

## Every founding capital burns on the same turn, closing Decapitation

> **Sam:** it sounds like the world edge is going to collapse inward a la PUBG, but
> all of the capitals are on the edge of the map
>
> **Topher:** I've asked the supercomputer and it says the game is better this way

**Capitals are not protected.** The capital is chosen by radius and the storm is
scheduled by radius, and the two rules are independent.

For a 4-player game at the default 25-turn cap:

- Capitals sit at `CAPITAL_RADIUS_FRACTION = 0.72` of the world radius, r ≈ 7240
  (`mapgen/generate.ts:64`, `:613`).
- `buildCollapseWaves()` (`generate.ts:655-676`) sorts each wedge by descending
  radius and marks all but the single innermost local as collapsible. At 4 players
  `perWedge = 7` and `waveCount = 6`, so there is one local per wave; only r ≈ 3411
  and the map centre survive.
- The capital is the 4th-largest radius → **wave 3**.
- `stormFirstWave = 10`, `stormInterval = 2` (`constants.ts:188-189`) → wave 3 fires
  on **turn 16**. (Turn 9 at cap 15; turn 26 at cap 50.)

All capitals burn on the same turn, symmetrically, so this is not a fairness problem.
The consequences:

- Every army stationed in the capital is destroyed (`storm.ts:41-63`) — the land is
  gone, not captured.
- The capital relocates to the strongest-garrison territory in the player's largest
  connected holding, and supply re-anchors (`resolve.ts:579-591`, `supply.ts:59-88`).
  A `capital_fell` event is emitted; the player is not eliminated. This part works.
- **Decapitation victory is the casualty.** It is scored on *founding* capitals
  (`victory.ts:260-291`), deliberately — the code notes "a relocated capital is a
  consolation prize." `victory.ts:272` skips any player whose founding capital is
  collapsed. From turn 16 the route is closed for the whole table, permanently. It
  must land on turn ≤ 15.
- The same term is a late tiebreak in `rankPlayers` (`victory.ts:471-473`) that goes
  to zero for everyone after turn 16 and stops discriminating.

**Treated as intended.** Topher's stated position, twice, is that the current design
is deliberate. That makes this a disclosure question, not a balance one: there is a
strategic clock on Decapitation and nothing says so. `HowToWin.tsx:102-104` describes
the storm as collapsing "the map's edge," which reads like it eats the rim rather than
your capital on a known turn.

Nothing pins any of this. No test covers capitals versus waves
(`mapgen/generate.test.ts:135-158` checks survivor counts and the centre only), and
`mapgen/validate.ts` never mentions collapse.
