# What this project costs, and what actually spends it

Written 2026-08-25, after the billing account crossed its $15 budget on Aug 22 and the
question "we need to fix the site" turned out to have almost nothing to do with the site.

Two facts do most of the work here, and both are counterintuitive enough to be worth
stating before the evidence:

1. **A GCP budget is an alert, not a cap.** Crossing it sends mail and changes nothing
   else. No service is throttled, suspended or shut off at 100%. Nothing went down on
   Aug 22, and nothing will at 200%. A budget only stops spend if you wire its Pub/Sub
   topic to a function that detaches the billing account, which this project has not
   done — and which you probably do not want, because detaching billing deletes Cloud
   Run services and can drop Firestore.
2. **The recurring cost is not World Wide War.** The site launched on 2026-08-12. The
   billing account was already spending ~$9–10 a month in May, June and July, when this
   project consisted of nothing deployed at all.

## The evidence

Payments land on the 1st for the previous month, so the invoice month is shifted:

| Month billed | Paid      | Amount               |
| ------------ | --------- | -------------------- |
| April        | May 1     | $21.95               |
| May          | Jun 1     | $10.09               |
| June         | Jul 1     | $9.77                |
| July         | Aug 1     | $10.04               |
| August       | in flight | ≥$15.00 as of Aug 22 |

The budget alerts date the spend within August, which is what makes the shape readable.
Budget is $15.00, named `low cost - 15`, on billing account `00E12D-1377B4-9CA7C4`:

| Date   | Threshold | Implied spend | Rate since previous |
| ------ | --------- | ------------- | ------------------- |
| Aug 5  | 7%        | $1.05         | $0.26/day           |
| Aug 17 | 90%       | $13.50        | **$1.04/day**       |
| Aug 22 | 100%      | $15.00        | $0.30/day           |

The same 7%-by-the-4th alert fired in May, June, July and August. That is a flat
**~$0.27/day, ~$8–10/month baseline** that is present in every month regardless of what
this repo is doing.

The August overage is the middle row, and it is a spike with a start and an end. Between
Aug 5 and Aug 17 the rate quadrupled, then fell straight back to baseline. That window is
exactly the launch: Firebase project created Aug 12, `play.topherhooper.com` cut over Aug
13, the deploy workflow provisioned Aug 14 — the week `docs/deployment.md` records as
"five identical 403s" of IAM debugging. Roughly $12 of one-off setup, mostly Cloud Build
minutes, not a new recurring cost.

So August lands near $17–18, and **September, left alone, lands back at ~$10** — over a
$10 budget, entirely on spend that predates the game.

## The baseline is almost certainly Cloud SQL

Google sent this account "you have projects using Cloud SQL" notices on 2026-06-15 and
again on 2026-08-06, so an instance exists somewhere on the account right now. World Wide
War does not use Cloud SQL — state is Firestore (`docs/deployment.md`). The smallest
always-on instance, `db-f1-micro`, is ~$7.70/month before storage, which lands within
pennies of the June ($9.77) and July ($10.04) invoices.

A Cloud SQL instance bills for existing, not for being used. An idle one costs the same
as a busy one, which is why this has been invisible for four months.

Confirm and kill it — this cannot be done from the repo, it needs a console or an
authenticated `gcloud`:

```bash
# Which services actually spend. Do this first; everything below is a guess until you have.
#   Console → Billing → Reports, group by Service, last 90 days.

gcloud sql instances list --project fluted-citizen-269819
gcloud compute instances list --project fluted-citizen-269819   # the other classic always-on
gcloud sql instances describe <name> --project <project>        # check it is genuinely unused
```

If it is dead weight, `gcloud sql instances delete <name>` — take an export first if there
is any doubt; the delete is not recoverable. Stopping rather than deleting still bills for
storage, and Cloud SQL restarts a stopped instance after 90 days.

Note that the billing account may span more than one project. `fluted-citizen-269819` is
the one this game lives in; the Cloud SQL instance need not be.

## What this repo can spend, in order

Ranked by what it actually costs, not by how suspicious it looks.

**Cloud Build — was real, now fixed.** `cloudbuild.yaml` asked for `machineType:
E2_HIGHCPU_8`. Cloud Build's 2,500 free build-minutes a month apply to `e2-standard-2` in
the default pool and to nothing else: naming any other machine type forfeits the free tier
for every build from the first minute. So every push to `main` was billed at the highcpu
rate while 2,500 free minutes went unclaimed — and the launch week ran a lot of builds.
Removed, with a `timeout: 1800s` added because the default 10 minutes is tight on a 2-vCPU
machine and a build that times out costs the same minutes as one that finishes. Builds get
slower; they stop costing money.

**Artifact Registry — small, but it only grows.** Every push tags `api:$COMMIT_SHA` and
nothing ever deletes one. At ~200MB an image and $0.10/GB/month past the first 0.5GB free,
that is cents now and creeps upward forever. A cleanup policy fixes it permanently; run it
once against the `www` repo:

```bash
cat > /tmp/cleanup.json <<'JSON'
[
  { "name": "keep-recent",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": 5 } },
  { "name": "delete-old",
    "action": { "type": "Delete" },
    "condition": { "olderThan": "30d" } }
]
JSON

# --dry-run first: it logs what WOULD be deleted without deleting it.
gcloud artifacts repositories set-cleanup-policies www \
  --location=us-central1 --project=fluted-citizen-269819 \
  --policy=/tmp/cleanup.json --dry-run
```

Keep rules win over delete rules, so the five most recent images survive regardless of
age — rollback by SHA (`docs/deployment.md`) keeps working for the last five deploys.
Re-run with `--no-dry-run` once the logs look right.

**Cloud Run, Firestore, Scheduler — not the problem, and worth not "fixing".** Checked
rather than assumed, because the every-minute tick looks alarming and isn't:

- The tick is 43,200 requests/month against a free tier of 2 million. At `min-instances=0`
  with default request-based billing, CPU is billed only while a request is in flight:
  ~43,200 × ~0.3s ≈ 13,000 vCPU-seconds against 180,000 free.
- `runTick` reads active games once per minute — ~1,440 queries/day, a few document reads
  each, against a 50,000 reads/day free tier.
- Cloud Scheduler bills nothing for the first 3 jobs; this account uses one.
- The web client (`packages/web/src/useGame.ts`) polls every 15s, or 5s once orders are
  locked, and `document.hidden` suppresses the fetch entirely for a backgrounded tab — so
  a tab left open overnight costs nothing.

Slowing the tick would trade real deadline precision (turn presets are 60 and 1440
minutes; `MIN_TURN_MINUTES` is 5) for a saving of $0.00. Don't.

**Cloud DNS** is $0.20/month for the `topherhooper-com` zone, and is the price of the
domain working.

## If the budget needs to be a cap

There is no built-in way. The only real mechanism is a budget → Pub/Sub → Cloud Function
that calls `projects.updateBillingInfo` with an empty billing account. Understand what that
does before building it: detaching billing deletes Cloud Run services and can drop
Firestore data. For a five-player game with a $10 ceiling, deleting the Cloud SQL instance
and keeping the free tiers is the whole answer, and it needs no machinery.
