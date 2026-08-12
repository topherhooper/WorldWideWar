import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signs unsubscribe links so a player can turn off mail without signing in.
 * The signature covers only the uid — there is nothing else to bind, and an
 * unsubscribe that works forever is the behavior we want.
 */
export interface UnsubSigner {
  sign(uid: string): string;
  verify(uid: string, signature: string): boolean;
}

export function unsubSigner(secret: string): UnsubSigner {
  const sign = (uid: string): string =>
    createHmac('sha256', secret).update(uid).digest('base64url');

  return {
    sign,
    verify(uid, signature): boolean {
      const expected = Buffer.from(sign(uid));
      const given = Buffer.from(signature);
      // timingSafeEqual throws on a length mismatch, and length is not a secret.
      if (expected.length !== given.length) return false;
      return timingSafeEqual(expected, given);
    },
  };
}

const escape = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Standalone pages, not client routes: the web app lives behind RequireAuth,
 * and an unsubscribe link that demands a login is not an unsubscribe link.
 */
const shell = (body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Unsubscribe — World Wide War</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 4rem auto; max-width: 32rem; padding: 0 1rem; }
  button { font: inherit; padding: .5rem 1rem; cursor: pointer; }
</style></head>
<body><h1>World Wide War</h1>${body}</body></html>`;

/** Shown when a link is truncated or mangled in transit, which mail clients do. */
export function unsubscribeErrorPage(settingsUrl: string): string {
  return shell(
    `<p>This unsubscribe link is not valid. Email programs sometimes cut long
        links in half, so copying the whole address from the message may fix it.</p>
     <p>You can also <a href="${escape(settingsUrl)}">change your email settings</a>
        after signing in.</p>`,
  );
}

export function unsubscribePage(opts: {
  uid: string;
  signature: string;
  done: boolean;
  settingsUrl: string;
}): string {
  const body = opts.done
    ? `<p>You will no longer receive email from World Wide War.</p>
       <p>Changed your mind? <a href="${escape(opts.settingsUrl)}">Turn notifications back on</a>.</p>`
    : `<p>Stop receiving all email from World Wide War?</p>
       <form method="post">
         <input type="hidden" name="u" value="${escape(opts.uid)}" />
         <input type="hidden" name="s" value="${escape(opts.signature)}" />
         <button type="submit">Unsubscribe</button>
       </form>
       <p>Prefer to keep some? <a href="${escape(opts.settingsUrl)}">Choose which emails you get</a>.</p>`;

  return shell(body);
}

/**
 * Production reads UNSUBSCRIBE_SECRET from Secret Manager. Local dev gets a
 * per-process key instead of a crash: links work for the life of the server,
 * which is all a dev session needs. Mirrors main.ts falling back to LogMailer.
 */
export function unsubSignerFromEnv(secret: string | undefined): UnsubSigner {
  if (secret !== undefined && secret !== '') return unsubSigner(secret);
  console.warn('[unsub] UNSUBSCRIBE_SECRET unset — using an ephemeral per-process key');
  return unsubSigner(randomBytes(32).toString('hex'));
}
