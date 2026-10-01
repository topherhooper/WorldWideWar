import { useEffect, useState } from 'react';
import type { NotifyKind, NotifyPrefs } from '@www/server/api-types';

import { api } from '../api.js';
import { InstallHelp } from '../InstallHelp.js';
import { disablePush, enablePush, pushStatus, type PushStatus } from '../push.js';

// Named for what the player sees, not for the field: "reminder" alone says nothing.
const ROWS: [kind: NotifyKind, label: string, hint: string][] = [
  ['turnResolved', 'A turn resolves', 'What happened, and who moved against you.'],
  ['gameOver', 'A game ends', 'The final result, however it was won.'],
  ['reminder', 'A deadline is close', 'Only when your orders are not locked in.'],
];

function PhoneNotifications() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    pushStatus()
      .then(setStatus)
      .catch(() => setStatus('unsupported'));
  }, []);

  const run = async (action: () => Promise<PushStatus>) => {
    setMessage(null);
    try {
      setStatus(await action());
    } catch {
      setMessage('Something went wrong. Try again.');
    }
  };

  const test = async () => {
    setMessage(null);
    try {
      await api.testPush();
      setMessage('Sent — it should arrive in a few seconds.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not send a test.');
    }
  };

  return (
    <section className="panel">
      <h2>Phone notifications</h2>
      {status === null ? (
        <p className="muted">Loading…</p>
      ) : status === 'unsupported' ? (
        <p>
          This browser can&rsquo;t receive notifications. On a phone, use Safari (iPhone) or Chrome
          (Android).
        </p>
      ) : status === 'needs-install' ? (
        <InstallHelp />
      ) : status === 'blocked' ? (
        <p>
          Notifications are blocked for this site. Turn them on in your phone&rsquo;s settings, then
          reload.
        </p>
      ) : status === 'off' ? (
        <button onClick={() => void run(enablePush)}>Turn on notifications on this device</button>
      ) : (
        <>
          <p>Notifications are on for this device</p>
          <button onClick={() => void test()}>Send a test</button>{' '}
          <button onClick={() => void run(disablePush)}>Turn off on this device</button>
        </>
      )}
      {message !== null && <p className="muted">{message}</p>}
    </section>
  );
}

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
      <PhoneNotifications />
      <section className="panel">
        <h2>What to notify me about</h2>
        <p className="muted">Each switch covers email and phone notifications.</p>
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
