---
status: open
kind: chore
area: deploy
priority: 1
blocked-by: ''
---

# Execute the mothball runbook

## Next step

Run **"Mothball and relight"** in [docs/deployment.md](../docs/deployment.md) top to bottom: pause `www-tick`, disable the `Sample` trigger, export Firestore through a temporary bucket and delete the bucket, set the Artifact Registry cleanup policy, deploy the paused card with `firebase.paused.json`. Every command has its verification line beside it; nothing here is left to decide.

Needs an authenticated `gcloud` and the console, which is the only reason this is a task rather than a commit. Do it in the same sitting as [find-the-baseline-spend](find-the-baseline-spend.md) — the two are independent, but they need the same login and the baseline is where the money actually is.

## Why this is worth a sitting at all

It saves about $0.40/month. That is not the reason. The reason is that a site whose turn deadlines never fire should not look alive: anyone who still has the link would submit orders that never resolve. The card says so in one page.

Nothing is deleted, so this is reversible: the relight half of the same runbook is the list backwards. The decisions behind it, including what was rejected, are in [docs/design/site-shutdown-cost-reduction.md](../docs/design/site-shutdown-cost-reduction.md).

Resolve this file when the card is up.
