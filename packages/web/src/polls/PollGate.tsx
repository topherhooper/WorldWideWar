import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { PollPreview, PollView } from '@www/server/api-types';

import { api, ApiError } from '../api.js';
import { SignInCard, useAuth, useSignInError } from '../auth.js';
import { PollPage } from './PollPage.js';

const GONE = "This poll was cancelled or doesn't exist.";

/**
 * The one page a signed-out friend can reach. Signed out, it shows what they are signing in
 * for (Q5): the title and who asked. Signed in, it joins them and shows the poll.
 */
export function PollGate() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { error, start } = useSignInError();
  const [preview, setPreview] = useState<PollPreview | 'gone' | 'unknown' | null>(null);
  const [view, setView] = useState<PollView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const uid = user?.uid ?? null;
  const signedOut = user === null;

  useEffect(() => {
    if (!signedOut) return;
    let live = true;
    // A plain fetch: apiFetch throws when nobody is signed in, and this route is public.
    fetch(`/api/polls/${encodeURIComponent(id)}/preview`)
      .then(async (res) => {
        if (res.status === 404) return 'gone' as const;
        if (!res.ok) return 'unknown' as const;
        return (await res.json()) as PollPreview;
      })
      .catch(() => 'unknown' as const)
      .then((result) => live && setPreview(result));
    return () => {
      live = false;
    };
  }, [signedOut, id]);

  useEffect(() => {
    if (uid === null) return;
    let live = true;
    api
      .joinPoll(id)
      .then((v) => live && setView(v))
      .catch((err: unknown) => {
        if (!live) return;
        const gone = err instanceof ApiError && (err.status === 404 || err.status === 409);
        setFailure(
          gone ? GONE : err instanceof ApiError ? err.message : 'Could not open this poll.',
        );
      });
    return () => {
      live = false;
    };
  }, [uid, id]);

  if (user === undefined) return <div className="center-card">Loading…</div>;

  if (user === null) {
    if (preview === null) return <div className="center-card">Loading…</div>;
    if (preview === 'gone') return <div className="center-card">{GONE}</div>;
    return (
      <SignInCard error={error} onSignIn={start}>
        <h1>Quorum</h1>
        {preview === 'unknown' ? (
          <p>Sign in to see this poll.</p>
        ) : (
          <p>
            <strong>{preview.organizerName}</strong> wants to find a time for{' '}
            <strong>{preview.title}</strong>
          </p>
        )}
      </SignInCard>
    );
  }

  if (failure !== null)
    return (
      <main>
        <p className="error">{failure}</p>
      </main>
    );
  if (view === null) return <div className="center-card">Loading…</div>;
  return <PollPage initial={view} />;
}
