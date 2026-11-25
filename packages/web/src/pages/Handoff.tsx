import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

import { useAuth } from '../auth.js';
import { safeReturnUrl, shareSession } from '../session.js';

/**
 * `/signin?return=<url>`: the front page's "Sign in" button lands here. RequireAuth above it
 * shows the usual Google sign-in; once signed in, this sets the shared cookie and sends the
 * browser back to where it came from, now signed in there too.
 */
export function SignInHandoff() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const back = safeReturnUrl(params.get('return'));
  useEffect(() => {
    if (user === null || user === undefined) return;
    void shareSession(user).then(() => window.location.replace(back ?? '/'));
  }, [user, back]);
  return <div className="center-card">Signing you in…</div>;
}

/** `/signout?return=<url>`: signs out of every topherhooper.com site, then goes back. */
export function SignOutHandoff() {
  const { user, signOut } = useAuth();
  const [params] = useSearchParams();
  const back = safeReturnUrl(params.get('return'));
  const started = useRef(false);
  useEffect(() => {
    if (user === undefined || started.current) return;
    started.current = true;
    void signOut()
      .catch(() => undefined)
      .then(() => window.location.replace(back ?? '/'));
  }, [user, signOut, back]);
  return <div className="center-card">Signing you out…</div>;
}
