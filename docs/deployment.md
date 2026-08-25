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

Documentation-only pushes do not deploy. The trigger carries an `ignoredFiles` filter; when
every path in a push matches it, Cloud Build never queues a build at all. The globs are the
same ones CI treats as documentation, printed by the classifier so the two cannot drift:

The filter is already applied. To change it, edit the trigger through export/import —
`gcloud builds triggers update github` rejects a partial update with `INVALID_ARGUMENT`,
and passing the flags it does want risks clearing `serviceAccount` or the branch pattern:

```bash
pnpm exec tsx tools/ci/src/main.ts --ignored-files   # source of truth for the globs

gcloud beta builds triggers export Sample \
  --region=us-central1 --project=fluted-citizen-269819 --destination=trigger.yaml
# append, quoting the globs that start with '*' so YAML does not read them as aliases:
#   ignoredFiles:
#   - docs/**
#   - '*.md'
#   - '**/*.md'
#   - .claude/**
gcloud beta builds triggers import \
  --source=trigger.yaml --region=us-central1 --project=fluted-citizen-269819
```

Afterwards confirm `serviceAccount` and `push.branch` survived, because import replaces
the whole definition rather than merging into it:

```bash
gcloud builds triggers describe Sample --region=us-central1 \
  --project=fluted-citizen-269819 --format=yaml
```

One non-documentation file in the push and the whole build runs — the filter is a union
over the push, not a per-file decision, so there is no such thing as a partial deploy. The
filter is on the trigger, so it only ever suppresses the automatic push-to-`main` deploy;
every manual path below bypasses the trigger and therefore deploys whatever ref you name,
documentation or not.

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

**This is already provisioned** — it ran on 2026-08-14 and the two repository variables
are set. What follows is the record of what exists, and the procedure to rebuild it in a
fresh project. Everything is idempotent to re-run except the `create` calls, which fail
with `ALREADY_EXISTS`.

What is in place now:

| Resource            | Value                                                          |
| ------------------- | -------------------------------------------------------------- |
| Federation pool     | `github-pool` (pre-existing — also serves `razzle-dazzle`)     |
| OIDC provider       | `worldwidewar`, conditioned to `topherhooper/WorldWideWar`     |
| Submitting identity | `gha-deploy@fluted-citizen-269819.iam.gserviceaccount.com`     |
| Building identity   | `cloudbuilder@…` — the same SA the push-to-`main` trigger uses |

**The pool is shared, and its providers are not.** `github-pool` already carried a
`github-provider` pinned to `topherhooper/razzle-dazzle`. Adding a sibling provider is
correct; editing that one would silently break the other repository's deploys.

**Do not remove `--gcs-source-staging-dir` from the workflow.** It is the difference
between a working deploy and five identical 403s. Left to itself, `gcloud builds submit`
resolves the default `<project>_cloudbuild` bucket by listing — and `storage.buckets.list`
is a **project-level** permission that cannot be granted on a single bucket. No amount of
bucket-scoped IAM fixes it; the documented workarounds are Project Viewer or Storage
Admin, both of which hand a GitHub-assumable credential broad read over the whole project,
Firestore included. Naming the staging directory skips the resolution step entirely and
keeps `gha-deploy@` scoped to one bucket. This was established the hard way — the error
text blames `serviceusage.services.use`, which is a red herring.

**The role set below is what is provisioned, not a minimized set.** `serviceUsageConsumer`
and `legacyBucketReader` were added while chasing the 403 above and may not be load-bearing
now that the staging directory is explicit. Nobody has tried removing them.

**The workflow file must be on `main` before step 8 works.** GitHub only offers
`workflow_dispatch` for workflows present on the default branch, so a `deploy.yml` that
exists solely on a feature branch is invisible to both the Actions tab and
`gh workflow run`. Merge first, then dispatch.

Run steps 1–7 from bash with an account that can administer IAM on the project.

```bash
# 0. Everything below reads these.
PROJECT=fluted-citizen-269819
REPO=topherhooper/WorldWideWar
POOL=github-pool          # reused; a fresh project would create this
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

# 3. Roles to submit a build and read its logs. Note what is NOT here: no project-wide
#    roles/viewer and no roles/storage.admin. Both are widely recommended for this and
#    both are unnecessary — see the --gcs-source-staging-dir note above.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" --role="roles/cloudbuild.builds.editor" --condition=None
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" --role="roles/logging.viewer" --condition=None
# Added while debugging; possibly redundant. See the note above before copying it.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" --role="roles/serviceusage.serviceUsageConsumer" --condition=None

# 4. Bucket access, scoped to the one bucket. objectAdmin uploads the source tarball;
#    legacyBucketReader was added while debugging and may be redundant.
gcloud storage buckets add-iam-policy-binding "gs://${PROJECT}_cloudbuild" \
  --member="serviceAccount:${SA}" --role="roles/storage.objectAdmin"
gcloud storage buckets add-iam-policy-binding "gs://${PROJECT}_cloudbuild" \
  --member="serviceAccount:${SA}" --role="roles/storage.legacyBucketReader"

# 5. Permission to hand the build to the SA it runs as. That SA is `cloudbuilder@`, not
#    the Cloud Build default: this project has no legacy PROJECT_NUMBER@cloudbuild SA,
#    so an unqualified `builds submit` would fall back to the Compute Engine default,
#    which lacks firebasehosting.admin. The workflow passes --service-account to pin it.
gcloud iam service-accounts add-iam-policy-binding \
  "cloudbuilder@${PROJECT}.iam.gserviceaccount.com" \
  --member="serviceAccount:${SA}" --role="roles/iam.serviceAccountUser" \
  --project "$PROJECT"

# 6. The federation pool and its GitHub OIDC provider. The attribute condition is the
#    security boundary — without it, any repository on GitHub could mint tokens for
#    this provider. The pool already existed here, so this create was skipped.
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

| Symptom                                                           | Cause                                                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Workflow does not have 'workflow_dispatch' trigger` / not listed | `deploy.yml` is not on `main` yet                                                       |
| `Permission denied on resource ... workloadIdentityPools`         | Step 7's binding missing, or the repo name in it is wrong                               |
| `unable to impersonate`, `IAM_PERMISSION_DENIED` at the auth step | Attribute condition in step 6 does not match `$REPO`                                    |
| Auth passes, `builds submit` 403s                                 | Step 3, 4 or 5 skipped                                                                  |
| `builds submit` rejects `--service-account`                       | The build config must set `logging: CLOUD_LOGGING_ONLY`; `cloudbuild.yaml` already does |
| Build runs, `firebase deploy` fails on permissions                | The Cloud Build SA lacks `firebasehosting.admin` — grant on the build SA, not on `$SA`  |

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
`securetoken.googleapis.com`, and to the referrers listed under "Sign-in origins"
below, so it is useless for any other API or origin. Nothing else needs configuring:
Cloud Run gets the secret via `--set-secrets`, CI uses only emulators, and GitHub holds
no repository secrets.

### Sign-in origins

Every origin the app is served from has to be listed in **three independent places**, or
Google sign-in fails. They are enforced by different systems and none implies the
others, so adding a hosting domain and stopping there is the standing trap — it is what
broke `play.topherhooper.com` on 2026-08-13.

A **fourth** thing has to be right, and it is not an origin at all: the client ID _and
secret_ Firebase Auth stores for the Google provider. It is listed here because the three
origin probes below all pass while it is broken, which is exactly how it cost a day on
2026-08-25 — a green checklist on a site nobody could sign in to.

| Place                             | Enforced by      | Failure if missing                                                  |
| --------------------------------- | ---------------- | ------------------------------------------------------------------- |
| API key `29962844-…` referrers    | API Keys         | `auth/requests-from-referer-<origin>-are-blocked` (403)             |
| Firebase Auth `authorizedDomains` | Identity Toolkit | `auth/unauthorized-domain`                                          |
| OAuth client redirect URIs        | Google OAuth     | `Error 400: redirect_uri_mismatch`                                  |
| Google provider ID + secret       | Identity Toolkit | `auth/invalid-credential`, wrapping a 401 from `oauth2/v1/userinfo` |

The third only applies to whichever origin `VITE_FIREBASE_AUTH_DOMAIN` names, since that
is the domain whose `/__/auth/handler` Google redirects back to. Point it at the domain
the site is actually served from: a cross-origin `authDomain` still works for
`signInWithPopup`, but browser third-party-storage partitioning breaks the
`signInWithRedirect` fallback that `auth.tsx` uses on mobile and behind popup blockers —
sign-in then fails only on phones, which desktop testing never reveals. Hosting serves
the real `/__/auth/handler` on every domain attached to the project, and `firebase.json`'s
catch-all rewrite does not shadow the reserved `/__/` namespace, so no rewrite is needed.

All three currently hold `play.topherhooper.com` alongside the
`web.app`/`firebaseapp.com` defaults. To add another origin:

```bash
# 1. API key referrers. This flag REPLACES the list, so restate every origin — and
#    restate --api-target too, or the API restriction is dropped and the key widens
#    to every enabled API in the project.
gcloud services api-keys update projects/614936797883/locations/global/keys/29962844-cd3c-4761-9395-6e4a6d612afe \
  --project fluted-citizen-269819 \
  --allowed-referrers="https://play.topherhooper.com/*,https://fluted-citizen-269819.web.app/*,https://fluted-citizen-269819.firebaseapp.com/*" \
  --api-target=service=identitytoolkit.googleapis.com \
  --api-target=service=securetoken.googleapis.com

# 2. Firebase Auth authorized domains — also a full replacement, bare hostnames.
curl -X PATCH \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "x-goog-user-project: fluted-citizen-269819" \
  -H "Content-Type: application/json" \
  --data '{"authorizedDomains":["localhost","fluted-citizen-269819.firebaseapp.com","fluted-citizen-269819.web.app","play.topherhooper.com"]}' \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/fluted-citizen-269819/config?updateMask=authorizedDomains"
```

Step 3 is console-only — there is no gcloud surface for a non-IAP OAuth client. Add
`https://<origin>/__/auth/handler` under **Authorized redirect URIs** on client
`614936797883-c24n36s0orbm3s0ff6pgu1lt725imip7`:

```
https://console.cloud.google.com/apis/credentials/oauthclient/614936797883-c24n36s0orbm3s0ff6pgu1lt725imip7.apps.googleusercontent.com?project=fluted-citizen-269819
```

Verify all four without a browser. Each probe isolates one layer, and each takes a few
minutes to propagate after a change — an immediate retest looks like failure.

```bash
# 1 + 2. The call the SDK makes first, so it reproduces the referrer block on its own.
# Blocked origin → API_KEY_HTTP_REFERRER_BLOCKED. Allowed → a sessionId.
curl -s -X POST -H "Referer: https://play.topherhooper.com/" -H "Content-Type: application/json" \
  --data '{"identifier":"probe@example.com","continueUri":"https://play.topherhooper.com/"}' \
  "https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=AIzaSyDsG81Moo9f3vgnYiWfdZDHT7QrBFuL0Sc"

# 3. Unregistered redirect URIs come back as redirect_uri_mismatch; registered ones
#    reach the sign-in page. Check an origin you did NOT register too — if that also
#    passes, the probe is broken, not the config. A DELETED client answers this same
#    call with "Error 401: deleted_client", which is worth knowing because Google
#    auto-deletes OAuth clients inactive for 5 months and mails a 30-day warning first.
curl -s -L "https://accounts.google.com/o/oauth2/v2/auth\
?client_id=614936797883-c24n36s0orbm3s0ff6pgu1lt725imip7.apps.googleusercontent.com\
&response_type=code&scope=email\
&redirect_uri=https://play.topherhooper.com/__/auth/handler" | grep -c redirect_uri_mismatch

# 4. Whether the Google provider is enabled at all. A deliberately bogus token is enough:
#    INVALID_IDP_RESPONSE means enabled and parsing normally, so the fault is the secret;
#    OPERATION_NOT_ALLOWED means the provider itself is off. This does NOT test the
#    secret — nothing outside the project can, see below.
curl -s -X POST -H "Referer: https://play.topherhooper.com/" -H "Content-Type: application/json" \
  --data '{"postBody":"id_token=bogus.token.value&providerId=google.com","requestUri":"https://play.topherhooper.com","returnSecureToken":true,"returnIdpCredential":true}' \
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=AIzaSyDsG81Moo9f3vgnYiWfdZDHT7QrBFuL0Sc"
```

#### The fourth layer: the Google provider's client secret

`signInWithPopup` hands Google's authorization code to Identity Toolkit, which exchanges
it for tokens using the client ID **and secret** stored under **Firebase Console → Auth →
Sign-in method → Google → Web SDK configuration**. A wrong secret makes that exchange
return no access token, Identity Toolkit then calls `oauth2/v1/userinfo` with nothing in
hand, and the browser sees a 400 on `accounts:signInWithIdp` whose body reads:

```
Failed to fetch resource from https://www.googleapis.com/oauth2/v1/userinfo,
http status: 401 ... "Expected OAuth 2 access token, login cookie or other valid
authentication credential" (auth/invalid-credential)
```

Read that error correctly: it is Google talking to Google. Nothing about it is reachable
from the browser, from `gcloud`, or from any probe above — the secret is the one part of
the sign-in path with no external observable. When the three origin probes pass and
sign-in still fails, **this is the answer**, and the fix is to paste a fresh secret from
the Cloud Console client into that Firebase field.

Two traps make a rotation silently half-complete:

- **Google shows a client secret exactly once**, at creation. Clicking _Add secret_
  without copying it in that moment leaves nothing to paste, and the Firebase side is
  unchanged. Confirm the save by navigating away and reopening the panel.
- **Adding a secret does not replace the old one.** A client holds several, and Firebase
  keeps its own copy. Deleting an old secret while Firebase still holds it breaks a
  working site with no deploy and no code change — which is how this one broke.

Nothing here needs a rebuild or deploy. Identity Toolkit reads the provider config live,
so a corrected secret takes effect within seconds.

Finally, when debugging: **test in a private window**. Firebase persists auth state in
IndexedDB per origin, so failed attempts accumulate and a fixed backend can still fail in
the window you were debugging in. `Cross-Origin-Opener-Policy policy would block the
window.closed call` in the console is unrelated noise from the popup poller — it is not
the failure, and chasing it wastes time.

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

## Cost

The billing account carries a $15 budget (`low cost - 15`). A GCP budget is an alert and
not a cap — crossing it shuts nothing off. What actually spends, and the ~$9/month
baseline that predates this project entirely, is in [cost.md](cost.md).

Two things there bear on this runbook: `cloudbuild.yaml` deliberately sets no
`machineType`, because naming one forfeits Cloud Build's 2,500 free build-minutes a
month; and Artifact Registry has no cleanup policy yet, so every `api:$COMMIT_SHA` ever
pushed is still stored.

## Gotchas learned the hard way

- **`/healthz` 404s publicly**: Google's frontend reserves `/healthz` on `run.app`
  domains and answers before the app. The route works locally and for port probes;
  don't chase 404s on it in prod.
- **Secrets from Windows**: see the BOM note above.
- **A new custom domain shows "Not Secure" for a few hours.** DNS starts resolving to
  Firebase the moment the CNAME lands, but the managed certificate is issued later —
  `play.topherhooper.com` pointed at Hosting from 2026-08-13T00:47Z and its cert only
  became valid at 08:43Z. In that window the domain serves a certificate that does not
  match, and browsers say "Not Secure". Nothing to fix; it clears itself. Check state
  rather than guessing — wait for `CERT_ACTIVE` and `DOMAIN_ACTIVE`:

  ```bash
  curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "x-goog-user-project: fluted-citizen-269819" \
    "https://firebasehosting.googleapis.com/v1beta1/sites/fluted-citizen-269819/domains"
  ```

  This is also why `_BASE_URL` in `cloudbuild.yaml` is overridable — mail sent during
  that window would otherwise carry links browsers refuse to open.

- **Firestore forbids nested arrays**, so `stateJson`/`mapJson` are canonical-JSON
  strings, with queryable fields (`turn`, `status`, `deadlineAt`) mirrored top-level.
- The **combat seed never leaves the server** and is distinct from the map seed —
  `GeneratedMap` embeds its own seed and ships to clients.

## Local dev

`pnpm dev:server` (Firestore + Auth emulators, API on :3001) and `pnpm dev:web`
(Vite on :5173, proxies `/api`). Needs Java for the emulators. `pnpm test:server`
runs the integration suite under `firebase emulators:exec`.
