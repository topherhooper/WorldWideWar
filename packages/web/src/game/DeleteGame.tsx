import { useState } from 'react';
import { useNavigate } from 'react-router';

import { api, ApiError } from '../api.js';

/**
 * Creator-only game deletion with an inline two-step confirm.
 *
 * `label` exists because the same control ends a dinner party, and a host
 * looking for the way out of an evening that never started is not scanning for
 * the word "game" — the card they clicked said Bedtime Party.
 */
export function DeleteGame({ gameId, label = 'Delete game' }: { gameId: string; label?: string }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const destroy = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteGame(gameId);
      await navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'request failed');
      setBusy(false);
    }
  };

  if (!armed) {
    return (
      <button className="danger-btn" onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="delete-confirm">
      <button className="danger-btn" disabled={busy} onClick={() => void destroy()}>
        Really delete — for everyone, permanently
      </button>
      <button disabled={busy} onClick={() => setArmed(false)}>
        Keep it
      </button>
      {error !== null && <span className="error">{error}</span>}
    </span>
  );
}
