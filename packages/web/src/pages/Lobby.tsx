import { useState } from 'react';
import type { GameView } from '@www/server/api-types';

import { api, ApiError } from '../api.js';
import { playerColor } from '../format.js';

interface Props {
  view: GameView;
  onChanged: () => Promise<unknown>;
}

export function Lobby({ view, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  };

  const openSeats = view.seats.filter((s) => !s.taken).length;

  return (
    <main className="panel">
      <h2>
        Lobby — {view.playerCount - openSeats}/{view.playerCount} seated
      </h2>
      <ul className="seat-list">
        {view.seats.map((seat) => (
          <li key={seat.slot} className="seat">
            <span className="seat-dot" style={{ background: playerColor(seat.slot) }} />
            {seat.taken ? (
              <span>
                {seat.name}
                {seat.isBot ? ' (bot)' : ''}
                {seat.slot === view.mySlot ? ' — you' : ''}
              </span>
            ) : (
              <span className="muted">open seat</span>
            )}
          </li>
        ))}
      </ul>

      <p className="muted">Invite friends by sharing this page&rsquo;s URL.</p>
      {error !== null && <p className="error">{error}</p>}

      <div className="form-row">
        {view.mySlot === null && openSeats > 0 && (
          <button disabled={busy} onClick={() => void run(() => api.join(view.id))}>
            Take a seat
          </button>
        )}
        {view.mySlot === 0 && openSeats > 0 && (
          <button disabled={busy} onClick={() => void run(() => api.start(view.id))}>
            Start now — fill empty seats with bots
          </button>
        )}
      </div>
    </main>
  );
}
