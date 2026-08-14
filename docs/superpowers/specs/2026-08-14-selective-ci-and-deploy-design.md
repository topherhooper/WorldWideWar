# Selective CI and Deploy Triggers — Design

Date: 2026-08-14
Status: Approved pending spec review

## Goal

Stop paying for work a change cannot possibly have broken. Today every pull request runs
all three CI jobs — the full check job including the Java-and-emulator server suite, a
300-seed mapgen sweep, and an 800-game balance run across five table sizes — and every
push to `main` fires the Cloud Build trigger and redeploys Cloud Run and Hosting. A pull
request that only edits `docs/superpowers/ideas/` pays all of it.

Both halves of the dump check out. `.github/workflows/ci.yml` declares
`on: pull_request` with no `paths` filter and three unconditional jobs, so nothing is
skipped for any change. And `docs/deployment.md` records the deploy contract plainly:
"Push to `main` fires the Cloud Build trigger (`Sample`, us-central1)" — the trigger has
no file filter either, so a typo fix in a runbook rebuilds the Docker image, redeploys
`www-api`, and re-uploads the web bundle.

The change is one tested classifier that turns a list of changed paths into four
booleans, a `changes` job that publishes them, `if:` guards on the jobs and steps they
gate, and — for the deploy half — Cloud Build's own `ignoredFiles` on the trigger, set
from the same list the classifier uses.

## Decisions (settled during brainstorming)

| Question                                           | Decision                                                                                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What counts as "relevant"?                         | Per-area, not per-file. Six areas — engine, server, web, tools, docs, root — derived from the changed paths, then composed into one boolean per gated job.                                    |
| Which jobs get gated?                              | The expensive ones: `pnpm test:server`, the mapgen sweep, the balance sweep, and `pnpm test`. `format:check`, `lint` and `typecheck` always run.                                              |
| Is a docs-only change exempt from tests?           | From `pnpm test` and everything slower, yes. From `format:check`/`lint`/`typecheck`, no — Prettier formats Markdown, and this repo has already shipped ten badly formatted docs to CI.        |
| What is a doc change?                              | Path-based only: `docs/**`, any `*.md` anywhere, and `.claude/**`. Nothing else, and never the diff's contents.                                                                               |
| A changeset touching both docs and code?           | Union, never intersection. One non-doc path makes the whole changeset a code change, for CI and for deploy alike.                                                                             |
| Are the mapgen and balance sweeps in scope?        | Yes — they are the prize. Mapgen runs on engine or root changes; balance on engine, tools or root changes.                                                                                    |
| Do required status checks still pass when skipped? | Yes, because gating is job-level `if:`, not workflow-level `paths:`. Job names are unchanged, so existing branch-protection rules keep matching them.                                         |
| What counts as "the app" for deployment?           | Everything that is not a doc. Defining it by exclusion means a new package deploys by default instead of silently not deploying.                                                              |
| Where does the deploy filter live?                 | `ignoredFiles` on the Cloud Build trigger — the mechanism Cloud Build already provides. It is trigger configuration, so applying it is a one-time human step.                                 |
| How does the classifier decide what changed?       | `git diff --name-only <base>...HEAD`, with `<base>` the PR merge base or `github.event.before` on a push. When the base is unavailable, run everything.                                       |
| Who keeps the mapping honest as the repo grows?    | One exported table in `tools/ci/src/changed-areas.ts` with unit tests. An unrecognized path falls into `root`, which runs everything — forgetting to update it over-tests, never under-tests. |

**Rejected:** a per-changed-file → per-test-file map (there is no honest one — the engine's
property tests are cross-cutting by design, and `resolve.test.ts` covers half the package);
splitting `pnpm test` into per-package runs (Vitest is configured once at the root with a
single `include`, so this means a config file per package to save a few seconds); parsing
diff hunks so a comment-only source edit counts as a doc change (a comment parser per
language, and a wrong answer skips tests that mattered); workflow-level `paths:` filters
(the skipped job never reports a status at all, so a required check waits forever — the
exact trap the idea doc asked about); a guard step inside `cloudbuild.yaml` that bails on
docs-only commits (it needs git history in the build workspace, which the tarball
`gcloud builds submit` uploads does not carry, so manual deploys would silently
self-skip); moving deployment into GitHub Actions to reuse `paths:` (a rewrite of the
whole pipeline, plus GCP credentials stored in GitHub, for a filter Cloud Build already
has); `dorny/paths-filter` (a third-party action for logic that fits in forty tested
lines).

## The classifier — `tools/ci`

A new workspace package, alongside `tools/simulate` and `tools/mapviz`, because that is
where this repo's dev tooling lives and because `vitest.config.ts` already collects
`tools/*/src/**/*.test.ts`. It has no dependencies — not even on `@www/engine`.

`tools/ci/src/changed-areas.ts` is pure and tested:

```ts
export interface CiSelection {
  /** `pnpm test` — the whole Vitest run. */
  test: boolean;
  /** `pnpm test:server` — Java 21 plus the Firestore and Auth emulators. */
  serverTest: boolean;
  /** The 300-seed map generator sweep. */
  mapgen: boolean;
  /** The 800-game balance and social gates. */
  balance: boolean;
}

export const RUN_EVERYTHING: CiSelection;
export const DOC_GLOBS: readonly string[];
export function isDocPath(path: string): boolean;
export function selectCiJobs(changedPaths: readonly string[]): CiSelection;
```

Areas, in the order a path is tested against them:

| Area     | Paths                              |
| -------- | ---------------------------------- |
| `docs`   | `docs/**`, `**/*.md`, `.claude/**` |
| `engine` | `packages/engine/**`               |
| `server` | `packages/server/**`               |
| `web`    | `packages/web/**`                  |
| `tools`  | `tools/**`                         |
| `root`   | everything else                    |

`root` is the fallback, and it is why the workflow, `pnpm-lock.yaml`, `tsconfig.base.json`,
`eslint.config.js`, `vitest.config.ts`, the `Dockerfile` and `cloudbuild.yaml` all turn
every gate back on without being enumerated. The composition:

| Gate         | True when                    |
| ------------ | ---------------------------- |
| `test`       | any area other than `docs`   |
| `serverTest` | `engine`, `server` or `root` |
| `mapgen`     | `engine` or `root`           |
| `balance`    | `engine`, `tools` or `root`  |

`selectCiJobs([])` returns all four false — an empty changeset genuinely changed nothing.
The fail-open case is separate and explicit: `tools/ci/src/main.ts` emits
`RUN_EVERYTHING` whenever it cannot determine a base commit, which covers a first push, a
force-push, an all-zero `github.event.before`, and a shallow clone. Not knowing what
changed is never a reason to run less.

`main.ts` is the only part that touches git and the environment. It takes the base ref as
`argv[2]`, shells out to `git diff --name-only <base>...HEAD` (three-dot, so a PR is
compared against its merge base rather than a moving `main`), and writes
`key=value` lines to `$GITHUB_OUTPUT`, falling back to stdout when that is unset so the
same command is runnable locally. `--ignored-files` prints `DOC_GLOBS` one per line, which
is what the deployment runbook tells a human to paste into `gcloud`.

## CI workflow

A new first job, `changes` ("Detect changed areas"), checks out with `fetch-depth: 0`,
installs, and runs the classifier. It costs a cached `pnpm install` — call it half a
minute — to gate up to twenty minutes of sweeps, and it is a separate job rather than an
output of `check` because making `mapgen` and `balance` wait on the full check job would
trade the saving straight back for latency.

The other three jobs gain `needs: changes` and their guards:

- **`check`** always runs. `pnpm install`, `format:check`, `lint` and `typecheck` are
  unconditional — a docs-only pull request still gets its Markdown formatted correctly,
  which is the failure mode this repo actually has. `pnpm test` is guarded on `test`, and
  the `setup-java` step together with `pnpm test:server` on `serverTest`.
- **`mapgen`** is guarded at job level on `mapgen`.
- **`balance`** is guarded at job level on `balance`.

Job names stay byte-identical so branch protection keeps matching them. A job skipped by
`if:` reports a `skipped` conclusion, which branch protection accepts; that is precisely
why the guards are `if:` and not a `paths:` filter on the workflow.

That same acceptance is a hazard from the other direction, so the guards fail open twice
over. They test `!= 'false'` rather than `== 'true'`, and each gated job runs whenever the
workflow was not cancelled, `changes` succeeded or not. Otherwise a `changes` job that
died on a bad install would skip its three dependents, and three skipped required checks
read as a green pull request.

## Deployment

The trigger, not the build config, is where the filter belongs. Cloud Build triggers
accept `ignoredFiles`: when every path in a push matches, the build is not queued at all.
That is the union rule already — one non-doc file in the push and the deploy runs.

Setting it is trigger configuration and therefore a one-time human step, recorded in
`docs/deployment.md` next to the pipeline description with the `gcloud` command spelled
out and the glob list generated by `pnpm exec tsx tools/ci/src/main.ts --ignored-files`,
so the deploy filter and the CI classifier cannot drift apart by hand-editing one of them.
The list spells Markdown twice, `*.md` and `**/*.md` — whether `**` matches zero leading
segments is exactly the thing glob implementations disagree about, and being wrong there
means a `README.md`-only push redeploys, which is the bug this is here to fix.

`cloudbuild.yaml` and `firebase.json` are untouched. So is the manual path added by #15 —
`.github/workflows/deploy.yml` is `workflow_dispatch` only, so there is nothing to filter:
it never fires on its own, and it submits the build directly rather than through the
trigger. Dispatching a docs-only ref still deploys it, which is what someone naming a ref
by hand means.

## Testing

Unit tests on `selectCiJobs`, one per rule and one per area, plus the cases that are easy
to get wrong: a mixed docs-and-code changeset selecting everything a pure code changeset
would; `README.md` and `CLAUDE.md` classified as docs; `packages/web/README.md` classified
as docs rather than web; `.github/workflows/ci.yml` falling into `root` and turning
everything on; an unknown top-level file doing the same; and the empty list selecting
nothing. `RUN_EVERYTHING` is asserted to have every field true, since it is the safety net
and a field added later that defaults to false would silently unmake it.

`main.ts` is left untested — it is git plumbing and `$GITHUB_OUTPUT` formatting, and the
honest test of it is the first pull request that runs the workflow.

## Out of scope for v1

- Splitting `pnpm test` into per-package Vitest runs.
- Any test selection finer than package level — no per-file, per-suite or
  changed-symbol-driven selection.
- Caching or reusing sweep results across commits (e.g. skipping mapgen because an
  identical engine tree already passed on another branch).
- Declaring the Cloud Build trigger in the repo (`gcloud builds triggers import`) so its
  configuration is version controlled. Worth doing; not needed to make the filter work.
- Selective deployment _within_ the pipeline — skipping the Cloud Run deploy when only
  `packages/web` changed, or the Hosting upload when only the server changed. The build is
  a few minutes and the split adds real failure modes (a Hosting bundle whose API contract
  never shipped).
- Path filters for the `push: branches: [main]` half of CI. Post-merge runs on `main` are
  the record that the merged tree is green; they are worth running in full.
- Doc changes skipping `format:check` and `lint`.
