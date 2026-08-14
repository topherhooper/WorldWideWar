import { buildApp } from './app.js';
import { realVerifiers } from './auth.js';
import { LogMailer, resendMailer } from './mailer.js';
import { initFirestore } from './store.js';
import { unsubSignerFromEnv } from './unsub.js';

// Cloud Run injects PORT; the local default dodges the Firestore emulator's 8080.
const port = Number(process.env.PORT ?? 3001);
const projectId = process.env.GCP_PROJECT ?? 'demo-www';
const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;

// Trimmed: secrets piped in from Windows shells arrive with BOMs and newlines,
// and a single stray byte in an Authorization header kills the process at boot.
const resendKey = process.env.RESEND_API_KEY?.trim();
const mailFrom = process.env.MAIL_FROM?.trim();
const mailer =
  resendKey !== undefined && resendKey !== '' && mailFrom !== undefined
    ? resendMailer(resendKey, mailFrom)
    : new LogMailer();

const app = buildApp({
  db: initFirestore(projectId),
  mailer,
  verifiers: realVerifiers({
    tickAudience: process.env.TICK_AUDIENCE ?? baseUrl,
    tickServiceAccount: process.env.TICK_SERVICE_ACCOUNT ?? '',
  }),
  baseUrl,
  signer: unsubSignerFromEnv(process.env.UNSUBSCRIBE_SECRET?.trim()),
});

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log(`[server] listening on :${port} (project ${projectId})`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
