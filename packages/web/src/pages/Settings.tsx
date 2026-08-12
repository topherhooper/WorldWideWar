import { useEffect, useState } from 'react';
import type { NotifyKind, NotifyPrefs } from '@www/server/api-types';

import { api } from '../api.js';

// Named for what the player sees, not for the field: "reminder" alone says nothing.
const ROWS: [kind: NotifyKind, label: string, hint: string][] = [
  ['turnResolved', 'A turn resolves', 'What happened, and who moved against you.'],
  ['gameOver', 'A game ends', 'The final result, however it was won.'],
  ['reminder', 'A deadline is close', 'Only when your orders are not locked in.'],
];

export function Settings() {
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    api
      .getPrefs()
      .then(setPrefs)
      .catch(() => setLoadError(true));
  }, []);

  const toggle = async (kind: NotifyKind, next: boolean) => {
    const previous = prefs;
    setSaveError(false);
    setPrefs((p) => (p === null ? p : { ...p, [kind]: next }));
    try {
      setPrefs(await api.updatePrefs({ [kind]: next }));
    } catch {
      // Snap back: a checkbox that stays flipped claims a save that never happened.
      setPrefs(previous);
      setSaveError(true);
    }
  };

  return (
    <main>
      <section className="panel">
        <h2>Email notifications</h2>
        {loadError ? (
          <p className="error">Could not load your notification settings. Try reloading.</p>
        ) : prefs === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {saveError && <p className="error">Could not save that change. Try again.</p>}
            <ul className="pref-list">
              {ROWS.map(([kind, label, hint]) => (
                <li key={kind}>
                  <label>
                    <input
                      type="checkbox"
                      checked={prefs[kind]}
                      onChange={(e) => void toggle(kind, e.target.checked)}
                    />{' '}
                    {label}
                  </label>
                  <p className="muted">{hint}</p>
                </li>
              ))}
            </ul>
            <p className="muted">
              Turning everything off here is the same as using the unsubscribe link in any email.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
