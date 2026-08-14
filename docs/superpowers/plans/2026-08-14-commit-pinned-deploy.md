# Commit-Pinned Manual Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the manual deploy pathway a real commit identity — a `workflow_dispatch` GitHub Actions workflow that checks out a chosen ref, resolves it to a full SHA, and submits the existing `cloudbuild.yaml` with that SHA — replacing `gcloud builds submit … COMMIT_SHA=manual-N .` run against a laptop's working tree, per the approved spec `docs/superpowers/specs/2026-08-14-commit-pinned-deploy-design.md`.

**Architecture:** Additive CI only. One new workflow file under `.github/workflows/`, authenticating to GCP keylessly through Workload Identity Federation and shelling out to the same `gcloud builds submit` the runbook already documents. `cloudbuild.yaml`, the Dockerfile, the Cloud Run configuration and the push-to-`main` Cloud Build trigger are all untouched, so the manual path and the automatic path run byte-identical deploy logic.

**Tech Stack:** TypeScript ESM monorepo (pnpm), Vitest, Fastify + Firestore (server, tested against the emulator), React 19 + react-router (web).

## Global Constraints

- **No source file is touched.** This plan adds one workflow and edits one runbook. If a
  `packages/**` file changes, the diff has outgrown the spec.
- **No new npm dependencies.** The two `google-github-actions/*` actions are workflow
  `uses:` entries, the same category as the existing `pnpm/action-setup@v4` in `ci.yml`.
- **`cloudbuild.yaml` is not modified.** Its `$COMMIT_SHA` interpolation is exactly the
  seam this feature needs; changing it would decouple the manual and trigger paths.
- **The workflow triggers on `workflow_dispatch` only.** No `push:`, no `pull_request:` —
  it must not be possible for a merge to fire a deploy through this file.
- **Repository variables, not secrets.** `docs/deployment.md` records that GitHub holds no
  repository secrets; WIF keeps that true.
- Prettier covers `.github/**`, and CI runs `format:check` first, so run
  `pnpm exec prettier --check --end-of-line auto .` before every commit (`pnpm format:check`
  is unreliable locally — see CLAUDE.md).
- Full gate before the final push: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`.
- Commit after every task.

## File Structure

| File                           | Role                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `.github/workflows/deploy.yml` | Create. `workflow_dispatch` deploy: checkout ref → resolve SHA → WIF auth → `gcloud builds submit` |
| `docs/deployment.md`           | Modify (~lines 17–29, "Pipeline"). Replace the `manual-N` runbook with the dispatch pathway        |

Tests: none automatable — the deliverable is a workflow whose behaviour belongs to GitHub
and GCP, and it cannot execute until the human prerequisites in the spec exist. Verification
is YAML/Prettier parse plus the unchanged repo gate; end-to-end is deferred and the PR says so.

---

### Task 1: The deploy workflow

**Files:**
Create: `.github/workflows/deploy.yml` (~60 lines)

**Interfaces:**
Consumes: `vars.GCP_WORKLOAD_IDENTITY_PROVIDER`, `vars.GCP_DEPLOY_SERVICE_ACCOUNT`, `cloudbuild.yaml`
Produces: a Cloud Build run tagging `us-central1-docker.pkg.dev/fluted-citizen-269819/www/api:<full-sha>`

- [x] Write `.github/workflows/deploy.yml`:

```yaml
# Manual production deploy, pinned to a commit.
#
# The pathway this replaces was `gcloud builds submit --substitutions COMMIT_SHA=manual-N .`
# run from a laptop: it uploaded the working tree, so uncommitted edits shipped, and it
# tagged the image with a hand-typed counter that traced back to no commit at all.
#
# Here the checkout is the source of truth. `ref` may be a branch, tag or SHA; the full
# SHA is read back out of the checkout rather than trusted from the input, so dispatching
# `main` records the commit that was actually built instead of a moving branch name.
#
# Deploy logic itself stays in cloudbuild.yaml, shared with the push-to-main trigger.
# Rollback is not a feature: dispatch an older SHA.
name: Deploy

on:
  workflow_dispatch:
    inputs:
      ref:
        description: 'Branch, tag or commit SHA to deploy'
        required: true
        default: main

# Two builds racing to `gcloud run deploy` can interleave revisions on a service pinned
# to max 1 instance. Queue instead of cancelling — a cancelled `builds submit` leaves the
# Cloud Build running server-side, so cancellation would report a lie.
concurrency:
  group: deploy-production
  cancel-in-progress: false

env:
  GCP_PROJECT: fluted-citizen-269819

jobs:
  deploy:
    name: Build and deploy ${{ inputs.ref }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.ref }}

      - name: Resolve ref to a full commit SHA
        id: sha
        run: echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"

      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ vars.GCP_DEPLOY_SERVICE_ACCOUNT }}

      - uses: google-github-actions/setup-gcloud@v2

      # The same command the runbook documents, with a real SHA in place of `manual-N`
      # and a clean checkout in place of a working tree.
      - name: Submit build
        run: |
          gcloud builds submit \
            --config cloudbuild.yaml \
            --project "$GCP_PROJECT" \
            --substitutions COMMIT_SHA=${{ steps.sha.outputs.sha }} \
            .

      - name: Summarise
        run: |
          {
            echo "### Deployed"
            echo
            echo "- **Ref dispatched:** \`${{ inputs.ref }}\`"
            echo "- **Commit:** \`${{ steps.sha.outputs.sha }}\`"
            echo "- **Image:** \`us-central1-docker.pkg.dev/$GCP_PROJECT/www/api:${{ steps.sha.outputs.sha }}\`"
          } >> "$GITHUB_STEP_SUMMARY"
```

- [x] Confirm the file parses as YAML and Prettier accepts it:
      `pnpm exec prettier --check --end-of-line auto .github/workflows/deploy.yml`
- [x] Confirm the trigger list contains no `push` or `pull_request` key.
- [x] Run the gate: `pnpm lint && pnpm typecheck && pnpm test`
- [x] Commit: `ci(deploy): dispatch a commit-pinned production deploy`

---

### Task 2: Point the runbook at the new pathway

**Files:**
Modify: `docs/deployment.md` (~lines 17–29, the "Pipeline" section)

**Interfaces:**
Consumes: `.github/workflows/deploy.yml` from Task 1
Produces: a runbook whose manual-deploy instructions match what the repo can actually do

The `manual-N` command must stop being the documented pathway — leaving it in place is how
it keeps getting used. Replace the "Manual deploy of the working tree" paragraph with the
dispatch instructions, and state the prerequisites so a reader who hits an auth failure
knows whether the pool exists.

- [x] Replace the manual-deploy paragraph in the "Pipeline" section with:

````markdown
Manual deploy, pinned to a commit — **Actions → Deploy → Run workflow**, or:

```
gh workflow run deploy.yml -f ref=<branch|tag|sha>
```

`ref` defaults to `main`. The workflow checks the ref out, resolves it to a full SHA,
tags the image with that SHA, and runs the same `cloudbuild.yaml` as the trigger. Rolling
back is dispatching an older SHA. It needs two repository variables —
`GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT` — and a Workload
Identity pool bound to this repo; see the spec's prerequisites. Deploying from a laptop
with `gcloud builds submit … COMMIT_SHA=manual-N .` uploads your working tree,
uncommitted edits included, and tags the image with a counter that traces back to no
commit. Don't.
````

- [x] `pnpm exec prettier --check --end-of-line auto docs/deployment.md`
- [x] Commit: `docs(deploy): document the commit-pinned dispatch pathway`

---

## Self-review notes

**No TDD cycle, because there is nothing to test.** Every other plan in this repo opens
each task with a failing test. The deliverable here is one YAML workflow whose behaviour is
GitHub's dispatch machinery and GCP's build service; the only executable assertion available
without production credentials is "the YAML parses", which Prettier already makes. Writing a
test that asserts the workflow file contains certain strings would test the diff against
itself. The checkboxes verify what can genuinely be verified and the PR states plainly that
the workflow was never executed.

**`docs/deployment.md` had uncommitted local changes when this ran** — an unrelated
in-progress edit to the Secrets and Gotchas sections, from a 2026-08-13 sign-in incident.
Those hunks are 40+ lines away from the Pipeline section this plan edits. They are held
aside as a patch, restored after Task 2's commit, and must not appear in the diff. Check
`git show --stat` on the docs commit before pushing: it should touch the Pipeline section
only.
