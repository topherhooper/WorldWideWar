# Map Adjacency Doesn't Match What Players See — Idea

Date: 2026-08-14
Status: Captured — not yet brainstormed
Source: Player group text thread, 2026-08-12 → 2026-08-13. Originally filed as GitHub
issue #8 before this project moved to in-repo idea tracking.

## Raw dump

> **Paco:** it seems certain territories aren't allowed to move to others that they
> border?

> **Topher:** Yeah the movement is a bit odd. I updated the map visuals so it should at
> least be more obvious what armies can move where. This was highly optimized by super
> computer that determined through 100 lifetimes that this was the most balanced

> **Sam:** It doesn't help that spaces that look adjacent aren't necessarily connected

> **Topher:** 💯

> **Topher:** here's what the page says about storms "... Sea lanes (⚓) make two distant
> territories adjacent for movement."

## What's being asked

- Make the map agree with the movement rules, in one direction or the other.
- Two players independently read a shared border as a legal move and were wrong.

## Already verified

Confirmed in code while this was a GitHub issue. The direction everyone complained
about is already handled; the real defect is its mirror image.

**Handled.** `carveChokepoints` (`packages/engine/src/mapgen/generate.ts:200-284`)
deliberately deletes roughly half the shared borders to reach
`TARGET_AVERAGE_DEGREE = 3.2`. The client already draws these as beaded umber ridges —
`impassableBorders` at `packages/web/src/game/MapView.tsx:59-63`, with a map-key entry
at `packages/web/src/pages/Game.tsx:132-137`. Working as designed, though evidently not
legible enough, since two players still misread those borders.

**Not handled — the actual bug.** `symmetrizeEdges`
(`packages/engine/src/mapgen/symmetry.ts:119-158`) takes a majority vote per edge orbit
and then adds the winner to _every_ wedge:

```ts
if (seen * 2 < orbitSize) continue;   // majority survives...
for (let k = 0; k < layout.playerCount; k++) { ... result.push({a: lo, b: hi}) }  // ...added to ALL wedges
```

An adjacency that was a real Voronoi neighbour in, say, 7 of 12 wedges gets
_manufactured_ in the other 5. Those are `kind: 'land'` edges joining territories whose
polygons share no segment — legal to cross, and invisible, because `sharedSegments`
(`MapView.tsx:26-45`) can only draw borders present in the polygon data. There is no
affordance for "you can walk here but there is no border."

Supporting gaps:

- `packages/engine/src/mapgen/validate.ts` checks degree, connectivity, symmetry and
  structure, but never asserts that `adjacency` is a subset of shared-polygon borders.
  `generate.test.ts` doesn't either. That invariant would have caught this.
- Sea lanes are drawn only when their port is selected (`MapView.tsx:117-120`);
  otherwise the sole cue is the `⚓` glyph, with no indication of the far end.
- `tools/mapviz/src/render.ts` never draws impassable ridges at all, so any reasoning
  done from a mapviz SVG assumes every shared border is passable.

## Open questions

- Fix `symmetrizeEdges` to drop orbit members with no real border, or render the
  manufactured edges explicitly as drawn connectors? The first changes generated maps
  (and therefore the balance sweep); the second doesn't.
- How many manufactured edges actually exist per map? Nobody has measured it. The
  validator invariant would answer this before any fix is chosen.
- The carved-border rendering exists but didn't land with players. Is that a visual
  design problem separate from this bug?

## Constraints & non-goals

- Changing map generation invalidates in-flight games and moves the balance numbers.
  CI runs a 300-seed mapgen sweep and an 800-game balance sweep.
- Topher on the current adjacency: "This was highly optimized by super computer that
  determined through 100 lifetimes that this was the most balanced." Read as: the
  carving is intentional and shouldn't be undone.

## Suggested next step

Brainstorm — but the first task in any resulting plan should be the `validate.ts`
invariant, since it converts "how bad is this?" from a guess into a number.
