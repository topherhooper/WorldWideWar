import { describeEvent, territoryCount } from '@www/engine';
import type { GameState } from '@www/engine';
import type { GameView } from '@www/server/api-types';

import { playerColor } from '../format.js';

/** Who is who, at a glance — and what the world is doing to everyone. */
export function GameHud({ view, state }: { view: GameView; state: GameState }) {
  const active = describeEvent(state.activeEvent);
  const pending = describeEvent(state.pendingEvent);

  return (
    <div className="hud">
      <ul className="legend">
        {view.seats.map((seat) => {
          const alive = state.status[seat.slot] === 'active';
          const me = seat.slot === view.mySlot;
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
            </li>
          );
        })}
      </ul>
      {active !== null && (
        <p className="event-banner">
          <strong>This turn:</strong> {active}
        </p>
      )}
      {pending !== null && (
        <p className="event-banner event-coming">
          <strong>Next turn:</strong> {pending}
        </p>
      )}
    </div>
  );
}
