import { useState } from 'react';

import { api, ApiError } from '../api.js';

/** Creator-only "end the turn now" with an inline two-step confirm. */
export function ResolveNow({ gameId, onResolved }: { gameId: string; onResolved: () => void }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.resolveNow(gameId);
      setArmed(false);
      onResolved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  };

  if (!armed) {
    return <button onClick={() => setArmed(true)}>Resolve turn now</button>;
  }
  return (
    <span className="delete-confirm">
      <button className="danger-btn" disabled={busy} onClick={() => void resolve()}>
        Really resolve — players still deciding fight with their saved drafts
      </button>
      <button disabled={busy} onClick={() => setArmed(false)}>
        Wait
      </button>
      {error !== null && <span className="error">{error}</span>}
    </span>
  );
}
