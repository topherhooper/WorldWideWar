import { getMessaging } from 'firebase-admin/messaging';

export interface PushMessage {
  title: string;
  body: string;
  /** Absolute URL opened when the notification is tapped. */
  link: string;
}

export interface Pusher {
  /** Never throws. Returns the tokens FCM says are gone, so the caller can prune them. */
  send(tokens: string[], msg: PushMessage): Promise<{ deadTokens: string[] }>;
}

export class LogPusher implements Pusher {
  sent: { tokens: string[]; msg: PushMessage }[] = [];
  /** Tests set this to simulate FCM reporting tokens as unregistered. */
  dead = new Set<string>();

  async send(tokens: string[], msg: PushMessage): Promise<{ deadTokens: string[] }> {
    this.sent.push({ tokens, msg });
    console.log(`[push] tokens=${tokens.length} title=${msg.title}`);
    return { deadTokens: tokens.filter((t) => this.dead.has(t)) };
  }
}

const DEAD_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** Push failure must never fail the request or the tick that triggered it. */
export function fcmPusher(): Pusher {
  return {
    async send(tokens: string[], msg: PushMessage): Promise<{ deadTokens: string[] }> {
      if (tokens.length === 0) return { deadTokens: [] };
      try {
        // sendEachForMulticast takes at most 500 tokens; a user has a handful of devices.
        const res = await getMessaging().sendEachForMulticast({
          tokens: tokens.slice(0, 500),
          webpush: {
            notification: { title: msg.title, body: msg.body, icon: '/icon-192.png' },
            // Our own worker reads `data`; `fcmOptions` is only honoured by Firebase's.
            data: { link: msg.link },
            fcmOptions: { link: msg.link },
          },
        });
        const deadTokens: string[] = [];
        res.responses.forEach((r, i) => {
          if (r.success) return;
          const code = r.error?.code ?? '';
          if (DEAD_CODES.has(code)) deadTokens.push(tokens[i]);
          else console.error(`[push] fcm error ${code}: ${r.error?.message ?? ''}`);
        });
        return { deadTokens };
      } catch (err) {
        console.error('[push] fcm threw:', err);
        return { deadTokens: [] };
      }
    },
  };
}
