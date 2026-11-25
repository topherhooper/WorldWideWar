import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

import { SignInCard, useAuth, useSignInError } from '../auth.js';
import { safeReturnUrl, shareSession } from '../session.js';

/**
 * `/signin?return=<url>`: where another topherhooper.com site sends a visitor whose browser
 * will not open its own Google pop-up. It sits outside the game's layout and names the
 * domain, not the game, because the visitor did not ask for World Wide War. Once signed in
 * it sets the shared cookie and sends the browser back, now signed in there too.
 */
export function SignInHandoff() {
  const { user } = useAuth();
  const { error, start } = useSignInError();
  const [params] = useSearchParams();
  const back = safeReturnUrl(params.get('return'));
  useEffect(() => {
    if (user === null || user === undefined) return;
    void shareSession(user).then(() => window.location.replace(back ?? '/'));
  }, [user, back]);
  if (user === null) {
    return (
      <SignInCard error={error} onSignIn={start}>
        <h1>topherhooper.com</h1>
        <p>One sign-in for the games and projects here.</p>
      </SignInCard>
    );
  }
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
