import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { PastMemberView } from '@www/server/api-types';

import { api, ApiError } from '../api.js';
import { MAX_CANDIDATES, nextRow, validateNewPoll, type CandidateRow } from './times.js';

const emptyRow = (): CandidateRow => ({ date: '', start: '', end: '' });

export function NewPoll() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState<CandidateRow[]>([emptyRow(), emptyRow()]);
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

  const setRow = (i: number, patch: Partial<CandidateRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    const result = validateNewPoll({ title, rows, deadline });
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { id } = await api.createPoll({
        title: title.trim(),
        candidates: result.candidates,
        deadlineAt: result.deadlineAt,
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
        {rows.map((row, i) => (
          <div className="form-row poll-time-row" key={i}>
            <input
              type="date"
              aria-label={`Date ${i + 1}`}
              value={row.date}
              onChange={(e) => setRow(i, { date: e.target.value })}
            />
            <input
              type="time"
              aria-label={`Start ${i + 1}`}
              value={row.start}
              onChange={(e) => setRow(i, { start: e.target.value })}
            />
            <span className="muted">to</span>
            <input
              type="time"
              aria-label={`End ${i + 1}`}
              value={row.end}
              onChange={(e) => setRow(i, { end: e.target.value })}
            />
            {rows.length > 2 && (
              <button
                type="button"
                className="link"
                aria-label={`Remove time ${i + 1}`}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {rows.length < MAX_CANDIDATES && (
          <button type="button" onClick={() => setRows((rs) => [...rs, nextRow(rs)])}>
            Add a time
          </button>
        )}
        <p className="muted">
          An end time before the start means the next day, like 21:00 to 01:00.
        </p>

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
