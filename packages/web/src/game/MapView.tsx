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

/** A region's label position: the average of its member centroids. */
function regionAnchors(map: GeneratedMap): { id: number; x: number; y: number }[] {
  return map.regions.map((region) => {
    let x = 0;
    let y = 0;
    for (const id of region.territoryIds) {
      x += map.territories[id].centroid[0];
      y += map.territories[id].centroid[1];
    }
    const n = Math.max(1, region.territoryIds.length);
    return { id: region.id, x: x / n, y: y / n };
  });
}

export function MapView({ map, state, mySlot, selected, mode, onTerritoryClick }: Props) {
  const r = map.radius * 1.04;
  const armyFont = map.radius * 0.052;
  const regionFont = map.radius * 0.034;
  const targets = selected === null ? new Set<number>() : new Set(map.adjacency[selected]);
  const capitals = new Set(state.capital.filter((c): c is TerritoryId => c !== null));
  const borders = useMemo(() => regionBorders(map), [map]);
  const anchors = useMemo(() => regionAnchors(map), [map]);
  const seaLanes = useMemo(() => map.edges.filter((e) => e.kind === 'sea'), [map]);
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

      {/* Region seams and names sit above fills but below army counts. */}
      {borders.map(([ax, ay, bx, by], i) => (
        <line
          key={`b${i}`}
          x1={ax}
          y1={ay}
          x2={bx}
          y2={by}
          stroke="#0b0b12"
          strokeWidth={5}
          strokeLinecap="round"
          pointerEvents="none"
        />
      ))}
      {seaLanes.map((e, i) => (
        <line
          key={`s${i}`}
          x1={map.territories[e.a].centroid[0]}
          y1={map.territories[e.a].centroid[1]}
          x2={map.territories[e.b].centroid[0]}
          y2={map.territories[e.b].centroid[1]}
          stroke="#66e0ff"
          strokeOpacity={0.55}
          strokeWidth={map.radius * 0.006}
          strokeDasharray="14 10"
          pointerEvents="none"
        >
          <title>sea lane — these territories are adjacent</title>
        </line>
      ))}
      {anchors.map((a) => (
        <text
          key={`r${a.id}`}
          x={a.x}
          y={a.y - map.radius * 0.055}
          className="map-region-label"
          fontSize={regionFont}
          textAnchor="middle"
          pointerEvents="none"
        >
          {map.regions[a.id].name} +{map.regions[a.id].bonus}
        </text>
      ))}

      {map.territories.map((t) => {
        if (state.collapsed[t.id]) return null;
        return (
          <text
            key={`a${t.id}`}
            x={t.centroid[0]}
            y={t.centroid[1]}
            className="map-label"
            fontSize={armyFont}
            textAnchor="middle"
            dominantBaseline="central"
            pointerEvents="none"
          >
            {capitals.has(t.id) ? '★' : ''}
            {state.armies[t.id] === HIDDEN_ARMIES ? '?' : state.armies[t.id]}
          </text>
        );
      })}
    </svg>
  );
}
