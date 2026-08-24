# Improve the map's visuals — the storm, and the land it takes

> "let's improve the visuals of our map including storms and the way the map changes
> when tiles are lost"

The map is the game's only picture of the world, and it currently draws exactly one
thing about the storm: nothing. `Territory.wave` — the static schedule saying which
collapse wave removes each territory — is never read by `MapView.tsx`. Doomed land and
safe land are the same colour while you are placing the orders that decide whether you
lose a stack on it. When the wave finally lands, the tile turns flat grey between one
page load and the next, with no moment of transition and nothing saying it just
happened.

Scope was narrowed by the one question asked: **storm collapse only** — tiles leaving
play. Territories changing owner by conquest are a separate idea and are not in this
one.

## The one observable thing that would make it real

A player opens the map with orders still to write, and can point at the tiles that will
be gone when those orders resolve — without opening the report, and without being told
which colour means what.

That is the test. Everything else here (the burn moment, the scar the collapsed land
leaves, the rim reading as a closing ring rather than a scatter of grey) is texture on
top of it, and any of it can be cut.

## What the code actually does today

**The data is already there and already correct.**

- `Territory.wave` — "which storm collapse wave removes this territory. -1 = never" —
  `packages/engine/src/types.ts:19-20`.
- `GeneratedMap.collapseWaves` — territory ids per wave, outermost first —
  `packages/engine/src/types.ts:55`.
- `waveCollapsingOn(turn, rules)` and `warnedTerritories(map, turn)` are already
  exported from the engine's public surface — `packages/engine/src/index.ts:44`.
- `GameState.collapsed[]` is a per-territory boolean, and `wavesCollapsed` counts waves
  already burnt — `types.ts:247-248`.

**The map reads none of it.** `MapView.tsx` touches the storm in exactly two places:
`state.collapsed[t.id]` picks the fill `COLLAPSED = '#2b2b33'` (`MapView.tsx:17`,
`:132-134`) and suppresses the tile's labels (`:236`). There is no `wave` anywhere in
the file. Collapsed tiles are drawn at `fillOpacity` 0.9 — nearly solid — so dead land
is currently one of the *most* visually assertive things on the board.

**The dev tool already solved the shading half.** `tools/mapviz/src/render.ts:64-65`
tints by wave: `lightness = 22 + (wave / waveCount) * 8`, darker the earlier it burns,
against `46` for land that never does. The comment there states the intent this idea
is trying to move into the game — "so the storm's path reads at a glance rather than
needing an animation to understand." That is a palette to start from, not invent.

**There is no legend slot for it.** The map key is a single prose paragraph,
`packages/web/src/pages/Game.tsx:132-137`, already listing seven glyphs and running
four lines. Adding storm shading to it makes it eight and five. Whether that paragraph
survives this idea is an open question, not an assumption.

**Timing is a trap, and it is documented.** The warning a player reads in turn T's
report names the wave that burns during the resolution of turn T+1 — i.e. when the
orders they are writing right now resolve. Traced in
[docs/storm-and-capitals.md](../docs/storm-and-capitals.md): `resolve.ts:429` sets
`next.turn = T+1`, `resolve.ts:456` calls `warnedTerritories(map, next.turn)`, and
`storm.ts:29` looks ahead one further turn. The report wording was fixed 2026-08-23
(#25 on `main`); the map half was left open, which is this idea.

**One field is wrong and must not be read.** The `storm_warning` event carries
`wave: next.wavesCollapsed` — the count of waves already gone, not the index of the
warned one — `packages/engine/src/resolve.ts:479`. Nothing consumes it today. Anything
built here should derive from `Territory.wave` plus `waveCollapsingOn`, never from that
field, until it is fixed.

## What made this worth saying out loud

Three of four players could not submit a valid order unaided
([docs/onboarding-gaps.md](../docs/onboarding-gaps.md)), and Sam's storm question in
[docs/storm-and-capitals.md](../docs/storm-and-capitals.md) — "does 'storm warning'
tucked away in the last turn report mean we need to move off of our sea-lanes this turn?
Or is it next turn?" — is the same failure in a different place: the information exists,
in prose, behind a collapsed section, at the wrong altitude. A map that showed it would
have made the question unnecessary.

## How this sits against the open tasks

`./scripts/ready.sh` already lists **[storm-warning-deadline](../tasks/storm-warning-deadline.md)**
(P1, web) — "Shade the doomed land on the map, not just in the report" — which is the
narrow, already-filed version of half of this idea, down to naming the mapviz palette.
This idea is the wider question that task is one answer to. **If this idea resolves,
that task file is the thing it resolves**, not a second task beside it.

Two neighbours worth not colliding with:

- **[manufactured-map-edges](../tasks/manufactured-map-edges.md)** (P1, web) also wants
  new marks drawn in `MapView.tsx`. Two ideas independently adding visual vocabulary to
  one 285-line SVG is how a map gets noisy. Whichever lands second inherits the crowding
  problem.
- **[tier-list-round-cue](../tasks/tier-list-round-cue.md)** (P1, web) is the same
  root cause — a thing that matters living only inside "Show last turn's report".

`coop-survival-mode` (on branch `engine/pve-survival`) is noted in
`storm-warning-deadline` as blocked on this: in a co-op preset the storm *is* the
opponent, so an unreadable storm is not an inconvenience, it is an unplayable mode.

## Assumed, not asked

- **Conquest is out of scope.** Only tiles leaving play. A tile changing owner between
  turns is a real and adjacent gap, and is a separate idea.
- **Client-only.** No engine change, no mapgen change, no schema change. Mapgen edits
  invalidate in-flight games and move the 300-seed and 800-game CI sweeps; the data
  needed here already exists, so there is no reason to touch either.
- **Motion is optional and must degrade.** `styles.css:310-322` already gates the
  marching-ants animation behind `prefers-reduced-motion`. Anything animated here does
  the same, and the static frame has to carry the meaning on its own.
- **Colour alone is not enough.** Ownership already spends the palette on eight player
  colours plus neutral; the storm cannot claim another hue and be legible next to them.
  Assume texture, opacity, or an added mark rather than a new fill colour.
- **Only the next wave needs to be legible.** Showing all six waves as a heat map is a
  strictly larger design problem than showing the one that burns when these orders
  resolve. The full schedule may be worth it; it is not assumed to be.
- **Collapsed land should recede, not shout.** Today it is drawn at 0.9 opacity, more
  solid than any living neutral. Assumed wrong, but it is a judgement, not a fact.
- **No new dependency.** Hand-written SVG, as the rest of the file is.

## Where the work would land

- `packages/web/src/game/MapView.tsx` — every mark on the map; needs `map.territories[].wave`
  and `state.turn`, both already in `Props`.
- `packages/web/src/styles.css:220-322` — the `.map-*` classes and the reduced-motion gate.
- `packages/web/src/pages/Game.tsx:132-137` — the prose map key that would have to absorb,
  or be replaced by, whatever gets added.
- `tools/mapviz/src/render.ts:60-70` — the wave palette to copy rather than reinvent.
- `packages/engine/src/storm.ts:16-31` — `waveCollapsingOn` / `warnedTerritories`, the two
  functions that answer "which tiles, which turn".
