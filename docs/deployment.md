# Deployment

Everything runs in GCP project **`fluted-citizen-269819`**, region **`us-central1`**.

| Thing          | Where                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| Site           | https://play.topherhooper.com (Firebase Hosting, CDN)                    |
| DNS            | Cloud DNS zone `topherhooper-com`; registrar Squarespace, NS delegated   |
| API            | Cloud Run service `www-api` — reached via the Hosting `/api/**` rewrite  |
| State          | Firestore `(default)`, native mode                                       |
| Images         | Artifact Registry `us-central1-docker.pkg.dev/fluted-citizen-269819/www` |
| Turn deadlines | Cloud Scheduler job `www-tick`, every minute → `POST /internal/tick`     |
| Email          | Resend from `noreply@mail.topherhooper.com`, key in `resend-api-key`     |
| Unsubscribe    | `/unsubscribe` rewrite → Cloud Run, HMAC key `unsubscribe-secret`        |
| Auth           | Firebase Auth, Google sign-in; web app `www-web`                         |

## Pipeline

Push to `main` fires the Cloud Build trigger (`Sample`, us-central1) → `cloudbuild.yaml`:
docker build/push → `gcloud run deploy www-api` → vite build → `firebase deploy --only hosting`.
The trigger runs as `cloudbuilder@fluted-citizen-269819.iam.gserviceaccount.com`
(roles: run.admin, artifactregistry.writer, firebasehosting.admin, logging.logWriter,
serviceAccountUser on the compute SA). CI checks stay in GitHub Actions and do not deploy.

Manual deploy of the working tree, no trigger needed:

```
gcloud builds submit --config cloudbuild.yaml --project fluted-citizen-269819 --substitutions COMMIT_SHA=manual-N .
```

## Secrets

Two secrets: the Resend API key, and the key that signs unsubscribe links.

```bash
# bash, not PowerShell — PS 5.1 piping prepends a UTF-16 BOM, which once shipped
# a poisoned Authorization header and crashed the service at boot.
printf 'the-real-key' | gcloud secrets versions add resend-api-key --data-file=- --project fluted-citizen-269819

# UNSUBSCRIBE_SECRET — any high-entropy string; only this service ever verifies it.
gcloud secrets create unsubscribe-secret --project fluted-citizen-269819
openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add unsubscribe-secret --data-file=- --project fluted-citizen-269819
```

`main.ts` falls back to `LogMailer` only when `RESEND_API_KEY` is **empty or unset**.
A non-empty but wrong key (the `placeholder` this project shipped with for a while) is
not a fallback — every send is attempted and fails, silently from the caller's side,
visible only as `[mail] resend error: API key is invalid` in the Cloud Run logs.
Note also that Cloud Run resolves secrets at container start, so a new secret version
does nothing until the next deploy.
`UNSUBSCRIBE_SECRET` degrades the same way, to a per-process random key: links stay
valid for the life of one instance, which is fine locally and wrong in production.
**Rotating it invalidates every unsubscribe link already sitting in players' inboxes**,
so rotate only if the key leaks.
The `VITE_FIREBASE_*` values in `packages/web/.env.production` are public identifiers,
not secrets — the browser key ships in the bundle to every visitor by design. It is
additionally restricted (API key `29962844-…`) to `identitytoolkit.googleapis.com` +
`securetoken.googleapis.com`, callable only from the `web.app`/`firebaseapp.com`
referrers, so it is useless for any other API or origin. Nothing else needs configuring: Cloud Run gets the secret via
`--set-secrets`, CI uses only emulators, and GitHub holds no repository secrets.

## DNS

`topherhooper.com` is registered at Squarespace but its nameservers are delegated to
the Cloud DNS zone `topherhooper-com` in this project, so records are managed with
`gcloud dns record-sets` rather than a registrar web panel.

| Record                       | Purpose                                 |
| ---------------------------- | --------------------------------------- |
| `play` CNAME → `…web.app`    | Firebase Hosting custom domain          |
| `resend._domainkey.mail` TXT | Resend DKIM signing key                 |
| `send.mail` TXT + MX         | SPF and the SES return path Resend uses |
| `_dmarc` TXT                 | DMARC `p=none`, monitor only            |

Two traps worth remembering. Resend displays record names relative to the **root**
domain (`resend._domainkey.mail`), not to the subdomain being verified — reading them
the other way produces `…mail.mail.topherhooper.com` and fails with no useful error.
And `play` holds a CNAME, so nothing else can ever live at that exact name; a CNAME
must be the only record at its label.

## Cloud Run env

`GCP_PROJECT`, `BASE_URL=https://play.topherhooper.com`, `MAIL_FROM`,
`TICK_SERVICE_ACCOUNT=www-tick@…`, `TICK_AUDIENCE=<run URL>` (set once out-of-band —
the URL only exists after the first deploy; `--update-env-vars` in the pipeline merges
and will not clobber it), `RESEND_API_KEY` and `UNSUBSCRIBE_SECRET` from Secret Manager.
Min 0 / max 1 instance — one instance is deliberate; Firestore transactions guard
correctness anyway.

## Gotchas learned the hard way

- **`/healthz` 404s publicly**: Google's frontend reserves `/healthz` on `run.app`
  domains and answers before the app. The route works locally and for port probes;
  don't chase 404s on it in prod.
- **Secrets from Windows**: see the BOM note above.
- **Firestore forbids nested arrays**, so `stateJson`/`mapJson` are canonical-JSON
  strings, with queryable fields (`turn`, `status`, `deadlineAt`) mirrored top-level.
- The **combat seed never leaves the server** and is distinct from the map seed —
  `GeneratedMap` embeds its own seed and ships to clients.

## Local dev

`pnpm dev:server` (Firestore + Auth emulators, API on :3001) and `pnpm dev:web`
(Vite on :5173, proxies `/api`). Needs Java for the emulators. `pnpm test:server`
runs the integration suite under `firebase emulators:exec`.
