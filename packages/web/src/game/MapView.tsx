import { useMemo } from 'react';
import { HIDDEN_ARMIES } from '@www/engine';
import type { GameState, GeneratedMap, TerritoryId } from '@www/engine';

import { playerColor } from '../format.js';

interface Props {
  map: GeneratedMap;
  state: GameState;
  mySlot: number | null;
  selected: TerritoryId | null;
  mode: 'deploy' | 'move';
  onTerritoryClick: (id: TerritoryId) => void;
}

const NEUTRAL = '#8a8578';
const COLLAPSED = '#2b2b33';

/**
 * Polygon segments where two different regions meet. Voronoi neighbours share
 * their vertices exactly (both rounded from the same points), so matching
 * segment endpoints is reliable.
 */
function regionBorders(map: GeneratedMap): [number, number, number, number][] {
  const firstOwner = new Map<string, number>();
  const out: [number, number, number, number][] = [];
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
      } else if (map.territories[other].regionId !== t.regionId) {
        out.push([ax, ay, bx, by]);
      }
    }
  }
  return out;
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

export function MapView({ map, state, mySlot, selected, mode, onTerritoryClick }: Props) {
  const r = map.radius * 1.04;
  const armyFont = map.radius * 0.05;
  const nameFont = map.radius * 0.026;
  const regionFont = map.radius * 0.03;
  const targets = selected === null ? new Set<number>() : new Set(map.adjacency[selected]);
  const capitals = new Set(state.capital.filter((c): c is TerritoryId => c !== null));
  const borders = useMemo(() => regionBorders(map), [map]);
  const anchors = useMemo(() => regionAnchors(map), [map]);
  const seaLanes = useMemo(() => map.edges.filter((e) => e.kind === 'sea'), [map]);
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
      {map.territories.map((t) => {
        const owner = state.owner[t.id];
        const collapsed = state.collapsed[t.id];
        const fill = collapsed ? COLLAPSED : owner === null ? NEUTRAL : playerColor(owner);
        const isSelected = selected === t.id;
        const isTarget = targets.has(t.id) && !collapsed;
        const isSource = pickingSource && owner === mySlot && !collapsed && state.armies[t.id] > 0;
        return (
          <polygon
            key={t.id}
            points={t.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
            fill={fill}
            fillOpacity={collapsed ? 0.9 : isTarget ? 0.92 : owner === mySlot ? 0.95 : 0.72}
            stroke={isSelected || isTarget ? '#ffffff' : isSource ? '#e6c84d' : '#14141c'}
            strokeWidth={isSelected ? 5 : isTarget ? 3.5 : isSource ? 2.5 : 1}
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

      {/* Region seams: a dark base with a light core, so they stay visible over
          both bright ownership fills and the muted neutral tone. */}
      {borders.map(([ax, ay, bx, by], i) => (
        <g key={`b${i}`} pointerEvents="none">
          <line
            x1={ax}
            y1={ay}
            x2={bx}
            y2={by}
            stroke="#0b0b12"
            strokeWidth={8}
            strokeLinecap="round"
          />
          <line
            x1={ax}
            y1={ay}
            x2={bx}
            y2={by}
            stroke="#e8e6df"
            strokeOpacity={0.4}
            strokeWidth={2}
            strokeLinecap="round"
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

      {map.territories.map((t) => {
        if (state.collapsed[t.id]) return null;
        const armies = state.armies[t.id];
        return (
          <g key={`l${t.id}`} pointerEvents="none">
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
