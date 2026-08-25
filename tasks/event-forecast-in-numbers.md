---
status: open
kind: task
area: web
priority: 1
blocked-by: ''
---

# Make the forecast box say what an event costs you, not what it means

## Next step

In `packages/web/src/game/ForecastBox.tsx`, replace the generic `describeEvent` sentence
with a computed one for the three events that land on specific tiles:

- `conscription` — "11 of your territories are on a frontier: +11 armies"
  (`events.ts:104-107` has the exact predicate)
- `uprising` — "3 of your stacks are 8 or larger: −9 armies" (`events.ts:75-80`)
- `warlords` — "3 neutral territories will each raise 3 armies" (`events.ts:84-96`);
  which three is seeded and cannot be named ahead of time, so say the shape, not the
  tiles

The other four (`mobilization`, `cold_snap`, `mud_season`, `fog`) are genuinely
board-wide and their existing sentence is already the whole truth. Leave them.

## What we know

`EVENT_DESCRIPTIONS` states the _rule_ — "Conscription — every frontier territory raises
one army" — which asks a player to work out by eye which of their tiles are frontier,
from a definition of "frontier" they were never given. This is the same failure mode as
the storm warning that lived only in the report: the information exists, at the wrong
altitude, in prose.

Marking the affected tiles on the map was considered and rejected on mark budget; see
the decisions table in [docs/design/map-storm-visuals.md](../docs/design/map-storm-visuals.md).
The box carrying numbers instead of definitions is the cheaper thing that might work, and
it is why the box exists at all.

Client-only. Every predicate is already computable from redacted state — except under
`fog`, where army counts are hidden and any stack-size claim must be suppressed rather
than computed from `HIDDEN_ARMIES`.
