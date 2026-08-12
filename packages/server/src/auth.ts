import { getAuth } from 'firebase-admin/auth';
import { OAuth2Client } from 'google-auth-library';

import { HttpError, type AuthedUser } from './games.js';

export interface Verifiers {
  /** Firebase ID token from a signed-in player. Throws HttpError(401). */
  verifyUser(authorizationHeader: string | undefined): Promise<AuthedUser>;
  /** Google-signed OIDC token from the Cloud Scheduler service account. */
  verifyTick(authorizationHeader: string | undefined): Promise<void>;
}

function bearer(header: string | undefined): string {
  if (header === undefined || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'missing bearer token');
  }
  return header.slice('Bearer '.length);
}

export function realVerifiers(opts: {
  tickAudience: string;
  tickServiceAccount: string;
}): Verifiers {
  const oauth = new OAuth2Client();
  return {
    async verifyUser(header): Promise<AuthedUser> {
      const token = bearer(header);
      try {
        const decoded = await getAuth().verifyIdToken(token);
        return {
          uid: decoded.uid,
          name: (decoded.name as string | undefined) ?? decoded.email ?? 'Player',
          email: decoded.email ?? null,
        };
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(401, 'invalid token');
      }
    },

    async verifyTick(header): Promise<void> {
      const token = bearer(header);
      try {
        const ticket = await oauth.verifyIdToken({ idToken: token, audience: opts.tickAudience });
        const payload = ticket.getPayload();
        if (payload?.email !== opts.tickServiceAccount || payload.email_verified !== true) {
          throw new HttpError(403, 'wrong service account');
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(401, 'invalid tick token');
      }
    },
  };
}
