# Drawing the environment: the storm, the ash, and one forecast box

The map showed nothing about the storm. `Territory.wave` and `map.collapseWaves` had
been in the engine since mapgen was written, exported on the public surface, and read by
no part of the web app. Doomed land and safe land were the same colour while a player
placed the orders that decided whether they lost a stack on it — the gap behind Sam's
question in [../storm-and-capitals.md](../storm-and-capitals.md), which the report
wording fixed only in prose.

This records what was decided, and — more usefully — what was rejected, because that is
the half git cannot reconstruct.

## The environment is three systems, not one storm

The idea was captured as "improve the visuals of our map including storms and the way
the map changes when tiles are lost", and the first useful move was refusing to treat
that as one thing. Three separate systems act on the board without a player acting:

| System                     | Where it lives                 | Shape                                             |
| -------------------------- | ------------------------------ | ------------------------------------------------- |
| **Tile loss**              | `packages/engine/src/storm.ts` | Spatial, per-tile, fixed radial schedule          |
| **Rule-changing events**   | `packages/engine/src/events.ts`| Seven, drawn without replacement, announced ahead |
| **Non-player armies**      | Neutral garrisons              | Seeded per map, grow on an interval               |

They interact — `warlords` is a shock to the neutrals, and the storm deletes neutrals
along with everyone else — so they could not be three decorations bolted on separately.

Two structural facts that only appear when they are put side by side:

- **Not all "global" events are global.** Four are board-wide (`mobilization`,
  `cold_snap`, `mud_season`, `fog`), but `uprising` hits every stack of 8+,
  `warlords` hits three random neutrals, and `conscription` hits *every frontier
  territory* — all computable on the map, all currently rendered as one sentence of
  prose identical in form to the board-wide ones.
- **Each announces a turn ahead, and none said which tiles.** That, not the storm
  specifically, was the actual defect.

## Decisions

| Decision                                                                                                                  | Rejected, and why                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Collapsed tiles keep being drawn.** The world does not shrink or reflow.                                                | The initial assumption that dead land should recede. Also rejected: merging dead tiles into one dark mass creeping inward — it reads well as a shrinking world but stops collapsed land being *tiles*, and the point of keeping them is that the shape of what you lost stays legible.                                                                                                |
| **The map shades one wave: the one that burns when the orders now being written resolve.**                                | `warnedTerritories` and the `storm_warning` event, both phrased from the resolver's point of view one turn further on. Also rejected: a two-intensity version including the wave after next (the fainter mark carries the less urgent meaning — backwards); and the full remaining schedule as a wave-indexed gradient, the `tools/mapviz` treatment, which competes with ownership for the fill channel and is loudest at turn 1 when it matters least. |
| **Every other forecast consolidates into one box above the map.**                                                         | Putting all three systems' effects on the map. A box is better than a map at "in two turns, no income". Also rejected: a panel in the `.side` orders column — better in principle, but `.game-layout` collapses to one column on narrow screens and `.side` stacks *below* the map, so on a phone the forecast would sit below the fold.                                                |
| **The map gets exactly one new mark.** Tile-specific events stay sentences in the box.                                    | Marking `uprising`/`warlords`/`conscription` tiles, though all three are computable today. Budget, not disagreement: `MapView` already carries ownership fill, selection, move targets, region seams, impassable ridges, sea lanes, capitals, ports and two label layers, and `manufactured-map-edges` is queued to add another. A map that marks four kinds of doom teaches none of them. Also rejected: hover-to-reveal, which is free on desktop and worthless on a phone. |
| **A hatch, not a fill.** An SVG `<pattern>` laid over the territory so the owner's colour reads underneath.               | Tinting the doomed tiles, which is what `tools/mapviz` does and what the original task assumed. Fill is the one channel already fully spent — eight player colours plus neutral — so a tint competes with ownership, the map's primary read.                                                                                                                                          |
| **No motion, and no dependence on the previous turn.**                                                                    | Marking the land taken on the most recent resolution (readable from `view.latestReport`), and a pulse on the warning. Deferred rather than disliked — but see the hard limit below.                                                                                                                                                                                                    |

## Two findings that outlived the design

**The board forgets whose land the storm took.** `applyStorm` sets `collapsed = true`,
`armies = 0` **and `owner = null`** (`storm.ts:53-59`). A collapsed tile has no owner in
state at all, and the `storm` event carries territory ids and an army total with no
owners. So "the storm just took three of Sam's provinces" is not renderable after the
fact without an engine change that records it. That is a hard limit on any
show-the-moment-of-loss design, not a detail of one.

**The storm schedule is not what `DEFAULT_RULES` suggests.** `stormInterval` is
`playerCount <= 6 ? (turnCap <= 15 ? 1 : 2) : 1` (`constants.ts:192`). At eight players
and a 25-turn cap it resolves to `stormFirstWave 9, stormInterval 1` — a wave *every
turn* from 9 to 14, and then the storm is over for the remaining eleven turns. The
"blank map between waves" problem is therefore not an alternate-turn flicker at big
tables; it is a permanently unshaded map for the whole back half of the game. That is
what the box's storm line exists to disambiguate: it distinguishes *not started* from
*not this turn* from *finished*.

## What the prototype was actually testing

Not "does a warning help" — that was never in doubt. The question no discussion could
settle was **whether a hatch reads as doomed over all eight player colours at once
without competing with ownership.** It does. The first attempt used a warning-orange bar
(`#ff6b3d`), which read strongly on six colours and washed out on the red and orange
players — the warning colour collided with two of the eight it had to sit on. A neutral
cream bar (`#f2e4d8`) is uniform across all eight. The lesson generalizes: **on a map
whose palette is spent on identity, a warning must be signalled by texture and value,
not hue**, because any hue you choose is already somebody's colour.
