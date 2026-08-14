# Selective CI and Deploy Triggers — Idea

Date: 2026-08-14
Status: Captured — not yet brainstormed
Source: Own notes, dumped via `/new-idea`

## Raw dump

Only trigger specific tests when relevant parts of the project have been changed. Only
trigger deployment with the app has changed (exempt doc changes)

## What's being asked

- Run only the tests relevant to what changed, instead of everything on every change.
- Only trigger deployment when the app has changed.
- Exempt documentation changes from triggering deployment.

## Open questions

- What counts as "relevant"? Per-package (engine / server / web / tools), per-changed-file,
  or something else?
- What is the mapping from a changed path to the tests it should trigger, and who
  maintains it as the repo grows?
- What counts as "the app" for deployment purposes? The dump does not define it.
- Does "exempt doc changes" mean exempt from deployment only, or from tests as well?
- Does `docs/**` alone count as a doc change, or also `README.md`, `CLAUDE.md`,
  `.claude/**`, and comment-only edits inside source files?
- What happens to a mixed changeset that touches both docs and app code?
- The CI workflow at `.github/workflows/ci.yml` also runs a mapgen sweep and a balance
  sweep beyond the main check job. Are those in scope for selective triggering?
- If checks are skipped rather than run, do required-status-check rules on `main` still
  pass? (Relevant now that PRs gate merging.)
- Deployment is configured across `cloudbuild.yaml` and `firebase.json` — which of these
  the ask refers to is not stated.

## Unverified claims

- The dump implies the current setup runs tests that are not relevant to a given change,
  and deploys on changes that do not affect the app. Neither has been measured here.

## Suggested next step

Brainstorm.
