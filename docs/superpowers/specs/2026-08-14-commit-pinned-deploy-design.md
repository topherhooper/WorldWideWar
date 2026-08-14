# Commit-Pinned Manual Deploy — Design

Date: 2026-08-14
Status: Approved pending spec review

## Goal

Make every manual production deploy identify the exact commit it shipped, and move the
pathway from a laptop into GitHub Actions.

The documented manual deploy today is

```
gcloud builds submit --config cloudbuild.yaml --project fluted-citizen-269819 \
  --substitutions COMMIT_SHA=manual-N .
```

Two things are wrong with it, and they compound. The trailing `.` uploads **the working
tree**, so what reaches production is whatever was on someone's machine — including
edits never committed, which is the normal state of a working tree mid-task.
`COMMIT_SHA=manual-N` then tags the resulting image with a hand-typed counter, so
`api:manual-7` in Artifact Registry cannot be traced back to any commit, and the next
person's `manual-7` overwrites it. Production drifts from `main` with no record of how.

Both fall out of one fix: check the commit out in CI and pass its real SHA. The image
tag becomes the commit, and rollback becomes "dispatch the older SHA" without any
rollback feature existing.

## Decisions (settled during brainstorming)

| Question                                     | Decision                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Replace the push-to-`main` trigger?          | No. The new workflow sits alongside it; the ask is about the manual pathway.                               |
| What identifies the commit at dispatch?      | One `ref` input, default `main`. Any branch, tag or SHA; the workflow resolves it to the full 40-char SHA. |
| Refuse commits not reachable from `main`?    | No gate. Deploying a branch before merge is legitimate.                                                    |
| How does Actions authenticate to GCP?        | Workload Identity Federation, keyless, via `google-github-actions/auth`.                                   |
| Does `cloudbuild.yaml` stay the deploy unit? | Yes, unchanged. The workflow only pins the source and passes the real SHA.                                 |
| Concurrent dispatches?                       | A `concurrency` group that queues rather than cancels.                                                     |
| Rollback?                                    | Not a feature. It falls out of dispatching an older SHA.                                                   |

Rejected: **a service-account JSON key in a GitHub secret** (fewer setup steps, but it is
a long-lived exportable credential carrying `run.admin` + `artifactregistry.writer` +
`firebasehosting.admin`, and `docs/deployment.md` records that "GitHub holds no repository
secrets" — WIF keeps that true, since a provider resource name and an SA email are
identifiers, not secrets). **Porting the build and deploy steps into the workflow itself**
(would duplicate the pipeline in two files that then drift, and the trigger path and manual
path would stop being the same deploy). **A `main`-reachability gate on the ref** (a knob
nobody asked for, and it forbids the pre-merge deploy that is half the reason to deploy by
hand). **A `workflow_dispatch` choice of environment** (there is one environment).
**GitHub Environments with a required reviewer** (a real practice, but this repo has one
maintainer and it was not asked for). **Cancelling in-progress deploys on a new dispatch**
(a cancelled `gcloud builds submit` leaves the Cloud Build running server-side anyway, so
cancellation would report a lie).

## CI

One new file, `.github/workflows/deploy.yml`, triggered only by `workflow_dispatch`. It
never runs on push, so it cannot fire from a merge and cannot interact with the existing
`ci.yml`.

The job, in order:

1. `actions/checkout@v4` with `ref: inputs.ref` — resolves branch, tag or SHA identically
   to `git checkout`, and lands a clean tree at exactly that commit.
2. `git rev-parse HEAD` to read the full SHA back out. Reading it from the checkout rather
   than from the input is what makes `ref: main` safe: the recorded SHA is the commit that
   was actually built, not a moving branch name.
3. `google-github-actions/auth@v2` with `workload_identity_provider` and
   `service_account` from repository **variables**, and `id-token: write` permission.
4. `google-github-actions/setup-gcloud@v2`.
5. `gcloud builds submit --config cloudbuild.yaml --substitutions COMMIT_SHA=<full-sha> .`
   — the same command the runbook documents, with a real SHA in place of `manual-N` and a
   clean checkout in place of a laptop's working tree.
6. Write the SHA and the resulting image tag to `$GITHUB_STEP_SUMMARY`, so the run page
   answers "what is in production" without opening Artifact Registry.

`concurrency: { group: deploy-production, cancel-in-progress: false }`. Cloud Run runs at
`--max-instances=1` and two builds racing to `gcloud run deploy` can interleave revisions;
queueing is one line and the failure it prevents is a silent one.

No `.gcloudignore` exists, so `gcloud builds submit` falls back to `.gitignore` for the
source upload, which already excludes `node_modules` and `dist`. Nothing to add.

## Prerequisites (blocked on human)

The workflow is inert until these exist. It is safe to merge before they do — nothing
triggers it automatically.

- A Workload Identity Pool and Provider for this repository, with the provider's attribute
  condition restricted to `topherhooper/WorldWideWar`.
- A deploy service account permitted to impersonate from that provider
  (`roles/iam.workloadIdentityUser`), holding `roles/cloudbuild.builds.editor`,
  `roles/storage.objectAdmin` on the Cloud Build source bucket, and
  `roles/iam.serviceAccountUser` on the build service account.
- Two repository **variables** (not secrets): `GCP_WORKLOAD_IDENTITY_PROVIDER` (the full
  `projects/…/locations/global/workloadIdentityPools/…/providers/…` resource name) and
  `GCP_DEPLOY_SERVICE_ACCOUNT` (the SA email).

Reusing the existing `cloudbuilder@fluted-citizen-269819.iam.gserviceaccount.com` is the
least-setup option, but it currently holds the roles a build _runs_ with, not the roles a
caller needs to _submit_ a build, so the three roles above still have to be granted.

## Testing

There is nothing here Vitest can reach — the deliverable is one YAML workflow whose
behaviour is entirely GitHub's and GCP's. What can be checked without credentials:

- The workflow parses as YAML and Prettier's `format:check` accepts it, since CI runs that
  gate first and it covers `.github/**`.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` stay green — no source file is touched, so
  a red result would mean something unrelated broke.

End-to-end verification requires the prerequisites above and is explicitly deferred to the
human who creates them. The PR will say so rather than implying a green deploy.

## Out of scope for v1

- Retiring the push-to-`main` Cloud Build trigger.
- GitHub Environments, required reviewers, or a deploy approval gate.
- A rollback command, a deploy history page, or a "what is live now" query.
- Selective deploys that skip when only docs changed — that is a separate captured idea,
  `docs/superpowers/ideas/2026-08-14-selective-ci-and-deploy.md`.
- Moving CI's checks into the deploy path, or gating deploy on CI having passed for that
  SHA.
- Any change to `cloudbuild.yaml`, the Dockerfile, or the Cloud Run configuration.
