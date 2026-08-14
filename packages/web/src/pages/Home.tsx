import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { GameSummaryView } from '@www/server/api-types';
import { PRESETS } from '@www/engine';

import { api, ApiError } from '../api.js';
import { formatRemaining } from '../format.js';
import { useNow } from '../useNow.js';

const formatTurnMinutes = (minutes: number): string =>
  minutes % 1440 === 0 && minutes >= 1440
    ? `${minutes / 1440}d`
    : minutes % 60 === 0 && minutes >= 60
      ? `${minutes / 60}h`
      : `${minutes}m`;

export function Home() {
  const [gamesList, setGamesList] = useState<GameSummaryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const now = useNow();

  useEffect(() => {
    api
      .listGames()
      .then(setGamesList)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'failed to load games'),
      );
  }, []);

  const create = async (presetId: string) => {
    setCreating(true);
    try {
      const { id } = await api.createGame({ presetId });
      await navigate(`/g/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to create game');
      setCreating(false);
    }
  };

  return (
    <main>
      <section className="panel">
        <h2>New game</h2>
        <p className="muted">
          Pick a mode — players, turn length and game length are set in the lobby.
        </p>
        <div className="preset-grid">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              data-testid={`preset-${preset.id}`}
              className="preset-card"
              disabled={creating}
              onClick={() => void create(preset.id)}
            >
              <strong>{preset.name}</strong>
              <span>{preset.tagline}</span>
              <span className="muted">
                {preset.defaultTurnCap} turns · {formatTurnMinutes(preset.defaultTurnMinutes)}/turn
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Your games</h2>
        {error !== null && <p className="error">{error}</p>}
        {gamesList === null ? (
          <p className="muted">Loading…</p>
        ) : gamesList.length === 0 ? (
          <p className="muted">No games yet. Start one above.</p>
        ) : (
          <ul className="game-list">
            {gamesList.map((g) => (
              <li key={g.id}>
                <Link to={`/g/${g.id}`} className="game-card">
                  <span className="game-card-status">
                    {g.status === 'lobby'
                      ? `Lobby ${g.seatsFilled}/${g.playerCount}`
                      : g.status === 'finished'
                        ? 'Finished'
                        : `Turn ${g.turn}`}
                  </span>
                  {g.status === 'active' && g.deadlineAt !== null && (
                    <span className="muted">{formatRemaining(g.deadlineAt, now)}</span>
                  )}
                  {g.status === 'active' && !g.myLocked && g.mySlot !== null && (
                    <span className="badge-due">orders due</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
