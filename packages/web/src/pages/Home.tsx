import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { CreateGameRequest, GameSummaryView } from '@www/server/api-types';
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

  const create = async (req: CreateGameRequest) => {
    setCreating(true);
    try {
      const { id } = await api.createGame(req);
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
              onClick={() => void create({ presetId: preset.id })}
            >
              <strong>{preset.name}</strong>
              <span>{preset.tagline}</span>
              <span className="muted">
                {preset.defaultTurnCap} turns · {formatTurnMinutes(preset.defaultTurnMinutes)}/turn
              </span>
            </button>
          ))}

          {/* Back in the grid after #31 took it out, and a button rather than
              the anchor of #30 — the party creates a game and lands on /g/:id
              like every other mode, so it needs no route and no CSS of its own. */}
          <button
            data-testid="dinner-party"
            className="preset-card"
            disabled={creating}
            onClick={() => void create({ kind: 'party', mode: 'traitor' })}
          >
            <strong>Dinner Party</strong>
            <span>Sleeping Beauty — one of the grown-ups here laid the curse.</span>
            <span className="muted">3&ndash;20 guests · one evening</span>
          </button>

          {/* Named as its own game, not as a diff against the card above it. The
              grid is scanned rather than read in order, so "the same tale" only
              means anything to somebody who happened to read Dinner Party first
              — and it left the one card aimed at a family never naming the
              story it tells. */}
          <button
            data-testid="bedtime-party"
            className="preset-card"
            disabled={creating}
            onClick={() => void create({ kind: 'party', mode: 'together' })}
          >
            <strong>Bedtime Party</strong>
            <span>Sleeping Beauty — nobody here laid the curse, so solve it together.</span>
            <span className="muted">from 2 people · about ten minutes</span>
          </button>
          {/* A card game rather than a war or a party, so it names what it is
              in the tagline: everyone at one table, at the same time. Nothing
              about the grid changes — one click, POST /api/games, land on
              /g/:id, same as the seven cards beside it. */}
          <button
            data-testid="sacre"
            className="preset-card"
            disabled={creating}
            onClick={() => void create({ kind: 'cards' })}
          >
            <strong>S.A.C.R.E. Bleu!</strong>
            <span>Score, Advertise, Cycle, Return or Exchange — build a run, win the table.</span>
            <span className="muted">2&ndash;7 players · 8 rounds · everyone at once</span>
          </button>
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
                      ? g.kind === 'party'
                        ? `Party — ${g.seatsFilled} coming`
                        : `Lobby ${g.seatsFilled}/${g.playerCount}`
                      : g.status === 'finished'
                        ? 'Finished'
                        : g.kind === 'party'
                          ? // A dealt-but-unrung party has no round yet: the
                            // invitation is out and the evening has not started.
                            g.turn === 0
                            ? 'Invitations sent'
                            : `Round ${g.turn}`
                          : g.kind === 'cards'
                            ? `Round ${g.turn} of 8`
                            : `Turn ${g.turn}`}
                  </span>
                  {g.status === 'active' && g.deadlineAt !== null && (
                    <span className="muted">{formatRemaining(g.deadlineAt, now)}</span>
                  )}
                  {g.status === 'active' &&
                    g.kind !== 'party' &&
                    g.kind !== 'cards' &&
                    !g.myLocked &&
                    g.mySlot !== null && <span className="badge-due">orders due</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
