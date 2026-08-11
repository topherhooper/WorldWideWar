/**
 * Graph helpers over the territory adjacency structure.
 *
 * Used by the map generator's validator (connectivity, degree bounds, diameter,
 * articulation points), by supply computation, and by the bots' notion of which
 * territories are structurally critical.
 *
 * Everything here iterates in ascending id order so results are canonical.
 */

/** Vertices reachable from `start`, subject to an optional filter. */
export function reachable(
  adjacency: readonly (readonly number[])[],
  start: number,
  passable: (id: number) => boolean,
): Set<number> {
  const seen = new Set<number>();
  if (!passable(start)) return seen;

  const queue = [start];
  seen.add(start);

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const next of adjacency[current]) {
      if (!seen.has(next) && passable(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Hop distance from `start` to every reachable vertex; -1 where unreachable. */
export function bfsDistances(
  adjacency: readonly (readonly number[])[],
  start: number,
  passable: (id: number) => boolean = () => true,
): number[] {
  const dist = new Array<number>(adjacency.length).fill(-1);
  if (!passable(start)) return dist;

  dist[start] = 0;
  const queue = [start];

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const next of adjacency[current]) {
      if (dist[next] === -1 && passable(next)) {
        dist[next] = dist[current] + 1;
        queue.push(next);
      }
    }
  }
  return dist;
}

/** Connected components as vertex-id arrays, each sorted ascending. */
export function components(
  adjacency: readonly (readonly number[])[],
  passable: (id: number) => boolean = () => true,
): number[][] {
  const seen = new Array<boolean>(adjacency.length).fill(false);
  const out: number[][] = [];

  for (let start = 0; start < adjacency.length; start++) {
    if (seen[start] || !passable(start)) continue;
    const group = reachable(adjacency, start, passable);
    for (const id of group) seen[id] = true;
    out.push([...group].sort((a, b) => a - b));
  }
  return out;
}

export function isConnected(
  adjacency: readonly (readonly number[])[],
  passable: (id: number) => boolean = () => true,
): boolean {
  const live: number[] = [];
  for (let i = 0; i < adjacency.length; i++) if (passable(i)) live.push(i);
  if (live.length === 0) return true;
  return reachable(adjacency, live[0], passable).size === live.length;
}

/**
 * Longest shortest-path in the graph.
 *
 * The generator rejects maps whose diameter is too large: a sprawling map means
 * players spend the early game walking rather than fighting, which is precisely
 * the slow-Risk failure mode the design exists to avoid.
 */
export function diameter(adjacency: readonly (readonly number[])[]): number {
  let worst = 0;
  for (let start = 0; start < adjacency.length; start++) {
    const dist = bfsDistances(adjacency, start);
    for (const d of dist) if (d > worst) worst = d;
  }
  return worst;
}

/**
 * Articulation points (cut vertices) — vertices whose removal disconnects the
 * graph — together with the size of the largest fragment their removal creates.
 *
 * The generator uses this to reject maps containing a single chokepoint that
 * seals off a large region, since owning one tile should never make a player
 * unassailable.
 */
export function articulationPoints(adjacency: readonly (readonly number[])[]): Map<number, number> {
  const n = adjacency.length;
  const discovery = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const parent = new Array<number>(n).fill(-1);
  const isArticulation = new Array<boolean>(n).fill(false);
  let timer = 0;

  // Iterative Tarjan: recursion would blow the stack on large generated maps.
  for (let root = 0; root < n; root++) {
    if (discovery[root] !== -1) continue;

    let rootChildren = 0;
    const stack: { v: number; childIndex: number }[] = [{ v: root, childIndex: 0 }];
    discovery[root] = low[root] = timer++;

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const v = frame.v;

      if (frame.childIndex < adjacency[v].length) {
        const next = adjacency[v][frame.childIndex++];
        if (discovery[next] === -1) {
          parent[next] = v;
          if (v === root) rootChildren++;
          discovery[next] = low[next] = timer++;
          stack.push({ v: next, childIndex: 0 });
        } else if (next !== parent[v]) {
          low[v] = Math.min(low[v], discovery[next]);
        }
      } else {
        stack.pop();
        const p = parent[v];
        if (p !== -1) {
          low[p] = Math.min(low[p], low[v]);
          if (p !== root && low[v] >= discovery[p]) isArticulation[p] = true;
        }
      }
    }

    if (rootChildren > 1) isArticulation[root] = true;
  }

  const out = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    if (!isArticulation[v]) continue;
    const parts = components(adjacency, (id) => id !== v);
    let largest = 0;
    for (const part of parts) if (part.length > largest) largest = part.length;
    out.set(v, largest);
  }
  return out;
}

/** Builds adjacency lists from an edge list. Each list is sorted ascending. */
export function buildAdjacency(
  vertexCount: number,
  edges: readonly { a: number; b: number }[],
): number[][] {
  const adjacency: number[][] = Array.from({ length: vertexCount }, () => []);
  for (const edge of edges) {
    adjacency[edge.a].push(edge.b);
    adjacency[edge.b].push(edge.a);
  }
  for (const list of adjacency) list.sort((x, y) => x - y);
  return adjacency;
}
