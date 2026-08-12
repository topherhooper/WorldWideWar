# Deployment

Everything runs in GCP project **`fluted-citizen-269819`**, region **`us-central1`**.

| Thing          | Where                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| Site           | https://fluted-citizen-269819.web.app (Firebase Hosting, CDN)            |
| API            | Cloud Run service `www-api` — reached via the Hosting `/api/**` rewrite  |
| State          | Firestore `(default)`, native mode                                       |
| Images         | Artifact Registry `us-central1-docker.pkg.dev/fluted-citizen-269819/www` |
| Turn deadlines | Cloud Scheduler job `www-tick`, every minute → `POST /internal/tick`     |
| Email          | Resend, key in Secret Manager `resend-api-key`                           |
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

The only secret is the Resend API key. To set the real one:

```bash
# bash, not PowerShell — PS 5.1 piping prepends a UTF-16 BOM, which once shipped
# a poisoned Authorization header and crashed the service at boot.
printf 'the-real-key' | gcloud secrets versions add resend-api-key --data-file=- --project fluted-citizen-269819
```

Until a real key is set (current version is `placeholder`), the server falls back to
logging mail instead of sending it — `main.ts` treats an unusable key as absent.
The `VITE_FIREBASE_*` values in `packages/web/.env.production` are public identifiers,
not secrets — the browser key ships in the bundle to every visitor by design. It is
additionally restricted (API key `29962844-…`) to `identitytoolkit.googleapis.com` +
`securetoken.googleapis.com`, callable only from the `web.app`/`firebaseapp.com`
referrers, so it is useless for any other API or origin. Nothing else needs configuring: Cloud Run gets the secret via
`--set-secrets`, CI uses only emulators, and GitHub holds no repository secrets.

## Cloud Run env

`GCP_PROJECT`, `BASE_URL=https://fluted-citizen-269819.web.app`, `MAIL_FROM`,
`TICK_SERVICE_ACCOUNT=www-tick@…`, `TICK_AUDIENCE=<run URL>` (set once out-of-band —
the URL only exists after the first deploy; `--update-env-vars` in the pipeline merges
and will not clobber it), `RESEND_API_KEY` from Secret Manager.
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
