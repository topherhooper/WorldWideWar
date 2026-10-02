import { useState } from 'react';
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';

import { auth } from '../auth.js';

const HOURS = [18, 19, 20, 21, 22];

interface Busy {
  start: string;
  end: string;
}

// Prototype: throwaway probe for a browser-only Calendar free/busy read.
export function CalendarProbe() {
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy[] | null>(null);

  async function go() {
    setError(null);
    setRaw(null);
    setBusy(null);
    try {
      const user = auth.currentUser;
      if (user === null) throw new Error('not signed in');
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/calendar.freebusy');
      const result = await reauthenticateWithPopup(user, provider);
      const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
      if (!token) throw new Error('no access token in credential');
      const timeMin = new Date();
      timeMin.setHours(0, 0, 0, 0);
      const timeMax = new Date(timeMin.getTime() + 14 * 86400000);
      const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          items: [{ id: 'primary' }],
        }),
      });
      const text = await res.text();
      setRaw(text);
      if (!res.ok) throw new Error(`freeBusy HTTP ${res.status}: ${text}`);
      const json = JSON.parse(text) as { calendars?: { primary?: { busy?: Busy[] } } };
      setBusy(json.calendars?.primary?.busy ?? []);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      setError(`${e.code ?? ''} ${e.message ?? String(err)}`.trim());
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  function isBusy(day: Date, hour: number): boolean {
    const s = new Date(day);
    s.setHours(hour, 0, 0, 0);
    const e = new Date(day);
    e.setHours(hour + 1, 0, 0, 0);
    return (busy ?? []).some(
      (b) => new Date(b.start).getTime() < e.getTime() && new Date(b.end).getTime() > s.getTime(),
    );
  }

  return (
    <main>
      <section className="panel">
        <h2>Calendar probe</h2>
        <button onClick={() => void go()}>Use my calendar</button>
        {error !== null && <p className="error">{error}</p>}
        {busy !== null && (
          <table>
            <thead>
              <tr>
                <th>Day</th>
                {HOURS.map((h) => (
                  <th key={h}>{h}:00</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.toISOString()}>
                  <td>
                    {d.toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </td>
                  {HOURS.map((h) => {
                    const b = isBusy(d, h);
                    return (
                      <td key={h} style={{ background: b ? '#7a1f1f' : '#1f6b2e', color: '#fff' }}>
                        {b ? 'busy' : 'free'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {raw !== null && <pre>{raw}</pre>}
      </section>
    </main>
  );
}
