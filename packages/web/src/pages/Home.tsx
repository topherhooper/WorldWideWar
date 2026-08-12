import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { GameSummaryView } from '@www/server/api-types';

import { api, ApiError } from '../api.js';
import { formatRemaining } from '../format.js';
import { useNow } from '../useNow.js';

const TURN_LENGTHS: [label: string, minutes: number][] = [
  ['30 minutes', 30],
  ['1 hour', 60],
  ['4 hours', 240],
  ['24 hours', 1440],
  ['48 hours', 2880],
];

const GAME_LENGTHS: [label: string, turns: number][] = [
  ['Short — 15 turns', 15],
  ['Standard — 25 turns', 25],
  ['Long — 35 turns', 35],
];

export function Home() {
  const [gamesList, setGamesList] = useState<GameSummaryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerCount, setPlayerCount] = useState(4);
  const [turnMinutes, setTurnMinutes] = useState(1440);
  const [contest, setContest] = useState<'pact' | 'tiers'>('pact');
  const [turnCap, setTurnCap] = useState(25);
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

  const create = async () => {
    setCreating(true);
    try {
      const { id } = await api.createGame({ playerCount, turnMinutes, contest, turnCap });
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
        <div className="form-row">
          <label>
            Players{' '}
            <select value={playerCount} onChange={(e) => setPlayerCount(Number(e.target.value))}>
              {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Turn length{' '}
            <select value={turnMinutes} onChange={(e) => setTurnMinutes(Number(e.target.value))}>
              {TURN_LENGTHS.map(([label, minutes]) => (
                <option key={minutes} value={minutes}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Contest{' '}
            <select
              value={contest}
              onChange={(e) => setContest(e.target.value as 'pact' | 'tiers')}
            >
              <option value="pact">Pact — pledge &amp; betray</option>
              <option value="tiers">Tiers — read your rivals</option>
            </select>
          </label>
          <label>
            Game length{' '}
            <select value={turnCap} onChange={(e) => setTurnCap(Number(e.target.value))}>
              {GAME_LENGTHS.map(([label, turns]) => (
                <option key={turns} value={turns}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button disabled={creating} onClick={() => void create()}>
            Create
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
