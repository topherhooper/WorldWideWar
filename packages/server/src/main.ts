import { buildApp } from './app.js';
import { realVerifiers } from './auth.js';
import { LogMailer, resendMailer } from './mailer.js';
import { initFirestore } from './store.js';

// Cloud Run injects PORT; the local default dodges the Firestore emulator's 8080.
const port = Number(process.env.PORT ?? 3001);
const projectId = process.env.GCP_PROJECT ?? 'demo-www';
const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;

const mailer =
  process.env.RESEND_API_KEY !== undefined && process.env.MAIL_FROM !== undefined
    ? resendMailer(process.env.RESEND_API_KEY, process.env.MAIL_FROM)
    : new LogMailer();

const app = buildApp({
  db: initFirestore(projectId),
  mailer,
  verifiers: realVerifiers({
    tickAudience: process.env.TICK_AUDIENCE ?? baseUrl,
    tickServiceAccount: process.env.TICK_SERVICE_ACCOUNT ?? '',
  }),
  baseUrl,
});

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log(`[server] listening on :${port} (project ${projectId})`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
