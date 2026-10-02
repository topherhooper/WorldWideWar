import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { PollAnswer, PollView } from '@www/server/api-types';

import { api, ApiError } from '../api.js';
import { formatRemaining } from '../format.js';
import { useNow } from '../useNow.js';
import { offeredByDay } from './grid.js';
import { formatRange } from './times.js';

const REFRESH_MS = 30_000;

export function PollPage({ initial }: { initial: PollView }) {
  const navigate = useNavigate();
  const now = useNow();
  const [view, setView] = useState(initial);
  const mine = view.members.find((m) => m.uid === view.me);
  const open = view.status === 'open';
  const isOrganizer = view.organizerUid === view.me;

  // Editing starts on for someone who has not answered; a confirmed answer shows "You're in".
  const [editing, setEditing] = useState(mine?.answeredAt === null && open);
  const [draft, setDraft] = useState<Record<string, PollAnswer | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  // No realtime listeners in v1: re-fetch every 30 seconds while the tab is visible.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      api
        .getPoll(view.id)
        .then(setView)
        .catch(() => undefined);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [view.id]);

  const allSet = view.candidates.every((c) => draft[c.id] !== undefined);

  const startEditing = () => {
    setDraft({ ...(mine?.answers ?? {}) });
    setEditing(true);
  };

  const confirm = async () => {
    if (!allSet) return;
    setBusy(true);
    setError(null);
    try {
      const answers = Object.fromEntries(
        view.candidates.map((c) => [c.id, draft[c.id] as PollAnswer]),
      );
      setView(await api.answerPoll(view.id, { answers }));
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your answer.');
    }
    setBusy(false);
  };

  const share = async () => {
    const url = `${window.location.origin}/p/${view.id}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: view.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareNote('Link copied');
    } catch {
      // A dismissed share sheet rejects; nothing went wrong.
    }
  };

  const lock = async (candidateId: string) => {
    if (!window.confirm('Lock this time? Nobody can change their answer after.')) return;
    setError(null);
    try {
      setView(await api.lockPoll(view.id, { candidateId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not lock that time.');
    }
  };

  const cancel = async () => {
    if (!window.confirm('Cancel this poll? The link will say it was cancelled.')) return;
    try {
      await api.cancelPoll(view.id);
      await navigate('/p');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel the poll.');
    }
  };

  const nameOf = (uid: string): string => view.members.find((m) => m.uid === uid)?.name ?? '';
  const answeredMembers = view.members.filter((m) => m.answeredAt !== null);
  const waiting = view.members.filter((m) => m.answeredAt === null);

  // Grid polls (calendar-availability.md) offer hours instead of candidate spans. Members
  // marking their own hours on the grid comes next; until then the page shows what is offered.
  const gridPoll = view.window !== null;
  const hourFmt: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

  return (
    <main>
      <section className="panel">
        <h2>{view.title}</h2>
        <p className="muted">
          asked by {view.organizerName} ·{' '}
          {view.status === 'open' ? 'open' : view.status === 'locked' ? 'locked' : 'cancelled'}
          {open && view.deadlineAt !== null && (
            <> · answer within {formatRemaining(view.deadlineAt, now)}</>
          )}
        </p>
        <button onClick={() => void share()}>Share</button>
        {shareNote !== null && <span className="muted"> {shareNote}</span>}
      </section>

      {gridPoll && (
        <section className="panel">
          <h3>Hours on offer</h3>
          {offeredByDay(view.offered).map((day) => (
            <p key={day.date}>
              <strong>
                {new Date(`${day.date}T12:00`).toLocaleDateString(undefined, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </strong>{' '}
              {day.spans
                .map(
                  ([s, e]) =>
                    `${new Date(s).toLocaleTimeString(undefined, hourFmt)}–${new Date(e).toLocaleTimeString(undefined, hourFmt)}`,
                )
                .join(', ')}
            </p>
          ))}
          <p className="muted">Marking your own hours on this grid is coming next.</p>
        </section>
      )}

      {open && !gridPoll && (
        <section className="panel">
          <h3>Your answer</h3>
          {editing ? (
            <>
              {view.candidates.map((c) => (
                <div className="form-row poll-row" key={c.id}>
                  <span>{formatRange(c.startsAt, c.endsAt)}</span>
                  <span className="seg" role="group" aria-label={formatRange(c.startsAt, c.endsAt)}>
                    {(['yes', 'no'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={draft[c.id] === value}
                        className={draft[c.id] === value ? `is-on is-${value}` : ''}
                        onClick={() => setDraft((d) => ({ ...d, [c.id]: value }))}
                      >
                        {value === 'yes' ? 'Yes' : 'No'}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
              <button disabled={!allSet || busy} onClick={() => void confirm()}>
                Confirm
              </button>
            </>
          ) : (
            <p>
              You&rsquo;re in.{' '}
              <button type="button" className="link" onClick={startEditing}>
                Change answer
              </button>
            </p>
          )}
          {error !== null && <p className="error">{error}</p>}
        </section>
      )}

      {!gridPoll && (
        <section className="panel">
          <h3>Results</h3>
          {view.candidates.map((c) => {
            const yes = answeredMembers.filter((m) => m.answers[c.id] === 'yes');
            const no = answeredMembers.filter((m) => m.answers[c.id] === 'no');
            const locked = view.lockedCandidateId === c.id;
            return (
              <div className={`poll-result${locked ? ' is-locked' : ''}`} key={c.id}>
                <div className="form-row">
                  <strong>{formatRange(c.startsAt, c.endsAt)}</strong>
                  {locked && <span className="badge-due">Locked</span>}
                  {open && isOrganizer && (
                    <button type="button" onClick={() => void lock(c.id)}>
                      Lock this time
                    </button>
                  )}
                </div>
                <p>
                  <strong>{yes.length} yes</strong>
                  {yes.length > 0 && <>: {yes.map((m) => nameOf(m.uid)).join(', ')}</>}
                </p>
                {no.length > 0 && (
                  <p className="muted">No: {no.map((m) => nameOf(m.uid)).join(', ')}</p>
                )}
              </div>
            );
          })}
        </section>
      )}

      {waiting.length > 0 && !gridPoll && view.status !== 'cancelled' && (
        <section className="panel">
          <h3>Waiting on</h3>
          <p>{waiting.map((m) => m.name).join(', ')}</p>
        </section>
      )}

      {open && isOrganizer && (
        <p>
          <button type="button" className="link" onClick={() => void cancel()}>
            Cancel poll
          </button>
        </p>
      )}
      <p>
        <Link to="/p">All polls</Link>
      </p>
    </main>
  );
}
