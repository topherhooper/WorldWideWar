# Turning the site down — Design

Date: 2026-09-05
Status: Repo half shipped; the console sitting is `tasks/mothball-the-site.md`

## Goal

Asked as "turn down the site and reduce costs to minimal". The observable version: the next
full month's invoice on billing account `00E12D-1377B4-9CA7C4` lands at ~$0.20 — the Cloud
DNS zone and nothing else — with a Firestore export in hand and a written path to relight.

The finding that reframes the whole thing is in [cost.md](../cost.md): **the site is already
nearly free.** Everything but the $0.20/month DNS zone sits inside a free tier, so turning
the site down saves about $0.40/month. The ~$9–10/month the account actually spends predates
the game — May, June and July invoices of ~$10 with nothing deployed — and almost certainly
belongs to a Cloud SQL instance somewhere else on the billing account. That is ~95% of the
money and none of it is this repo; it is `tasks/find-the-baseline-spend.md`.

So this work is not a cost measure. It is worth doing because a site whose deadlines never
fire should not look alive: friends who still have the link would submit orders into a void.

## Decisions

| Decision                                                                                                                              | Rejected, and why                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mothball**: pause the tick and the deploy trigger, export Firestore, keep everything else                                           | _Deep mothball_ (also delete Cloud Run and the images): saves ~$0.05/month, and relight becomes a re-provision — the service URL changes on recreate and `TICK_AUDIENCE` was set out-of-band, so the tick comes back unable to authenticate. _Scorched earth_ (delete the data and the project): no relight path and every finished game's history gone, for the same ~$0.20/month end state. |
| **Paused notice**: one last Hosting deploy ships a "game is paused" face, then the tick pauses                                        | _Leave it as-is_: zero work, but the site looks alive while nothing resolves. _Take Hosting down entirely_: saves $0 (Hosting is free at this scale) and makes relight slower — the domain re-verifies and a managed certificate takes hours to reissue.                                                                                                                                      |
| **Static card only**: the paused deploy replaces the Hosting bundle with one static page — no sign-in, no old games, zero API traffic | _Read-only site_ (banner plus submission disabled): keeps history browsable, but leaves sign-in, the API and the 15s poll live, and is a real feature to build and test for a site nobody should be using.                                                                                                                                                                                    |
| **Keep the `/unsubscribe` rewrite** in the paused Hosting config, alone among the rewrites                                            | _Zero rewrites_, the literal reading of "zero API traffic": unsubscribe links outlive the pause in people's inboxes, the traffic they generate rounds to zero, and a compliance link that 404s is worse than a service that sleeps.                                                                                                                                                           |
| **Keep the Cloud DNS zone**                                                                                                           | _Delete it_ to reach $0.00: the zone holds the delegated nameservers for all of `topherhooper.com` and the Resend DKIM/SPF/DMARC records for `mail.topherhooper.com`. Deleting it breaks the domain and the mail, not just `play`.                                                                                                                                                            |
| **The card lives in `paused/`**, its own top-level directory, deployed by `firebase.paused.json`                                      | _Inside `packages/web/dist`_: `pnpm build` empties that directory, so the card would vanish on the next ordinary build. _A flag inside the app bundle_: needs a build and a Cloud Run deploy to flip, which is the opposite of what a pause is for.                                                                                                                                           |

## What shipped, and what did not

The line was drawn so that the console sitting has nothing left to decide. Everything that
could live in the repo is here: the card (`paused/index.html` — one file, no script tag, no
font or image fetch, so a mothballed site makes no requests at all), the Hosting config that
ships only it (`firebase.paused.json`), and the runbook, "Mothball and relight" in
[deployment.md](../deployment.md), with each command's verification line beside it. The
runbook is written for someone months from a context where nobody remembers why.

No infrastructure was touched. Pausing the tick, disabling the trigger, exporting Firestore,
setting the Artifact Registry cleanup policy and deploying the card all need an authenticated
`gcloud`, and none of them can be done from the repo.

## Assumptions, stated rather than asked

- "Minimal" means near-$0/month while **keeping the data and the ability to relight** — not
  deleting the project or the Firestore contents. If the intent is scorched earth, the
  decisions above invert.
- The pause lands whenever it lands. A game in flight freezes mid-turn and resumes on
  relight; state is in Firestore and the engine is pure, so nothing is lost. Whether a game
  should finish first is a question of when to flip the switch, not of what to build.
- The Firestore export goes to a temporary bucket that is deleted afterwards, so the backup
  adds $0/month rather than a lingering storage line.

The one consequence worth repeating out of the runbook: **every deadline missed during the
pause fires on the first tick after it.** `runTick` resolves every active game past its
`deadlineAt`, so a long pause ends with all of them resolving at once, on orders submitted
before the pause, with the reports mailed. Correct, and abrupt.
