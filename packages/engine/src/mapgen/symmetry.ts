/**
 * The fairness mechanism.
 *
 * The world is a disc built from one angular wedge rotated P times, plus a
 * single territory at the exact centre. Because the centre is fixed by rotation
 * and every other territory belongs to an orbit of exactly P territories — one
 * per wedge — rotating the map by 2π/P is a graph automorphism that maps each
 * player's starting position onto the next player's.
 *
 * That makes "is this generated map fair?" a geometric invariant rather than an
 * optimisation problem: every player's neighbourhood is *graph-isomorphic* to
 * every other's, so spawning boxed into a corner or with a runaway start is not
 * mitigated, it is impossible. The map validator asserts it as an equality.
 *
 * Territory ids encode the structure directly:
 *
 *   id = local * P + wedge      for local in [0, perWedge), wedge in [0, P)
 *   id = perWedge * P           the centre
 */

export interface SymmetryLayout {
  playerCount: number;
  perWedge: number;
  /** Total territory count, including the centre. */
  count: number;
  /** Id of the single central territory. */
  centre: number;
}

export function makeLayout(playerCount: number, perWedge: number): SymmetryLayout {
  return {
    playerCount,
    perWedge,
    count: perWedge * playerCount + 1,
    centre: perWedge * playerCount,
  };
}

/**
 * Territories per wedge, chosen so the total lands near 6P + 6 — roughly six
 * territories per player, which is what makes first contact happen on turn 1–2
 * regardless of table size.
 */
export function perWedgeFor(playerCount: number): number {
  return Math.max(5, Math.round(6 + 5 / playerCount));
}

export function isCentre(layout: SymmetryLayout, id: number): boolean {
  return id === layout.centre;
}

export function localOf(layout: SymmetryLayout, id: number): number {
  return id === layout.centre ? -1 : Math.floor(id / layout.playerCount);
}

export function wedgeOf(layout: SymmetryLayout, id: number): number {
  return id === layout.centre ? -1 : id % layout.playerCount;
}

export function territoryId(layout: SymmetryLayout, local: number, wedge: number): number {
  return local * layout.playerCount + (((wedge % layout.playerCount) + layout.playerCount) %
    layout.playerCount);
}

/** Rotates a territory by `steps` wedges. The centre maps to itself. */
export function rotate(layout: SymmetryLayout, id: number, steps: number): number {
  if (id === layout.centre) return layout.centre;
  return territoryId(layout, localOf(layout, id), wedgeOf(layout, id) + steps);
}

/** The P territories an id belongs to, indexed by wedge. */
export function orbit(layout: SymmetryLayout, id: number): number[] {
  if (id === layout.centre) return [layout.centre];
  return Array.from({ length: layout.playerCount }, (_, k) => rotate(layout, id, k));
}

/**
 * The canonical member of an id's orbit: the copy sitting in wedge 0.
 *
 * Every symmetric decision — which edges to cut, which territories form a
 * region, which storm wave a territory belongs to — is made once for the
 * canonical representative and then applied to the whole orbit. Deciding per
 * orbit rather than per territory is what keeps symmetry exact instead of
 * approximate.
 */
export function canonical(layout: SymmetryLayout, id: number): number {
  return id === layout.centre ? layout.centre : territoryId(layout, localOf(layout, id), 0);
}

/** A rotation-invariant key for an undirected edge. */
export function edgeOrbitKey(layout: SymmetryLayout, a: number, b: number): string {
  const forms: string[] = [];
  for (let k = 0; k < layout.playerCount; k++) {
    const ra = rotate(layout, a, k);
    const rb = rotate(layout, b, k);
    const lo = Math.min(ra, rb);
    const hi = Math.max(ra, rb);
    // Only rotations landing the edge in a canonical position describe the
    // orbit; taking the lexicographic minimum over all of them gives one
    // stable name per orbit.
    forms.push(`${lo}-${hi}`);
  }
  forms.sort();
  return forms[0];
}

/**
 * Forces an edge set to be exactly P-fold symmetric.
 *
 * Delaunay triangulation runs in floating point, so rotating a point set by
 * 2πk/P introduces error around 1e-12 and two wedges can very occasionally
 * disagree about a near-degenerate adjacency. Rather than hope that never
 * happens, we take a vote per orbit: an edge survives in every wedge or in
 * none. Symmetry becomes structural rather than something we rely on the
 * floating-point gods to preserve.
 */
export function symmetrizeEdges(
  layout: SymmetryLayout,
  edges: readonly { a: number; b: number }[],
): { a: number; b: number }[] {
  const votes = new Map<string, number>();
  const example = new Map<string, { a: number; b: number }>();

  for (const edge of edges) {
    const key = edgeOrbitKey(layout, edge.a, edge.b);
    votes.set(key, (votes.get(key) ?? 0) + 1);
    if (!example.has(key)) example.set(key, edge);
  }

  const out = new Set<string>();
  const result: { a: number; b: number }[] = [];

  const keys = [...votes.keys()].sort();
  for (const key of keys) {
    const seen = votes.get(key)!;
    const orbitSize = orbitSizeOfEdge(layout, example.get(key)!);
    // Majority vote across the orbit's copies.
    if (seen * 2 < orbitSize) continue;

    const { a, b } = example.get(key)!;
    for (let k = 0; k < layout.playerCount; k++) {
      const ra = rotate(layout, a, k);
      const rb = rotate(layout, b, k);
      if (ra === rb) continue;
      const lo = Math.min(ra, rb);
      const hi = Math.max(ra, rb);
      const id = `${lo}-${hi}`;
      if (out.has(id)) continue;
      out.add(id);
      result.push({ a: lo, b: hi });
    }
  }

  result.sort((x, y) => x.a - y.a || x.b - y.b);
  return result;
}

/**
 * How many distinct edges an orbit contains. Usually P, but an edge joining two
 * territories in the same orbit can map onto itself and yield a smaller orbit.
 */
function orbitSizeOfEdge(layout: SymmetryLayout, edge: { a: number; b: number }): number {
  const seen = new Set<string>();
  for (let k = 0; k < layout.playerCount; k++) {
    const ra = rotate(layout, edge.a, k);
    const rb = rotate(layout, edge.b, k);
    seen.add(`${Math.min(ra, rb)}-${Math.max(ra, rb)}`);
  }
  return seen.size;
}

/**
 * Orders a territory's neighbours rotation-equivariantly.
 *
 * Sorting neighbours by raw id would not survive rotation — ids are not
 * ordered symmetrically around the disc — so any choice made that way (which
 * territories a player starts with, say) would differ between seats. Sorting by
 * (neighbour's local index, wedge offset relative to the anchor) does survive
 * it, so every player makes the identical structural choice.
 */
export function equivariantNeighbourOrder(
  layout: SymmetryLayout,
  anchor: number,
  neighbours: readonly number[],
): number[] {
  const anchorWedge = wedgeOf(layout, anchor);
  const key = (id: number): [number, number] => {
    if (id === layout.centre) return [-1, -1];
    const offset =
      anchorWedge === -1
        ? wedgeOf(layout, id)
        : (wedgeOf(layout, id) - anchorWedge + layout.playerCount) % layout.playerCount;
    return [localOf(layout, id), offset];
  };
  return neighbours.slice().sort((x, y) => {
    const kx = key(x);
    const ky = key(y);
    return kx[0] - ky[0] || kx[1] - ky[1];
  });
}
