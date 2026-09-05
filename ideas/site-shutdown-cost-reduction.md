# Turn down the site and reduce costs to minimal

Said as: "I'd like to turn down the site and reduce costs to minimal."

## The one observable thing that would make it real

The next full month's invoice on billing account `00E12D-1377B4-9CA7C4` lands at ~$0.20 —
the Cloud DNS zone and nothing else — with a Firestore export in hand and a written path
to relight the site.

## What was read, and what it said

- `docs/cost.md` — the whole analysis already exists. The site itself costs
  **$0.30–0.60/month**; everything but DNS sits inside free tiers. The real money is a
  **~$9–10/month baseline that predates the game** (May/Jun/Jul invoices of ~$10 with
  nothing deployed), almost certainly a Cloud SQL instance somewhere on the billing
  account — possibly in a different project. Turning down the site without killing the
  baseline saves under $1/month.
- `tasks/find-the-baseline-spend.md` — the baseline hunt is already the open P0 task. It
  needs Billing → Reports and an authenticated `gcloud`; it cannot be done from the repo.
- `docs/deployment.md` — the inventory of what "the site" is: Firebase Hosting +
  `play` CNAME, Cloud Run `www-api` (`min 0 / max 1`, `cloudbuild.yaml:28-29`), Cloud
  Scheduler `www-tick` every minute → `POST /internal/tick`
  (`packages/server/src/app.ts:124`), Firestore, Artifact Registry `www` (no cleanup
  policy — every image ever pushed is still stored), Cloud Build trigger `Sample` on
  push-to-main, Resend mail, two secrets, Cloud DNS zone `topherhooper-com`.

## What "turn down" actually touches, cheapest first

1. **The baseline** — the existing P0 task. This is ~95% of the money and none of it is
   this repo. Everything else here is the remaining ~$0.40.
2. **Cloud Scheduler `www-tick`** — pause the job. Free anyway (first 3 jobs), but it is
   the only thing generating traffic when nobody plays.
3. **Cloud Build trigger `Sample`** — disable it so pushes to `main` stop deploying (and
   stop spending build minutes, free tier or not).
4. **Cloud Run `www-api`** — already scales to zero with no traffic once the tick is
   paused; deleting it outright is optional and saves $0. Deleting removes the relight
   path (`TICK_AUDIENCE` was set out-of-band and the URL changes on recreate —
   `docs/deployment.md` "Cloud Run env").
5. **Artifact Registry** — either run the cleanup policy from `docs/cost.md` or delete
   the `www` repo entirely. This is the only line that grows on its own.
6. **Firestore** — export first (`gcloud firestore export`), then leave it; reads/writes
   at zero traffic cost $0, and deleting loses every finished game's history.
7. **Firebase Hosting** — free at this scale. Leaving the static site up (perhaps with a
   "paused" notice) costs nothing; taking it down saves nothing.
8. **Cloud DNS zone `topherhooper-com`** — **keep it**. It is $0.20/month and it holds
   the delegated nameservers for all of `topherhooper.com`, plus the Resend
   DKIM/SPF/DMARC records for `mail.topherhooper.com`. Deleting the zone breaks the whole
   domain, not just `play`.

## Decisions

| Decision                                                                               | Rejected, and why                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Mothball**: pause tick + deploy trigger, export Firestore, keep all                  | _Deep mothball_ (also delete Cloud Run + images): saves ~$0.05/mo but relight means re-provisioning and `TICK_AUDIENCE` changes on recreate. _Scorched earth_ (delete data + project): no relight path, game history gone, for the same ~$0.20/mo end state. |
| **Paused notice**: one last deploy ships a "game is paused" face, then the tick pauses | _Leave as-is_: zero work, but the site looks alive while deadlines never fire — friends submit orders into a void. _Take hosting down_: saves $0 (Hosting is free) and makes relight slower (domain re-verify, cert reissue takes hours).                    |

## Assumptions made instead of asking

- "Minimal" means near-$0/month while **keeping the data and the ability to relight** —
  not deleting the GCP project or the Firestore contents. If the intent is scorched
  earth, say so and steps 4–7 change.
- The domain (`topherhooper.com` DNS zone) stays, since it serves more than this game.
- The ~$9/month baseline is in scope — "reduce costs to minimal" is mostly that task, and
  this idea should absorb or sit beside `find-the-baseline-spend` rather than duplicate
  it.
- Almost all of this is console/`gcloud` work, not repo work. The repo-side residue is
  small: a runbook section in `docs/deployment.md` ("How to pause the site, how to
  relight it"), possibly a static "paused" page, and resolving/merging the tasks.
