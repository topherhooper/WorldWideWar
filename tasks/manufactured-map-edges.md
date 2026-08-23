---
status: open
kind: task
area: web
priority: 1
blocked-by: ''
---

# Draw the map edges players are allowed to cross

## Next step

Render the manufactured adjacencies as explicit connectors in `MapView.tsx`, the way sea lanes already are. This is client-only: it invalidates no in-flight game and moves no balance number.

While in there, add the `validate.ts` invariant that `adjacency` is a subset of shared-polygon borders -- not as the goal, but because it prints how many manufactured edges a map actually has, which nobody has ever measured.

## What we know

`symmetrizeEdges` (`engine/src/mapgen/symmetry.ts:119-158`) takes a majority vote per edge orbit and then adds the winner to every wedge, manufacturing `kind: 'land'` edges between territories whose polygons share no segment. They are legal to cross and impossible to draw, because `sharedSegments` can only render borders present in the polygon data.

The opposite case -- borders you can see but cannot cross -- is already handled and drawn as beaded ridges. Two players still misread those, which may be a separate visual problem.

Do not "fix" `symmetrizeEdges` as the first move: changing mapgen invalidates in-flight games and shifts the 300-seed and 800-game CI sweeps.

Full analysis: [docs/map-adjacency.md](../docs/map-adjacency.md).
