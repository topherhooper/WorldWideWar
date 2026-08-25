---
status: open
kind: chore
area: deploy
priority: 0
blocked-by: ''
---

# Find and delete the ~$9/month that predates the game

## Next step

Open **Billing → Reports**, group by **Service**, last 90 days. That single screen answers this and nothing else does — every line below is a hypothesis until it is read.

Then, if it confirms Cloud SQL: `gcloud sql instances list --project fluted-citizen-269819`, check the instance is genuinely unused, export if there is any doubt, and delete it. Stopping is not enough — a stopped instance still bills storage and Cloud SQL restarts it after 90 days.

This needs a console or an authenticated `gcloud` and cannot be done from the repo, which is the only reason it is a task rather than a commit.

## What we know

The billing account spent $10.09, $9.77 and $10.04 in May, June and July — before the site existed. It launched 2026-08-12. Whatever this is, it is not World Wide War, and it is the entire $10 budget on its own.

Google sent "you have projects using Cloud SQL" notices on 2026-06-15 and 2026-08-06. This game uses Firestore, not Cloud SQL. A `db-f1-micro` is ~$7.70/month before storage and bills for existing rather than for being used, which is how it stayed invisible for four months. The billing account may span more than one project, so it need not live in `fluted-citizen-269819`.

The August overage on top of that was the launch week, not a new recurring cost: the spend rate quadrupled Aug 12–17 and fell straight back to baseline afterwards. The repo-side half of that is already fixed — `cloudbuild.yaml` no longer forfeits Cloud Build's free tier.

Crossing the budget shut nothing off; a GCP budget is an alert, not a cap.

Full analysis, including the Artifact Registry cleanup policy still worth running once: [docs/cost.md](../docs/cost.md).
