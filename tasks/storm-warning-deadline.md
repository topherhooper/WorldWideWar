---
status: open
kind: task
area: web
priority: 0
blocked-by: ''
---

# Say when the storm warning's land actually burns

## Next step

Reword the warning in `packages/web/src/game/ReportView.tsx:135-140` to state the deadline. The correct answer is established: **the warned land burns when the orders you are writing right now resolve** -- not next turn.

That is a one-string change. Ship it before deciding anything about map shading.

## What we know

The message is `Storm warning: <names>` with no timing at all, read in turn T's report while writing orders for turn T+1, and the land burns during T+1's resolution. A player who reads it as "next turn" marches in and loses the entire stack (`storm.ts:53-59`).

`MapView.tsx` never reads `Territory.wave`, so doomed territories look identical at order-entry time; `tools/mapviz` already shades by wave. Shading the map is the bigger, later move -- the cost of missing this is a whole army, which argues for both eventually.

Trace and the off-by-one in the emitted `wave` field: [docs/storm-and-capitals.md](../docs/storm-and-capitals.md).
