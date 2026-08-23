# Adjacency does not match the drawn map

> **Paco:** it seems certain territories aren't allowed to move to others that they
> border?
>
> **Sam:** It doesn't help that spaces that look adjacent aren't necessarily connected

Two players independently read a shared border as a legal move and were wrong. The
direction they complained about is already handled; the real defect is its mirror
image, and it is invisible.

## Handled: carved borders you can see but cannot cross

`carveChokepoints` (`packages/engine/src/mapgen/generate.ts:200-284`) deliberately
deletes roughly half the shared borders to reach `TARGET_AVERAGE_DEGREE = 3.2`. The
client draws these as beaded umber ridges (`packages/web/src/game/MapView.tsx:59-63`)
with a map-key entry (`packages/web/src/pages/Game.tsx:132-137`).

Working as designed — but evidently not legible enough, since two players still
misread those borders. Whether that is a separate visual-design problem is open.

Topher on the carving: "This was highly optimized by super computer that determined
through 100 lifetimes that this was the most balanced." Read as: intentional, don't
undo it.

## The actual bug: edges you can cross that are drawn nowhere

`symmetrizeEdges` (`packages/engine/src/mapgen/symmetry.ts:119-158`) takes a majority
vote per edge orbit and then adds the winner to _every_ wedge:

```ts
if (seen * 2 < orbitSize) continue;   // majority survives...
for (let k = 0; k < layout.playerCount; k++) { ... result.push({a: lo, b: hi}) }  // ...added to ALL wedges
```

An adjacency that was a real Voronoi neighbour in, say, 7 of 12 wedges gets
**manufactured** in the other 5. Those are `kind: 'land'` edges joining territories
whose polygons share no segment — legal to cross, and invisible, because
`sharedSegments` (`MapView.tsx:26-45`) can only draw borders present in the polygon
data. There is no affordance for "you can walk here but there is no border."

**Nobody has measured how many manufactured edges exist per map.**

Supporting gaps:

- `packages/engine/src/mapgen/validate.ts` checks degree, connectivity, symmetry and
  structure, but never asserts that `adjacency` is a subset of shared-polygon borders.
  `generate.test.ts` doesn't either. That invariant would have caught this, and would
  turn "how bad is it?" into a number.
- Sea lanes are drawn only when their port is selected (`MapView.tsx:117-120`);
  otherwise the sole cue is the `⚓` glyph, with no indication of the far end.
- `tools/mapviz/src/render.ts` never draws impassable ridges at all, so any reasoning
  done from a mapviz SVG assumes every shared border is passable.

## The constraint on any fix

Changing map generation invalidates in-flight games and moves the balance numbers;
CI runs a 300-seed mapgen sweep and an 800-game balance sweep. Rendering the
manufactured edges as explicit connectors does neither — it changes only the client.
Fixing `symmetrizeEdges` to drop orbit members with no real border does both.
