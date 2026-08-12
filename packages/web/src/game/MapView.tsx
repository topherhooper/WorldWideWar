import { HIDDEN_ARMIES } from '@www/engine';
import type { GameState, GeneratedMap, TerritoryId } from '@www/engine';

import { playerColor } from '../format.js';

interface Props {
  map: GeneratedMap;
  state: GameState;
  mySlot: number | null;
  selected: TerritoryId | null;
  onTerritoryClick: (id: TerritoryId) => void;
}

const NEUTRAL = '#8a8578';
const COLLAPSED = '#2b2b33';

export function MapView({ map, state, mySlot, selected, onTerritoryClick }: Props) {
  const r = map.radius * 1.04;
  const targets = selected === null ? new Set<number>() : new Set(map.adjacency[selected]);
  const capitals = new Set(state.capital.filter((c): c is TerritoryId => c !== null));

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
        return (
          <g key={t.id}>
            <polygon
              points={t.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
              fill={fill}
              fillOpacity={collapsed ? 0.9 : owner === mySlot ? 0.95 : 0.72}
              stroke={isSelected ? '#ffffff' : isTarget ? '#ffffff' : '#14141c'}
              strokeWidth={isSelected ? 3 : isTarget ? 1.6 : 0.8}
              strokeDasharray={isTarget && !isSelected ? '4 3' : undefined}
              onClick={() => {
                if (!collapsed) onTerritoryClick(t.id);
              }}
              style={{ cursor: collapsed ? 'default' : 'pointer' }}
            >
              <title>{t.name}</title>
            </polygon>
            {!collapsed && (
              <text
                x={t.centroid[0]}
                y={t.centroid[1]}
                className="map-label"
                textAnchor="middle"
                dominantBaseline="central"
                pointerEvents="none"
              >
                {capitals.has(t.id) ? '★' : ''}
                {state.armies[t.id] === HIDDEN_ARMIES ? '?' : state.armies[t.id]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
