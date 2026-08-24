---
status: open
kind: task
area: web
priority: 1
blocked-by: ''
---

# Shade the doomed land on the map, not just in the report

## Next step

Make `MapView.tsx` read `Territory.wave` and shade the territories the storm takes next,
so a player sees the deadline while placing orders rather than only in last turn's
report. `tools/mapviz` already shades by wave (`tools/mapviz/src/render.ts:64-65`) --
start from that palette rather than inventing one.

The warned wave is the one collapsing on turn T+2, and `Territory.wave` is the map's
static schedule; the report's `storm_warning` event carries the wrong number
(`wave: next.wavesCollapsed`, `resolve.ts:459`), so nothing should start reading that
field until it is fixed.

## What we know

The wording half shipped: the report now states that warned land burns when the orders
you are writing resolve, not next turn -- the one-army mistake Sam nearly made. What is
left is that the information exists only in the report, which sits behind "Show last
turn's report"; see [tier-list-round-cue](tier-list-round-cue.md), the same collapse
hiding a different thing.

This is the half that `coop-survival-mode` (on `engine/pve-survival`) is blocked on. In
that mode the storm is the opponent rather than a symmetric clock, so an unreadable storm
makes the preset unplayable rather than merely expensive.

Trace, and the off-by-one in the emitted `wave` field:
[docs/storm-and-capitals.md](../docs/storm-and-capitals.md).
