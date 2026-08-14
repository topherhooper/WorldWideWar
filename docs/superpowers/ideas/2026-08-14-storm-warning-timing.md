# Storm Warning Doesn't State Its Deadline — Idea

Date: 2026-08-14
Status: Captured — not yet brainstormed
Source: Player group text thread, 2026-08-13. Originally filed as GitHub issue #10
before this project moved to in-repo idea tracking.

## Raw dump

> **Sam:** Topher does "storm warning" that's tucked away in the last turn report mean
> we need to move off of our sea-lanes this turn? Or is it next turn?

> **Topher:** here's what the page says about storms "The storm starts collapsing the
> map's edge on turn 6, then every turn. A world event lands every 3 turns and is always
> announced one turn ahead. Sea lanes (⚓) make two distant territories adjacent for
> movement."

> **Sam:** Crystal 👌👌👌

## What's being asked

- The storm warning should say when the listed territories burn.

## Already verified

Confirmed in code while this was a GitHub issue. **The answer is: this turn.**

The rendered text (`packages/web/src/game/ReportView.tsx:135-140`) is the entire
message — `Storm warning: <names>` — and states no timing at all.

Tracing `resolveTurn` for turn T:

- `resolve.ts:429` sets `next.turn = T+1`
- `resolve.ts:456` calls `warnedTerritories(map, next.turn)`, and `storm.ts:29` looks
  ahead one further turn — so the warning names the wave collapsing on turn **T+2**
- That wave is applied by `applyStorm` during the resolution of turn **T+1**

So a player reads the warning in turn T's report while writing orders for turn T+1, and
the warned land burns when _those very orders_ resolve. Read as "it burns next turn," a
player marches into the doomed territory and loses the whole stack — `applyStorm`
destroys everything standing on collapsed ground (`storm.ts:53-59`).

Two aggravating factors:

- `MapView.tsx` never reads `Territory.wave`, so doomed territories look identical to
  safe ones at order-entry time. The dev tool already shades by wave
  (`tools/mapviz/src/render.ts:64-65`).
- The warning is emitted with `wave: next.wavesCollapsed` (`resolve.ts:459`) — the count
  of already-collapsed waves, not the index of the warned one. Unused by the UI today,
  so harmless, but wrong and will mislead the next reader.

## Open questions

- Exact wording. "Storm warning — these burn at the end of THIS turn" is unambiguous but
  shouty; there may be a better phrasing that survives being skimmed.
- Should warned territories be shaded on the map, or is the text fix sufficient? The
  cost of missing this is a player's entire army, which argues for both.
- Fix the `wave` field now, or leave it since nothing reads it?

## Constraints & non-goals

- The warning currently lives only in the turn report, which Sam described as "tucked
  away." Moving it to order-entry time is a bigger change than rewording it, and may
  belong to a separate piece of work.

## Suggested next step

`/one-shot`. The wording fix is small and the correct behavior is already established;
the map-shading question can be settled in the spec's `## Decisions` table.
