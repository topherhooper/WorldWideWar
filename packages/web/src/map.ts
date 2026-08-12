/**
 * The board.
 *
 * Everything a player needs to decide a turn has to be legible without clicking
 * anything: who holds what, how much is standing on it, what the storm is about
 * to take, and what their own orders currently say. So the map draws the draft
 * on top of the position — arrows for moves, dashed ties for supports, badges
 * for deployments — rather than leaving orders in a list beside it.
 */

import type { GameState, GeneratedMap, Slot, TerritoryId } from '@www/engine';
import { s } from './dom.js';
import { colourFor } from './palette.js';
import type { OrderDraft } from './orders.js';
import { HIDDEN } from './orders.js';

export type TargetMode = 'move' | 'support';

export interface MapViewOptions {
  map: GeneratedMap;
  state: GameState;
  draft: OrderDraft | null;
  you: Slot | null;
  selected: TerritoryId | null;
  mode: TargetMode;
  warned: TerritoryId[];
  onSelect: (id: TerritoryId | null) => void;
  onTarget: (id: TerritoryId) => void;
}

export function legalTargets(options: MapViewOptions): TerritoryId[] {
  const { draft, selected, mode } = options;
  if (draft === null || selected === null || !draft.owns(selected)) return [];
  return draft
    .neighbours(selected)
    .filter((id) =>
      mode === 'move' ? draft.canMove(selected, id) : draft.canSupport(selected, id),
    );
}

export function renderMap(options: MapViewOptions): SVGSVGElement {
  const { map, state } = options;
  const extent = map.radius * 1.14;
  const targets = new Set(legalTargets(options));
  const warned = new Set(options.warned);

  const root = s(
    'svg',
    {
      class: 'map',
      viewBox: `${-extent} ${-extent} ${extent * 2} ${extent * 2}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'application',
      'aria-label': 'World map',
    },
    defs(map, options.draft ? colourFor(options.draft.slot) : '#8fa4c4'),
    s('circle', { cx: 0, cy: 0, r: map.radius * 1.06, class: 'map-world' }),
    seaLanes(map, state),
    territories(options, targets, warned),
    overlays(options),
    labels(options),
  );

  // Clicking the empty ocean is the natural way to mean "never mind".
  root.addEventListener('click', (event) => {
    if (event.target === root) options.onSelect(null);
  });

  return root;
}

function defs(_map: GeneratedMap, arrowColour: string): SVGElement {
  return s(
    'defs',
    {},
    s(
      'marker',
      {
        id: 'arrowhead',
        markerWidth: 4,
        markerHeight: 4,
        refX: 3.2,
        refY: 2,
        orient: 'auto',
        markerUnits: 'strokeWidth',
      },
      // `context-stroke` would be tidier, but is young enough that a fixed
      // colour is the safer choice — and only one player's arrows are ever
      // drawn, so one colour is all this needs.
      s('path', { d: 'M 0 0 L 4 2 L 0 4 z', fill: arrowColour }),
    ),
  );
}

function territories(
  options: MapViewOptions,
  targets: Set<TerritoryId>,
  warned: Set<TerritoryId>,
): SVGElement {
  const { map, state, draft, selected } = options;
  const regionHue = new Map(map.regions.map((region) => [region.id, region.hue]));
  const group = s('g', { class: 'territories' });

  for (const territory of map.territories) {
    const id = territory.id;
    const owner = state.owner[id];
    const collapsed = state.collapsed[id];
    const points = territory.polygon.map(([x, y]) => `${x},${y}`).join(' ');

    const classes = ['territory'];
    if (collapsed) classes.push('is-collapsed');
    if (id === selected) classes.push('is-selected');
    if (targets.has(id)) classes.push('is-target');
    if (warned.has(id) && !collapsed) classes.push('is-warned');
    if (draft && draft.owns(id) && !state.supplied[id]) classes.push('is-cut-off');
    if (owner !== null && owner === options.you) classes.push('is-yours');

    const fill = collapsed
      ? '#171d29'
      : owner === null
        ? `hsl(${regionHue.get(territory.regionId) ?? 210} 22% 26%)`
        : colourFor(owner);

    const polygon = s('polygon', {
      points,
      fill,
      class: classes.join(' '),
      'data-territory': id,
    });

    if (!collapsed) {
      polygon.addEventListener('click', (event) => {
        event.stopPropagation();
        if (targets.has(id)) options.onTarget(id);
        else options.onSelect(id);
      });
    }

    group.appendChild(polygon);
  }

  return group;
}

function seaLanes(map: GeneratedMap, state: GameState): SVGElement {
  const centroid = new Map(map.territories.map((territory) => [territory.id, territory.centroid]));
  const group = s('g', { class: 'sea-lanes' });

  for (const edge of map.edges) {
    if (edge.kind !== 'sea') continue;
    if (state.collapsed[edge.a] && state.collapsed[edge.b]) continue;
    const a = centroid.get(edge.a);
    const b = centroid.get(edge.b);
    if (!a || !b) continue;

    // Bowed outward so overlapping lanes stay distinguishable.
    const mx = ((a[0] + b[0]) / 2) * 1.25;
    const my = ((a[1] + b[1]) / 2) * 1.25;
    group.appendChild(s('path', { d: `M ${a[0]} ${a[1]} Q ${mx} ${my} ${b[0]} ${b[1]}` }));
  }

  return group;
}

function overlays(options: MapViewOptions): SVGElement {
  const { map, draft } = options;
  const group = s('g', { class: 'orders-layer' });
  if (!draft) return group;

  const centroid = (id: TerritoryId): [number, number] => map.territories[id]?.centroid ?? [0, 0];
  const colour = colourFor(draft.slot);

  for (const unit of draft.orders.units) {
    const from = centroid(unit.from);

    if (unit.kind === 'HOLD') {
      group.appendChild(
        s('circle', {
          class: 'order-hold',
          cx: from[0],
          cy: from[1],
          r: map.radius * 0.055,
          stroke: colour,
        }),
      );
      continue;
    }

    const to = centroid(unit.kind === 'MOVE' ? unit.to : unit.target);
    // Stop the arrow short of the destination centroid so it points at the
    // territory rather than burying its head in the army count.
    const [ex, ey] = shorten(from, to, map.radius * 0.075);

    if (unit.kind === 'MOVE') {
      group.appendChild(
        s('line', {
          class: 'order-move',
          x1: from[0],
          y1: from[1],
          x2: ex,
          y2: ey,
          stroke: colour,
          'marker-end': 'url(#arrowhead)',
        }),
      );
      // Offset the count off the shaft rather than on it, so a short arrow
      // between two neighbours does not read as a smudge.
      const [lx, ly] = beside(from, [ex, ey], map.radius * 0.04);
      group.appendChild(
        s(
          'text',
          {
            class: 'order-count',
            x: lx,
            y: ly,
            'text-anchor': 'middle',
            'font-size': map.radius * 0.04,
          },
          String(unit.count),
        ),
      );
      continue;
    }

    group.appendChild(
      s('line', {
        class: 'order-support',
        x1: from[0],
        y1: from[1],
        x2: ex,
        y2: ey,
        stroke: colourFor(unit.forPlayer),
      }),
    );
  }

  for (const deploy of draft.orders.deploys) {
    const [x, y] = centroid(deploy.to);
    group.appendChild(
      s(
        'text',
        {
          class: 'order-deploy',
          x,
          y: y + map.radius * 0.085,
          'text-anchor': 'middle',
          'font-size': map.radius * 0.042,
          fill: colour,
        },
        `+${deploy.count}`,
      ),
    );
  }

  return group;
}

function labels(options: MapViewOptions): SVGElement {
  const { map, state, draft } = options;
  const group = s('g', { class: 'labels' });
  const capitals = new Map<TerritoryId, Slot>();
  for (let slot = 0; slot < state.playerCount; slot++) {
    const capital = state.capital[slot];
    if (capital !== null) capitals.set(capital, slot);
  }

  for (const territory of map.territories) {
    const id = territory.id;
    if (state.collapsed[id]) continue;
    const [x, y] = territory.centroid;

    if (capitals.has(id)) {
      const r = map.radius * 0.028;
      group.appendChild(
        s('path', {
          class: 'capital-mark',
          d: `M ${x} ${y - map.radius * 0.105} l ${r} ${r} l ${-r} ${r} l ${-r} ${-r} z`,
          fill: colourFor(capitals.get(id) ?? null),
        }),
      );
    }

    group.appendChild(
      s(
        'text',
        {
          class: 'territory-name',
          x,
          y: y - map.radius * 0.028,
          'text-anchor': 'middle',
          'font-size': map.radius * 0.026,
        },
        territory.name,
      ),
    );

    const armies = state.armies[id];
    const pending = draft?.deployAt(id) ?? 0;
    group.appendChild(
      s(
        'text',
        {
          class: 'territory-armies',
          x,
          y: y + map.radius * 0.045,
          'text-anchor': 'middle',
          'font-size': map.radius * 0.05,
        },
        armies === HIDDEN ? '?' : String(armies + pending),
      ),
    );
  }

  return group;
}

/** The midpoint of a segment, pushed out along its perpendicular. */
function beside(
  from: readonly [number, number],
  to: readonly [number, number],
  by: number,
): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  return [(from[0] + to[0]) / 2 - (dy / length) * by, (from[1] + to[1]) / 2 + (dx / length) * by];
}

function shorten(
  from: readonly [number, number],
  to: readonly [number, number],
  by: number,
): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length <= by) return [to[0], to[1]];
  const scale = (length - by) / length;
  return [from[0] + dx * scale, from[1] + dy * scale];
}
