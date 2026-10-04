import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';

import { auth } from '../auth.js';
import type { BusySpan } from './grid.js';

const FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';

/**
 * The signed-in person's busy spans on their primary Google Calendar between two instants.
 * Read in the browser with a short-lived token from a fresh consent, so the server never
 * holds a Google credential (docs/design/calendar-availability.md, D3). Event titles are
 * never requested: free/busy carries only start and end.
 */
export async function readBusy(timeMin: number, timeMax: number): Promise<BusySpan[]> {
  const user = auth.currentUser;
  if (user === null) throw new Error('Sign in first.');
  const provider = new GoogleAuthProvider();
  provider.addScope(FREEBUSY_SCOPE);
  const result = await reauthenticateWithPopup(user, provider);
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new Error('Google did not hand back calendar access.');
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: new Date(timeMin).toISOString(),
      timeMax: new Date(timeMax).toISOString(),
      items: [{ id: 'primary' }],
    }),
  });
  if (!res.ok) throw new Error(`Google Calendar answered ${res.status}.`);
  const json = (await res.json()) as {
    calendars?: { primary?: { busy?: BusySpan[]; errors?: unknown[] } };
  };
  const primary = json.calendars?.primary;
  if (primary?.errors?.length) throw new Error('Google Calendar could not read your calendar.');
  return primary?.busy ?? [];
}
