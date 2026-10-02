import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { PastMemberView } from '@www/server/api-types';

import { api, ApiError } from '../api.js';
import { readBusy } from './calendar.js';
import { freeCells, gridDays, HOUR_MS, localDate, MAX_DAYS, type GridSpec } from './grid.js';
import { HourGrid } from './HourGrid.js';

const HOURS = Array.from({ length: 25 }, (_, h) => h);

export function NewPoll() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [spec, setSpec] = useState<GridSpec>(() => ({
    firstDay: localDate(new Date()),
    days: 14,
    fromHour: 18,
    toHour: 23,
  }));
  const [now] = useState(() => Date.now());
  const days = useMemo(() => gridDays(spec), [spec]);
  const future = useMemo(
    () => days.flatMap((d) => d.cells.map((c) => c.ms)).filter((ms) => ms > now),
    [days, now],
  );
  // Every hour starts offered; the calendar, or a tap, takes hours away.
  const [offered, setOffered] = useState<Set<number>>(() => new Set(future));
  useEffect(() => setOffered(new Set(future)), [future]);
  const [calendarNote, setCalendarNote] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [past, setPast] = useState<PastMemberView[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .pastMembers()
      .then(setPast)
      .catch(() => undefined); // the list is a convenience; the form works without it
  }, []);

  const patchSpec = (patch: Partial<GridSpec>) => {
    setCalendarNote(null);
    setSpec((s) => {
      const next = { ...s, ...patch };
      if (next.toHour <= next.fromHour) next.toHour = Math.min(24, next.fromHour + 1);
      return next;
    });
  };

  const toggle = (ms: number) =>
    setOffered((s) => {
      const next = new Set(s);
      if (next.has(ms)) next.delete(ms);
      else next.add(ms);
      return next;
    });

  const fillFromCalendar = async () => {
    if (future.length === 0) return;
    setError(null);
    setReading(true);
    try {
      const busySpans = await readBusy(future[0], future[future.length - 1] + HOUR_MS);
      const free = freeCells(future, busySpans);
      setOffered(free);
      setCalendarNote(
        `Filled from your calendar: ${future.length - free.size} busy ${
          future.length - free.size === 1 ? 'hour' : 'hours'
        } left off. Tap any hour to change it.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read your calendar.');
    } finally {
      setReading(false);
    }
  };

  const submit = async () => {
    const name = title.trim();
    if (name.length < 1 || name.length > 80) {
      setError('Give the poll a title (up to 80 characters).');
      return;
    }
    const hours = future.filter((ms) => offered.has(ms));
    if (hours.length === 0) {
      setError('Leave at least one hour free on the grid.');
      return;
    }
    let deadlineAt: string | null = null;
    if (deadline !== '') {
      const d = new Date(deadline);
      if (Number.isNaN(d.getTime())) return setError('That deadline is not a real time.');
      if (d.getTime() <= Date.now()) return setError('The deadline has to be in the future.');
      if (d.getTime() >= hours[hours.length - 1]) {
        return setError('The deadline has to come before the last hour on offer.');
      }
      deadlineAt = d.toISOString();
    }
    setError(null);
    setBusy(true);
    try {
      const { id } = await api.createPoll({
        title: name,
        window: { ...spec, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        offered: hours.map((ms) => new Date(ms).toISOString()),
        deadlineAt,
        ...(added.size > 0 ? { addUids: [...added] } : {}),
      });
      await navigate(`/p/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the poll.');
      setBusy(false);
    }
  };

  return (
    <main>
      <section className="panel">
        <h2>New poll</h2>
        <label className="poll-field">
          What is it for?
          <input
            type="text"
            value={title}
            maxLength={80}
            placeholder="Board games at mine"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <h3>When could it work?</h3>
        <div className="form-row poll-window">
          <label>
            From
            <input
              type="date"
              value={spec.firstDay}
              onChange={(e) => e.target.value !== '' && patchSpec({ firstDay: e.target.value })}
            />
          </label>
          <label>
            for
            <select value={spec.days} onChange={(e) => patchSpec({ days: Number(e.target.value) })}>
              {[7, 14, 21, 28, MAX_DAYS].map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </select>
          </label>
          <label>
            between
            <select
              value={spec.fromHour}
              onChange={(e) => patchSpec({ fromHour: Number(e.target.value) })}
            >
              {HOURS.slice(0, 24).map((h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
            </select>
          </label>
          <label>
            and
            <select
              value={spec.toHour}
              onChange={(e) => patchSpec({ toHour: Number(e.target.value) })}
            >
              {HOURS.slice(spec.fromHour + 1).map((h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
            </select>
          </label>
        </div>
        <p>
          <button type="button" disabled={reading} onClick={() => void fillFromCalendar()}>
            {reading ? 'Reading your calendar…' : 'Use my calendar'}
          </button>
        </p>
        <p className="muted">
          {calendarNote ??
            'Shaded hours are on offer. Use your calendar to clear the busy ones, or tap hours to change them.'}
        </p>
        <HourGrid days={days} on={offered} now={now} onToggle={toggle} />

        <label className="poll-field">
          Answer by (optional)
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>

        {past.length > 0 && (
          <fieldset className="poll-field">
            <legend>Add people from past polls</legend>
            {past.map((p) => (
              <label key={p.uid} className="poll-check">
                <input
                  type="checkbox"
                  checked={added.has(p.uid)}
                  onChange={(e) =>
                    setAdded((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(p.uid);
                      else next.delete(p.uid);
                      return next;
                    })
                  }
                />{' '}
                {p.name}
              </label>
            ))}
          </fieldset>
        )}

        {error !== null && <p className="error">{error}</p>}
        <button disabled={busy} onClick={() => void submit()}>
          Create poll
        </button>
      </section>
    </main>
  );
}
