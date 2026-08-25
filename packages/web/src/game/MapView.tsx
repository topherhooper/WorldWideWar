import { useMemo } from 'react';
import { HIDDEN_ARMIES, waveCollapsingOn } from '@www/engine';
import type { GameState, GeneratedMap, RuleConfig, TerritoryId } from '@www/engine';

import { playerColor } from '../format.js';

interface Props {
  map: GeneratedMap;
  state: GameState;
  rules: RuleConfig;
  mySlot: number | null;
  selected: TerritoryId | null;
  mode: 'deploy' | 'move';
  onTerritoryClick: (id: TerritoryId) => void;
}

const NEUTRAL = '#8a8578';
/** Ash: ground the storm has already taken. Still drawn, still shaped, dead. */
const COLLAPSED = '#3b3833';

type Segment = [number, number, number, number];

/**
 * Polygon segments shared by two territories, with both owners. Voronoi
 * neighbours share their vertices exactly (both rounded from the same points),
 * so matching segment endpoints is reliable.
 */
function sharedSegments(map: GeneratedMap): { seg: Segment; a: number; b: number }[] {
  const firstOwner = new Map<string, number>();
  const out: { seg: Segment; a: number; b: number }[] = [];
  for (const t of map.territories) {
    for (let i = 0; i < t.polygon.length; i++) {
      const [ax, ay] = t.polygon[i];
      const [bx, by] = t.polygon[(i + 1) % t.polygon.length];
      if (ax === bx && ay === by) continue; // closed-ring duplicate point
      const key =
        ax < bx || (ax === bx && ay < by) ? `${ax},${ay},${bx},${by}` : `${bx},${by},${ax},${ay}`;
      const other = firstOwner.get(key);
      if (other === undefined) {
        firstOwner.set(key, t.id);
      } else {
        out.push({ seg: [ax, ay, bx, by], a: other, b: t.id });
      }
    }
  }
  return out;
}

/** Segments where two different regions meet. */
function regionBorders(map: GeneratedMap): Segment[] {
  return sharedSegments(map)
    .filter(({ a, b }) => map.territories[a].regionId !== map.territories[b].regionId)
    .map(({ seg }) => seg);
}

/**
 * Segments where two territories touch on the drawing but are not connected in
 * the game graph — the generator thins Voronoi adjacency to carve chokepoints.
 * Without marking these, a refused move along a shared border looks like a bug.
 */
function impassableBorders(map: GeneratedMap): Segment[] {
  return sharedSegments(map)
    .filter(({ a, b }) => !map.adjacency[a]?.includes(b))
    .map(({ seg }) => seg);
}

function polygonArea(polygon: readonly [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    sum += ax * by - bx * ay;
  }
  return Math.abs(sum) / 2;
}

/** One anchor per region: the centroid of its largest territory. */
function regionAnchors(map: GeneratedMap): { id: number; x: number; y: number }[] {
  return map.regions.map((region) => {
    let best = region.territoryIds[0];
    let bestArea = -1;
    for (const id of region.territoryIds) {
      const area = polygonArea(map.territories[id].polygon);
      if (area > bestArea) {
        bestArea = area;
        best = id;
      }
    }
    const [x, y] = map.territories[best].centroid;
    return { id: region.id, x, y };
  });
}

/** A sea-lane path bowed sideways, so it reads as a route rather than a border. */
function lanePath(map: GeneratedMap, a: TerritoryId, b: TerritoryId): string {
  const [ax, ay] = map.territories[a].centroid;
  const [bx, by] = map.territories[b].centroid;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const bow = 0.16 * len + map.radius * 0.05;
  return `M ${ax} ${ay} Q ${mx - (dy / len) * bow} ${my + (dx / len) * bow} ${bx} ${by}`;
}

/**
 * Territories the storm takes when the orders now being written resolve.
 *
 * Deliberately not `warnedTerritories`, and not the `storm_warning` event: both
 * are phrased from the resolver's point of view, one turn further on. What a
 * player needs while writing orders for turn T is the wave that dies during
 * T's resolution, which is exactly `waveCollapsingOn(T)`.
 */
function doomedNow(map: GeneratedMap, state: GameState, rules: RuleConfig): Set<TerritoryId> {
  const wave = waveCollapsingOn(state.turn, rules);
  if (wave === null || wave >= map.collapseWaves.length) return new Set();
  return new Set(map.collapseWaves[wave].filter((id) => !state.collapsed[id]));
}

export function MapView({ map, state, rules, mySlot, selected, mode, onTerritoryClick }: Props) {
  const r = map.radius * 1.04;
  const armyFont = map.radius * 0.05;
  const nameFont = map.radius * 0.026;
  const regionFont = map.radius * 0.03;
  const targets = selected === null ? new Set<number>() : new Set(map.adjacency[selected]);
  const capitals = new Set(state.capital.filter((c): c is TerritoryId => c !== null));
  const borders = useMemo(() => regionBorders(map), [map]);
  const walls = useMemo(() => impassableBorders(map), [map]);
  const anchors = useMemo(() => regionAnchors(map), [map]);
  const seaLanes = useMemo(() => map.edges.filter((e) => e.kind === 'sea'), [map]);
  const doomed = useMemo(() => doomedNow(map, state, rules), [map, state, rules]);
  const hatchStep = map.radius * 0.018;
  const ports = useMemo(() => new Set(seaLanes.flatMap((e) => [e.a, e.b])), [seaLanes]);
  // Routes are drawn only for the selected port — always-on lanes crossing the
  // whole map read as noise, not adjacency.
  const activeLanes =
    selected === null ? [] : seaLanes.filter((e) => e.a === selected || e.b === selected);
  // In move mode with nothing picked, light up the territories you can move from.
  const pickingSource = mode === 'move' && selected === null;

  return (
    <svg
      className="map"
      viewBox={`${-r} ${-r} ${2 * r} ${2 * r}`}
      role="img"
      aria-label="world map"
    >
      <defs>
        {/* The storm warning. A hatch rather than a fill, because fill is
            already spent on eight player colours plus neutral — laid over the
            territory, the owner still reads underneath it. */}
        <pattern
          id="storm-hatch"
          patternUnits="userSpaceOnUse"
          width={hatchStep}
          height={hatchStep}
          patternTransform="rotate(45)"
        >
          <rect width={hatchStep} height={hatchStep} fill="#0b0b12" fillOpacity={0.42} />
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={hatchStep}
            stroke="#ff6b3d"
            strokeOpacity={0.95}
            strokeWidth={hatchStep * 0.34}
          />
        </pattern>
      </defs>

      {map.territories.map((t) => {
        const owner = state.owner[t.id];
        const collapsed = state.collapsed[t.id];
        const fill = collapsed ? COLLAPSED : owner === null ? NEUTRAL : playerColor(owner);
        const isSelected = selected === t.id;
        const isTarget = targets.has(t.id) && !collapsed;
        const isSource = pickingSource && owner === mySlot && !collapsed && state.armies[t.id] > 0;
        // With a source picked, everything unreachable steps back so the
        // legal destinations are the only bright things on the map.
        const dimmed =
          mode === 'move' && selected !== null && !isSelected && !isTarget && !collapsed;
        return (
          <polygon
            key={t.id}
            className={isTarget && !isSelected ? 'map-target' : undefined}
            points={t.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
            fill={fill}
            fillOpacity={
              collapsed ? 0.9 : dimmed ? 0.28 : isTarget ? 1 : owner === mySlot ? 0.95 : 0.72
            }
            stroke={isSelected || isTarget ? '#ffffff' : isSource ? '#e6c84d' : '#14141c'}
            strokeWidth={isSelected ? 5 : isTarget ? 4.5 : isSource ? 2.5 : 1}
            strokeDasharray={isTarget && !isSelected ? '8 6' : undefined}
            onClick={() => {
              if (!collapsed) onTerritoryClick(t.id);
            }}
            style={{ cursor: collapsed ? 'default' : 'pointer' }}
          >
            <title>
              {t.name} — {map.regions[t.regionId]?.name ?? ''}
            </title>
          </polygon>
        );
      })}

      {/* Region seams: a wide dark base under a bright cream core — bold
          enough to read as the map's first-order structure at a glance, over
          both bright ownership fills and the muted neutral tone. */}
      {borders.map(([ax, ay, bx, by], i) => (
        <g key={`b${i}`} pointerEvents="none">
          <line
            x1={ax}
            y1={ay}
            x2={bx}
            y2={by}
            stroke="#0b0b12"
            strokeWidth={20}
            strokeLinecap="round"
          />
          <line
            x1={ax}
            y1={ay}
            x2={bx}
            y2={by}
            stroke="#e8e6df"
            strokeOpacity={0.8}
            strokeWidth={6}
            strokeLinecap="round"
          />
        </g>
      ))}

      {/* Impassable ridges: shared borders the game graph does not cross. A
          beaded umber core over a dark base — clearly not the smooth light
          seam — says "terrain", not "boundary". Drawn after the seams so a
          border that is both reads as impassable first. */}
      {walls.map(([ax, ay, bx, by], i) => (
        <g key={`w${i}`} pointerEvents="none">
          <line
            x1={ax}
            y1={ay}
            x2={bx}
            y2={by}
            stroke="#0b0b12"
            strokeWidth={10}
            strokeLinecap="round"
          />
          <line
            x1={ax}
            y1={ay}
            x2={bx}
            y2={by}
            stroke="#a07a4a"
            strokeOpacity={0.85}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeDasharray="3 7"
          />
        </g>
      ))}

      {activeLanes.map((e, i) => (
        <path
          key={`s${i}`}
          d={lanePath(map, e.a, e.b)}
          fill="none"
          stroke="#66e0ff"
          strokeOpacity={0.85}
          strokeWidth={map.radius * 0.008}
          strokeDasharray="16 12"
          pointerEvents="none"
        />
      ))}

      {/* Storm warning overlay: these tiles, and everything standing on them,
          are gone when the orders being written now resolve. */}
      {map.territories
        .filter((t) => doomed.has(t.id))
        .map((t) => (
          <polygon
            key={`d${t.id}`}
            points={t.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="url(#storm-hatch)"
            stroke="#ff6b3d"
            strokeWidth={3}
            strokeOpacity={0.9}
            pointerEvents="none"
          />
        ))}

      {map.territories.map((t) => {
        if (state.collapsed[t.id]) return null;
        const armies = state.armies[t.id];
        const dimmed =
          mode === 'move' && selected !== null && t.id !== selected && !targets.has(t.id);
        return (
          <g key={`l${t.id}`} pointerEvents="none" opacity={dimmed ? 0.35 : 1}>
            <text
              x={t.centroid[0]}
              y={t.centroid[1] - map.radius * 0.034}
              className="map-name"
              fontSize={nameFont}
              textAnchor="middle"
            >
              {t.name}
            </text>
            <text
              x={t.centroid[0]}
              y={t.centroid[1] + map.radius * 0.014}
              className="map-label"
              fontSize={armyFont}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {capitals.has(t.id) ? '★' : ''}
              {armies === HIDDEN_ARMIES ? '?' : armies}
              {ports.has(t.id) ? '⚓' : ''}
            </text>
          </g>
        );
      })}

      {anchors.map((a) => {
        const region = map.regions[a.id];
        return (
          <text
            key={`r${a.id}`}
            x={a.x}
            y={a.y - map.radius * 0.075}
            className="map-region-label"
            fontSize={regionFont}
            textAnchor="middle"
            pointerEvents="none"
          >
            {region.name.replace(/^The /, '')} +{region.bonus}
          </text>
        );
      })}
    </svg>
  );
}
