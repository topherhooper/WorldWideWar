import { territoryCount } from '@www/engine';
import type { GameState } from '@www/engine';
import type { GameView } from '@www/server/api-types';

import { playerColor } from '../format.js';

/** Who is who, at a glance. What the world is doing lives in ForecastBox. */
export function GameHud({ view, state }: { view: GameView; state: GameState }) {
  return (
    <div className="hud">
      <ul className="legend">
        {view.seats.map((seat) => {
          const alive = state.status[seat.slot] === 'active';
          const me = seat.slot === view.mySlot;
          const locked = view.lockedSlots.includes(seat.slot);
          return (
            <li key={seat.slot} className={me ? 'legend-item legend-me' : 'legend-item'}>
              <span className="seat-dot" style={{ background: playerColor(seat.slot) }} />
              <span className={alive ? '' : 'legend-dead'}>
                {seat.name}
                {me ? ' — you' : ''}
              </span>
              {alive && (
                <span className="muted legend-stats">
                  {territoryCount(state, seat.slot)} lands · +{state.income[seat.slot]}
                </span>
              )}
              {view.status === 'active' && alive && !seat.isBot && (
                <span
                  className={locked ? 'lock-badge lock-badge-in' : 'lock-badge'}
                  title={locked ? 'Orders locked in' : 'Still deciding'}
                >
                  {locked ? '✓ locked' : 'deciding…'}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
