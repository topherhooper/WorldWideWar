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

## Decisions

| # | Decision | Rejected, and why |
| - | -------- | ----------------- |
| 1 | **"The environment" is three separate systems, not one storm.** The idea is scoped against the taxonomy below, and each system is allowed its own answer. | Rejected: the framing this doc was captured with — one monolithic "storm" whose only open question was how to draw it (tint the doomed tiles vs. draw the frontier as a ring). That question was asked and withdrawn: it presumes the environment is one thing acting in one way, and it is three things acting in three ways. Answering it first would have locked a visual vocabulary chosen for tile-collapse alone, and then forced the other two systems to borrow it. |
| 2 | **Collapsed tiles keep being drawn.** The world does not shrink, reflow, or drop the dead land off the board — you can still see the ground that used to be there. | Rejected: this doc's own assumption that "collapsed land should recede, not shout." Also rejected: the encroaching-dark-mass treatment, which would have merged dead tiles into one filled shape creeping inward — it reads well as a shrinking world, but it stops collapsed land being *tiles*, and the point of keeping them is that the shape of what you lost stays legible. |
| 3 | **The map shades the tiles the next wave takes.** The spatial forecast — and the only forecast that goes on the map. | Rejected: leaving the warning in prose in the report, which is the status quo and the thing that produced Sam's question. Confirms the direction already filed as `tasks/storm-warning-deadline.md`, so that task is what this resolves rather than a sibling of it. |
| 4 | **Every other forecast consolidates into one box in the UI.** One place that says what the world is about to do, instead of the current scatter. | Rejected: the forecast-everywhere reading of the previous question — putting all three systems' next-turn effects on the map. The map gets the forecast that is *inherently spatial* (which ground disappears) and nothing else; a box is better than the map at "in two turns, no income." Also rejected: identity-first (redraw what things are before predicting what happens), which loses the order-writing minute this is all for. |
| 5 | **The map stays a storm map — one new mark, and one only.** Uprising, Warlords and Conscription land on specific tiles, and they stay sentences in the box anyway. | Rejected: marking their tiles on the map, even though all three are computable from state today and "every frontier territory raises one army" is a definition the player currently has to apply by eye. The reason is budget, not disagreement: `MapView.tsx` is one 285-line SVG already carrying ownership fill, selection, move targets, region seams, impassable ridges, sea lanes, capitals, ports and two label layers, and `tasks/manufactured-map-edges.md` is queued to add another. A map that marks four different kinds of doom teaches none of them. Also rejected: hover-to-reveal from the box, which buys the marks back for free on desktop and is worthless to the half of the table on a phone. |
| 6 | **The map shades exactly one wave: the one that burns when the orders now being written resolve.** `waveCollapsingOn(state.turn, rules)` — not the `storm_warning` event, and not `warnedTerritories`, both of which are phrased from the resolver's perspective one turn further on. One mark, one meaning: do not leave a stack here. | Rejected: a two-intensity version showing the wave after next as well — the map is then never blank during the storm phase, but the fainter mark carries the less urgent meaning, which is backwards from how weight reads. Rejected: the full remaining schedule as a wave-indexed gradient, the `tools/mapviz` treatment — it is a heat map competing with ownership for the fill channel, and it is loudest at turn 1 when it matters least. **Amended by decision 7.** As first recorded, this row also rejected pairing the mark with a storm countdown in the box, and stated the resulting cost as accepted: with `stormFirstWave 10` and `stormInterval 2`, waves land on turns 10/12/14/16/18/20, so the map is unshaded for the first nine turns of a 25-turn game and on every odd turn after, with nothing to distinguish "the storm has not started" from "not this turn" from "the storm is finished". Decision 7 puts the storm's schedule in the box, which covers that gap. The rejection that stands is narrower and is about the *map*: the map never renders a turn number or a countdown. When the map is blank, the box is what says why. |
| 7 | **The box is one panel above the map, and the HUD's two event banners are dissolved into it.** It replaces `GameHud.tsx:43-52` in place, inside `map-wrap` and above `MapView`, and carries: the event in force this turn, the event announced for next turn, the storm's schedule, and neutral growth. `GameHud`'s seat legend stays where it is. | Rejected: a panel in the `.side` orders column beside `OrdersPanel` — better in principle, since it puts what is coming in the same column where orders get written, but `.game-layout` collapses to one column on narrow screens (`styles.css:215-219`) and `.side` stacks *below* the map, so on a phone the forecast would sit below the fold. Rejected: upgrading the two banners in place as more lines — smallest diff, but four banners is a list, not a box, and consolidation was the point. Rejected: also absorbing the `cold_snap` note at `OrdersPanel.tsx:62` — it currently sits next to the income it takes away, and moving it into the box would trade relevance for tidiness. It stays where it bites. |

### The taxonomy, as the code actually has it

All three are *the world acting on you rather than a player acting on you*, and each
currently surfaces in a different place — none of them where it applies.

**1. Losing tiles — `packages/engine/src/storm.ts`.** Spatial and per-tile. A fixed
radial schedule (`generate.ts:654-675`) burns the world inward from the rim; the
innermost ring never collapses, so the endgame is always fought over the same core.
Everything standing on collapsed ground dies with it (`storm.ts:53-59`). *Surfaces as:*
a flat grey fill after the fact (`MapView.tsx:17`), and prose in the report. The
warning never reaches the map at all.

**2. Effects that change the rules for a turn — `packages/engine/src/events.ts`.**
Seven, drawn from a seeded deck without replacement and announced a turn ahead. The
important structural fact is that **they are not all board-wide.** Four are:
`mobilization`, `cold_snap`, `mud_season`, `fog`. **Three name specific tiles and could
be drawn on the map today:**

- `uprising` — every stack of 8+ loses 3 (`events.ts:75-80`)
- `warlords` — 3 random neutral territories gain 3 armies each (`events.ts:84-96`)
- `conscription` — *every frontier territory* raises 1 (`events.ts:98-111`)

*Surfaces as:* one sentence of prose in the HUD banner (`GameHud.tsx:43-52`), identical
in form whether the effect is global or lands on eleven specific tiles you own. A player
told "Conscription — every frontier territory raises one army" is being asked to work
out which of their tiles are frontier, by eye, from a definition they were never given.
`cold_snap` is the only one that has ever earned a second surface (`OrdersPanel.tsx:62`).

**3. Non-player armies — neutral garrisons.** Seeded from `map.neutralGarrisons`
(`setup.ts:60-63`), and they *grow* every `neutralGrowthInterval` turns, default 3
(`resolve.ts:615-616`, `constants.ts:131`). Presets tune them by table size
(`presets.ts:52-88`). *Surfaces as:* the fill `NEUTRAL = '#8a8578'` and a number —
visually the same kind of object as a player's tile, differing only in colour — plus
one clause of prose in the map key: "grey = neutral garrisons that defend and grow over
time." A whole mechanic, growth included, carried by a subordinate clause.

**They interact.** `warlords` (2) is a shock to the neutrals (3). The storm (1) deletes
neutrals along with everyone else. So they cannot be three unrelated decorations bolted
on independently.

### What this does not change

Still client-only, still no engine change: every fact all three would need to draw is
already in `GameState`, `GeneratedMap`, or `RuleConfig` and already crosses `redact()`.
The one thing that would need engine work is the wrong `wave` field on the
`storm_warning` event (`resolve.ts:479`), which nothing reads and nothing should.

### The scatter that decision 4 consolidates

Nothing is missing today; it is spread across five places, none of which is *the* place
to look:

- `GameHud.tsx:43-52` — two banners, `This turn:` and `Next turn:`, one sentence each.
- `ReportView.tsx:153` — `storm_warning`, behind the "Show last turn's report" collapse.
- `ReportView.tsx:181` — `event_announced`, behind the same collapse.
- `OrdersPanel.tsx:62` — a `cold_snap` note, the only event that ever earned a second
  surface, bolted on where it happened to matter.
- `Game.tsx:132-137` — the map key's prose, carrying "neutral garrisons ... grow over
  time" as a subordinate clause.

And one thing genuinely absent: **neutral growth is never announced at all.** It fires
on `state.turn % neutralGrowthInterval` (`resolve.ts:615-616`), which is as predictable
as the storm and told to nobody.

Decision 4 makes that box the answer to "what is the world about to do to me", which is
the same collapse-hiding problem `tasks/tier-list-round-cue.md` names for a different
subject.
