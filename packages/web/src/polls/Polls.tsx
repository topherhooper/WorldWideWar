import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { PollSummaryView } from '@www/server/api-types';

import { api, ApiError } from '../api.js';

export function Polls() {
  const [rows, setRows] = useState<PollSummaryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listPolls()
      .then(setRows)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'failed to load polls'),
      );
  }, []);

  return (
    <main>
      <section className="panel">
        <div className="form-row">
          <h2>Polls</h2>
          <Link to="/p/new">
            <button>New poll</button>
          </Link>
        </div>
        <p>
          <Link to="/p/calendar">Calendar probe</Link>
        </p>
        {error !== null && <p className="error">{error}</p>}
        {rows === null && error === null && <p className="muted">Loading…</p>}
        {rows !== null && rows.length === 0 && (
          <p className="muted">No polls yet. Start one and send the link to the group chat.</p>
        )}
        {rows !== null && rows.length > 0 && (
          <ul className="game-list">
            {rows.map((p) => (
              <li key={p.id}>
                <Link to={`/p/${p.id}`} className="game-card">
                  <span className="game-card-status">{p.title}</span>
                  <span className="muted">
                    {p.answeredCount} of {p.memberCount} answered
                  </span>
                  {p.status === 'open' && !p.iAnswered && (
                    <span className="badge-due">Your turn</span>
                  )}
                  {p.status === 'locked' && p.lockedStartsAt !== null && (
                    <span className="muted">
                      Locked:{' '}
                      {new Date(p.lockedStartsAt).toLocaleString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                  {p.status === 'cancelled' && <span className="muted">Cancelled</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
