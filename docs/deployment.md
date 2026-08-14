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

Manual deploy, pinned to a commit — **Actions → Deploy → Run workflow**, or:

```
gh workflow run deploy.yml -f ref=<branch|tag|sha>
```

`ref` defaults to `main`. The workflow (`.github/workflows/deploy.yml`) checks the ref
out, resolves it to a full SHA, tags the image with that SHA, and runs the same
`cloudbuild.yaml` as the trigger. Rolling back is dispatching an older SHA. It needs two
repository variables — `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT`
— plus a Workload Identity pool bound to this repo, all of which are created once by
"First-time setup for the deploy workflow" below.

Deploying from a laptop with `gcloud builds submit … COMMIT_SHA=manual-N .` still works,
and is still the wrong thing: the trailing `.` uploads your working tree, uncommitted
edits included, and `manual-N` tags the image with a counter that traces back to no
commit. Reach for it only when Actions itself is down.

### First-time setup for the deploy workflow

Done once. Everything below is idempotent enough to re-run except the `create` calls,
which fail with `ALREADY_EXISTS` — that failure is fine to ignore.

**The workflow file must be on `main` before step 8 works.** GitHub only offers
`workflow_dispatch` for workflows present on the default branch, so a `deploy.yml` that
exists solely on a feature branch is invisible to both the Actions tab and
`gh workflow run`. Merge first, then dispatch.

Run steps 1–7 from bash with an account that can administer IAM on the project.

```bash
# 0. Everything below reads these.
PROJECT=fluted-citizen-269819
REPO=topherhooper/WorldWideWar
POOL=github
PROVIDER=worldwidewar
SA_NAME=gha-deploy
SA=${SA_NAME}@${PROJECT}.iam.gserviceaccount.com
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
echo "$PROJECT_NUMBER"   # sanity: should print 614936797883

# 1. APIs. sts + iamcredentials are what federation itself runs on.
gcloud services enable \
  iamcredentials.googleapis.com sts.googleapis.com cloudbuild.googleapis.com \
  --project "$PROJECT"

# 2. The identity GitHub will act as. Deliberately not `cloudbuilder@`: that one is the
#    identity a build RUNS as, and this one is the identity that SUBMITS a build. Keeping
#    them separate means a leaked federation binding cannot itself deploy.
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="GitHub Actions deploy" --project "$PROJECT"

# 3. Roles to submit a build and read its logs.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" --role="roles/cloudbuild.builds.editor" --condition=None
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" --role="roles/logging.viewer" --condition=None

# 4. Write access to the source-upload bucket, scoped to that bucket rather than
#    granting project-wide storage.admin.
gcloud storage buckets add-iam-policy-binding "gs://${PROJECT}_cloudbuild" \
  --member="serviceAccount:${SA}" --role="roles/storage.objectAdmin"

# 5. Permission to hand the build to the Cloud Build service account it runs as.
gcloud iam service-accounts add-iam-policy-binding \
  "${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --member="serviceAccount:${SA}" --role="roles/iam.serviceAccountUser" \
  --project "$PROJECT"

# 6. The federation pool and its GitHub OIDC provider. The attribute condition is the
#    security boundary — without it, any repository on GitHub could mint tokens for
#    this provider.
gcloud iam workload-identity-pools create "$POOL" \
  --project="$PROJECT" --location=global --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
  --project="$PROJECT" --location=global --workload-identity-pool="$POOL" \
  --display-name="WorldWideWar" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository == '${REPO}'"

# 7. Let this repository — and only this repository — impersonate the SA.
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --project="$PROJECT" --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}"

# 8. Repository variables. Variables, not secrets — a provider resource name and an SA
#    email are identifiers, and keeping them out of secrets keeps "GitHub holds no
#    repository secrets" true.
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$REPO" \
  --body "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --repo "$REPO" --body "$SA"
gh variable list --repo "$REPO"
```

Then dispatch a real deploy and watch it:

```bash
gh workflow run deploy.yml --repo topherhooper/WorldWideWar -f ref=main
gh run watch --repo topherhooper/WorldWideWar
```

Failures worth recognising on the first run:

| Symptom                                                           | Cause                                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Workflow does not have 'workflow_dispatch' trigger` / not listed | `deploy.yml` is not on `main` yet                                                      |
| `Permission denied on resource ... workloadIdentityPools`         | Step 7's binding missing, or the repo name in it is wrong                              |
| `unable to impersonate`, `IAM_PERMISSION_DENIED` at the auth step | Attribute condition in step 6 does not match `$REPO`                                   |
| Auth passes, `builds submit` 403s                                 | Step 3, 4 or 5 skipped                                                                 |
| Build runs, `firebase deploy` fails on permissions                | The Cloud Build SA lacks `firebasehosting.admin` — grant on the build SA, not on `$SA` |

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
