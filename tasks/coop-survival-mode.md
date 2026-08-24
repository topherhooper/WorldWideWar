---
status: blocked
kind: task
area: web
priority: 1
blocked-by: storm-warning-deadline
---

# Put the Survival preset in front of players

## Next step

Blocked on the storm being legible, which is [storm-warning-deadline](storm-warning-deadline.md)
-- specifically the map-shading half of it, not the warning string.

When that lands: surface the coalition pool in `OrdersPanel.tsx`, since in this mode
a read is worth armies and nobody can currently see that. Then server plumbing for the
preset (`games.ts` already takes `presetId`, so this is small) and a `survival` card in
the lobby.

## What we know

The engine side is built and measured: pooled tiers payout, storm raiders aimed at the
permanent core, a `survival` victory route, and the eliminated staying in the contest.
At five players, 24% of bot games come through with everyone alive and 1% end in
extinction -- and bots do not coordinate their lists at all, so humans should do better.

The reason this is blocked rather than merely next: in competitive games the storm is a
symmetric clock and a player who misreads it loses a turn. Here it is the opponent, the
entire loss condition, and it now spawns raiders. A player who cannot see which land
burns next cannot play the mode at all.

`MapView.tsx` still never reads `Territory.wave`; `tools/mapviz` already shades by it.

Engine design and the measurements behind it: [docs/design/coop-survival.md](../docs/design/coop-survival.md).
