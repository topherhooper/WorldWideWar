# Commit-Pinned Manual Deploy — Idea

Date: 2026-08-14
Status: Captured — not yet brainstormed
Source: Own notes, dumped in chat ahead of `/one-shot`

## Raw dump

I want a manual deployment pathway to be tied to a git commit. I think probably through
github actions. Right now we trigger a lot of deployments manually through the gcloud
cli.

## What's being asked

- Make the manual deployment pathway tied to a specific git commit.
- Move that pathway into GitHub Actions.
- Replace the current practice of triggering deployments by hand from the `gcloud` CLI.

## Open questions

- Does this replace the push-to-`main` Cloud Build trigger, or sit alongside it?
- What identifies the commit at dispatch time — a full SHA, a short SHA, a branch name,
  a tag, or any ref?
- Should a deploy be refused when the commit is not reachable from `main`?
- How does GitHub Actions authenticate to GCP? `docs/deployment.md` currently states
  that "GitHub holds no repository secrets."
- Does the existing `cloudbuild.yaml` stay the unit of deployment, or does the workflow
  take over the build and deploy steps itself?
- What happens if two manual deploys are dispatched at once? Cloud Run is pinned to
  max 1 instance.
- Is rollback in scope, or only forward deploys?

## Constraints & non-goals

- `docs/deployment.md` records that GitHub holds no repository secrets today.
- The deploy pipeline is `cloudbuild.yaml`; CI in `.github/workflows/ci.yml` deliberately
  does not deploy.

## Unverified claims

- The dump implies the current manual pathway is not tied to a commit. The documented
  command is
  `gcloud builds submit --config cloudbuild.yaml --substitutions COMMIT_SHA=manual-N .`,
  which uploads the working tree and tags the image `manual-N`.

## Suggested next step

Brainstorm, then `/one-shot`.
