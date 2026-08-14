# Selective CI and Deploy Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run only the CI jobs a changeset can plausibly break, and stop redeploying the app for documentation edits, per the approved spec `docs/superpowers/specs/2026-08-14-selective-ci-and-deploy-design.md`.

**Architecture:** A new dependency-free workspace package `tools/ci` holds one pure, unit-tested function mapping changed paths to four booleans (`test`, `serverTest`, `mapgen`, `balance`), plus a thin CLI that shells out to `git diff` and writes those booleans to `$GITHUB_OUTPUT`. `.github/workflows/ci.yml` gains a `changes` job that runs the CLI; `check`, `mapgen` and `balance` gain `needs: changes` and `if:` guards — job-level, so skipped jobs still report a status to branch protection. The deploy half needs no code: Cloud Build's `ignoredFiles` on the push-to-`main` trigger is set from the same doc globs the classifier uses, documented as a one-time human step in `docs/deployment.md`.

**Tech Stack:** TypeScript ESM monorepo (pnpm), Vitest, Fastify + Firestore (server, tested against the emulator), React 19 + react-router (web).

## Global Constraints

- **The classifier fails open.** An unrecognized path lands in `root` and turns every gate back on; an unusable base commit selects `RUN_EVERYTHING`. Getting the table wrong must cost a wasted sweep, never a missed regression.
- **Job names in `ci.yml` do not change.** `Typecheck, lint and test`, `Map generator sweep` and `Balance and social gates` are matched by branch protection rules on `main`.
- **Gating is job-level `if:`, never a workflow-level `paths:` filter.** A job skipped by `if:` reports a `skipped` conclusion that branch protection accepts; a workflow filtered by `paths:` never reports at all and a required check waits forever.
- `format:check`, `lint` and `typecheck` stay unconditional. Prettier formats Markdown, and this repo has already shipped ten misformatted files to CI.
- `tools/ci` takes no dependencies — not even `@www/engine`. It is the one thing that must run before anything is built.
- Adding a workspace package changes `pnpm-lock.yaml`; commit it, or CI's `pnpm install --frozen-lockfile` fails.
- Commands: `pnpm exec vitest run tools/ci` for the unit tests; full gate `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm test:server`. `pnpm format:check` is unreliable locally — use `pnpm exec prettier --check --end-of-line auto .`
- Commit after every task, ticking that task's checkboxes in this file in the same commit.

## File Structure

| File                            | Role                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `tools/ci/package.json`         | Workspace member `@www/ci`, no dependencies                                  |
| `tools/ci/tsconfig.json`        | Composite project, no references                                             |
| `tools/ci/src/changed-areas.ts` | The pure mapping: changed paths → `CiSelection`; `DOC_GLOBS` for Cloud Build |
| `tools/ci/src/main.ts`          | CLI: `git diff` → `$GITHUB_OUTPUT`; `--ignored-files` prints `DOC_GLOBS`     |
| `tsconfig.json`                 | Add the `./tools/ci` project reference                                       |
| `.github/workflows/ci.yml`      | New `changes` job; `needs:` and `if:` guards on the other three              |
| `docs/deployment.md`            | The trigger's `ignoredFiles`, and what CI now skips                          |
| `CLAUDE.md`                     | Two lines: which sweeps a change actually triggers                           |

Tests: `tools/ci/src/changed-areas.test.ts` (picked up by the existing `tools/*/src/**/*.test.ts` include in `vitest.config.ts`).

## Prerequisites (blocked on human)

Applying the deploy filter needs GCP credentials and touches configuration that does not
live in this repository. Task 4 writes the runbook entry; someone with access runs it:

```bash
gcloud builds triggers update github Sample \
  --region=us-central1 --project=fluted-citizen-269819 \
  --ignored-files='docs/**,*.md,**/*.md,.claude/**'
```

Until that runs, deployment behaves exactly as it does today — every push to `main`
deploys. Nothing else in this plan depends on it.

---

### Task 1: The changed-path classifier

**Files:**

- Create: `tools/ci/package.json` (~10 lines)
- Create: `tools/ci/tsconfig.json` (~8 lines)
- Create: `tools/ci/src/changed-areas.ts` (~70 lines)
- Create: `tools/ci/src/changed-areas.test.ts` (~75 lines)
- Modify: `tsconfig.json` (add one reference)

**Interfaces:**

- Consumes: nothing.
- Produces: `CiSelection`, `RUN_EVERYTHING`, `DOC_GLOBS`, `isDocPath`, `selectCiJobs` from `tools/ci/src/changed-areas.ts`. Task 2 and the workflow depend on these exact names, and on the field names `test` / `serverTest` / `mapgen` / `balance` becoming `$GITHUB_OUTPUT` keys verbatim.

- [ ] **Step 1: Write the failing test** — `tools/ci/src/changed-areas.test.ts` (new file):

```ts
import { describe, expect, it } from 'vitest';
import { DOC_GLOBS, RUN_EVERYTHING, isDocPath, selectCiJobs } from './changed-areas.js';

describe('isDocPath', () => {
  it('classifies docs, Markdown anywhere, and agent config as documentation', () => {
    expect(isDocPath('docs/deployment.md')).toBe(true);
    expect(isDocPath('README.md')).toBe(true);
    expect(isDocPath('CLAUDE.md')).toBe(true);
    expect(isDocPath('packages/web/README.md')).toBe(true);
    expect(isDocPath('.claude/settings.json')).toBe(true);
  });

  it('classifies source as source, whatever it contains', () => {
    expect(isDocPath('packages/engine/src/resolve.ts')).toBe(false);
    expect(isDocPath('.github/workflows/ci.yml')).toBe(false);
    expect(isDocPath('pnpm-lock.yaml')).toBe(false);
  });
});

describe('selectCiJobs', () => {
  it('selects nothing for a docs-only changeset', () => {
    expect(
      selectCiJobs(['docs/superpowers/ideas/2026-08-14-tier-list-cues.md', 'README.md']),
    ).toEqual({ test: false, serverTest: false, mapgen: false, balance: false });
  });

  it('selects everything for an engine change', () => {
    expect(selectCiJobs(['packages/engine/src/resolve.ts'])).toEqual(RUN_EVERYTHING);
  });

  it('runs the server suite but no sweeps for a server change', () => {
    expect(selectCiJobs(['packages/server/src/games.ts'])).toEqual({
      test: true,
      serverTest: true,
      mapgen: false,
      balance: false,
    });
  });

  it('runs only the Vitest suite for a web change', () => {
    expect(selectCiJobs(['packages/web/src/pages/Home.tsx'])).toEqual({
      test: true,
      serverTest: false,
      mapgen: false,
      balance: false,
    });
  });

  it('runs the balance sweep when the harness itself changes', () => {
    expect(selectCiJobs(['tools/simulate/src/report.ts'])).toEqual({
      test: true,
      serverTest: false,
      mapgen: false,
      balance: true,
    });
  });

  it('runs everything for anything it does not recognize', () => {
    expect(selectCiJobs(['.github/workflows/ci.yml'])).toEqual(RUN_EVERYTHING);
    expect(selectCiJobs(['pnpm-lock.yaml'])).toEqual(RUN_EVERYTHING);
    expect(selectCiJobs(['packages/newthing/src/index.ts'])).toEqual(RUN_EVERYTHING);
  });

  it('takes the union of a mixed changeset, not the intersection', () => {
    expect(selectCiJobs(['docs/deployment.md', 'packages/engine/src/rng.ts'])).toEqual(
      RUN_EVERYTHING,
    );
  });

  it('selects nothing when nothing changed', () => {
    expect(selectCiJobs([])).toEqual({
      test: false,
      serverTest: false,
      mapgen: false,
      balance: false,
    });
  });
});

describe('the safety net', () => {
  it('RUN_EVERYTHING has every gate on', () => {
    expect(Object.values(RUN_EVERYTHING).every(Boolean)).toBe(true);
  });

  it('DOC_GLOBS is the Cloud Build spelling of isDocPath', () => {
    expect(DOC_GLOBS).toEqual(['docs/**', '*.md', '**/*.md', '.claude/**']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tools/ci`
Expected: FAIL — `Cannot find module './changed-areas.js'`.

- [ ] **Step 3: Implement**

`tools/ci/package.json`:

```json
{
  "name": "@www/ci",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc --build"
  }
}
```

`tools/ci/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts"]
}
```

`tools/ci/src/changed-areas.ts`:

```ts
/**
 * Which CI jobs a changeset can plausibly break.
 *
 * Every pull request used to run all three jobs: the check job with its Java-
 * and-emulator server suite, a 300-seed mapgen sweep, and an 800-game balance
 * run. A changeset that only edits `docs/` cannot break any of them.
 *
 * The mapping is deliberately coarse, and it fails open — an unrecognized path
 * turns every gate back on. Getting this table wrong should cost a wasted
 * sweep, never a missed regression.
 */

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

/** What runs when we cannot tell what changed. Not knowing is never a reason to run less. */
export const RUN_EVERYTHING: CiSelection = {
  test: true,
  serverTest: true,
  mapgen: true,
  balance: true,
};

/**
 * `isDocPath` in Cloud Build's glob spelling, for the deploy trigger's
 * `ignoredFiles`. Keep the two in step: `main.ts --ignored-files` prints this
 * list and `docs/deployment.md` tells you to paste it into `gcloud`.
 *
 * `*.md` and `**\/*.md` are both listed on purpose. Whether `**` matches zero
 * leading segments is exactly the kind of thing glob implementations disagree
 * about, and getting it wrong here means a README-only push redeploys.
 */
export const DOC_GLOBS: readonly string[] = ['docs/**', '*.md', '**/*.md', '.claude/**'];

/** Package prefixes the selection knows about; anything else counts as root. */
const AREAS = ['packages/engine/', 'packages/server/', 'packages/web/', 'tools/'] as const;

/**
 * Documentation, decided by path alone. A comment-only edit inside a source
 * file is not a doc change: telling the difference means parsing diff hunks per
 * language, and being wrong there skips the tests that mattered.
 */
export function isDocPath(path: string): boolean {
  return path.startsWith('docs/') || path.startsWith('.claude/') || path.endsWith('.md');
}

export function selectCiJobs(changedPaths: readonly string[]): CiSelection {
  const code = changedPaths.filter((path) => !isDocPath(path));
  const touches = (prefix: string): boolean => code.some((path) => path.startsWith(prefix));

  const engine = touches('packages/engine/');
  const server = touches('packages/server/');
  const tools = touches('tools/');
  // The workflow itself, the lockfile, tsconfig, the Dockerfile, cloudbuild.yaml
  // — anything outside the known packages is assumed to change how the whole
  // tree builds.
  const root = code.some((path) => !AREAS.some((prefix) => path.startsWith(prefix)));

  return {
    test: code.length > 0,
    serverTest: engine || server || root,
    mapgen: engine || root,
    balance: engine || tools || root,
  };
}
```

In the root `tsconfig.json`, add the reference so `pnpm typecheck` covers the new package:

```json
    { "path": "./tools/ci" },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm install` (registers the workspace member and updates `pnpm-lock.yaml`), then
`pnpm exec vitest run tools/ci && pnpm typecheck && pnpm lint`.

- [ ] **Step 5: Commit** — `feat(ci): classify changed paths into a CI job selection`

---

### Task 2: The CLI that publishes the selection

**Files:**

- Create: `tools/ci/src/main.ts` (~50 lines)

**Interfaces:**

- Consumes: `DOC_GLOBS`, `RUN_EVERYTHING`, `selectCiJobs`, `CiSelection` from Task 1.
- Produces: `pnpm exec tsx tools/ci/src/main.ts <base-sha>` writing `test=`, `serverTest=`, `mapgen=`, `balance=` to `$GITHUB_OUTPUT`; `--ignored-files` printing the deploy globs. Task 3 reads those keys; Task 4 documents the flag.

No unit test: this file is `git` plumbing and `$GITHUB_OUTPUT` formatting, and the honest
test of it is the first pull request that runs the workflow. Verify it by hand instead.

- [ ] **Step 1: Implement** — `tools/ci/src/main.ts` (new file):

```ts
/**
 * Publishes the CI job selection for the current changeset.
 *
 *   pnpm exec tsx tools/ci/src/main.ts <base-sha>
 *   pnpm exec tsx tools/ci/src/main.ts --ignored-files
 *
 * Appends `key=value` lines to $GITHUB_OUTPUT when the workflow sets it, and
 * always prints them, so the same command explains itself when run locally.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { DOC_GLOBS, RUN_EVERYTHING, selectCiJobs, type CiSelection } from './changed-areas.js';

const NO_COMMIT = '0000000000000000000000000000000000000000';

/** Null when the base is unusable: a first push, a force-push, or a shallow clone. */
function changedPaths(base: string): string[] | null {
  if (base === '' || base === NO_COMMIT) return null;
  try {
    // Three dots, so a pull request is compared against its merge base rather
    // than a moving `main` — an unrelated merge cannot widen the selection.
    const diff = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
      encoding: 'utf8',
    });
    return diff.split('\n').filter((line) => line !== '');
  } catch {
    return null;
  }
}

function main(): void {
  const arg = process.argv[2] ?? '';
  if (arg === '--ignored-files') {
    console.log(DOC_GLOBS.join(','));
    return;
  }

  const paths = changedPaths(arg);
  const selection: CiSelection = paths === null ? RUN_EVERYTHING : selectCiJobs(paths);
  const lines = Object.entries(selection).map(([gate, run]) => `${gate}=${run}`);

  console.log(
    paths === null
      ? 'base commit unknown — running everything'
      : `${paths.length} changed path(s):\n${paths.join('\n')}`,
  );
  console.log(lines.join('\n'));

  const output = process.env.GITHUB_OUTPUT;
  if (output !== undefined) appendFileSync(output, `${lines.join('\n')}\n`);
}

main();
```

- [ ] **Step 2: Verify by hand**

```bash
pnpm exec tsx tools/ci/src/main.ts --ignored-files          # docs/**,*.md,**/*.md,.claude/**
pnpm exec tsx tools/ci/src/main.ts origin/main              # this branch's own selection
pnpm exec tsx tools/ci/src/main.ts ''                       # base commit unknown → all true
pnpm typecheck && pnpm lint
```

- [ ] **Step 3: Commit** — `feat(ci): publish the job selection to $GITHUB_OUTPUT`

---

### Task 3: Gate the workflow on the selection

**Files:**

- Modify: `.github/workflows/ci.yml` (new `changes` job at the top of `jobs:`; `needs:`/`if:` on the other three; two step-level `if:` in `check`)

**Interfaces:**

- Consumes: the `$GITHUB_OUTPUT` keys from Task 2.
- Produces: `needs.changes.outputs.{test,serverTest,mapgen,balance}`.

- [ ] **Step 1: Add the `changes` job** — insert as the first entry under `jobs:`:

```yaml
# Which of the jobs below a changeset can plausibly break. A cached install to
# gate up to twenty minutes of sweeps; a separate job rather than an output of
# `check`, because making the sweeps wait on the server suite would trade the
# saving straight back for latency.
changes:
  name: Detect changed areas
  runs-on: ubuntu-latest
  outputs:
    test: ${{ steps.select.outputs.test }}
    serverTest: ${{ steps.select.outputs.serverTest }}
    mapgen: ${{ steps.select.outputs.mapgen }}
    balance: ${{ steps.select.outputs.balance }}
  steps:
    - uses: actions/checkout@v4
      with:
        # The classifier diffs against a base commit, which a shallow clone
        # does not have. Without this it fails open and runs everything.
        fetch-depth: 0

    - uses: pnpm/action-setup@v4
      with:
        run_install: false

    - uses: actions/setup-node@v4
      with:
        node-version: ${{ env.NODE_VERSION }}
        cache: pnpm

    - run: pnpm install --frozen-lockfile

    - id: select
      run: pnpm exec tsx tools/ci/src/main.ts "$BASE_SHA"
      env:
        BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}
```

- [ ] **Step 2: Guard the three existing jobs**

`check` keeps running unconditionally — `format:check`, `lint` and `typecheck` cover
Markdown too — but gains `needs` and two step guards:

```yaml
check:
  name: Typecheck, lint and test
  needs: changes
  runs-on: ubuntu-latest
```

```yaml
- run: pnpm typecheck
- if: needs.changes.outputs.test == 'true'
  run: pnpm test
```

and, on the emulator tail, so a docs-or-web-only change does not boot Java:

```yaml
- uses: actions/setup-java@v4
  if: needs.changes.outputs.serverTest == 'true'
  with:
    distribution: temurin
    java-version: '21'
- name: Server integration tests
  if: needs.changes.outputs.serverTest == 'true'
  run: pnpm test:server
```

`mapgen` and `balance` are guarded whole. Their `name:` values must not change — branch
protection on `main` matches them by name, and a job skipped by `if:` still reports:

```yaml
mapgen:
  name: Map generator sweep
  needs: changes
  if: needs.changes.outputs.mapgen == 'true'
  runs-on: ubuntu-latest
```

```yaml
balance:
  name: Balance and social gates
  needs: changes
  if: needs.changes.outputs.balance == 'true'
  runs-on: ubuntu-latest
```

- [ ] **Step 3: Verify** — `pnpm exec prettier --check --end-of-line auto .github/workflows/ci.yml`, and re-read the diff for the two invariants: job names unchanged, and no `paths:` filter anywhere.

- [ ] **Step 4: Commit** — `ci: gate the sweeps and the server suite on changed areas`

---

### Task 4: Document the deploy filter

**Files:**

- Modify: `docs/deployment.md` (the `## Pipeline` section, ~line 20)
- Modify: `CLAUDE.md` (the `## Before you push` CI paragraph, ~line 60)

**Interfaces:**

- Consumes: `main.ts --ignored-files` from Task 2.
- Produces: nothing in code. This is the runbook entry for the human prerequisite above.

- [ ] **Step 1: Extend `docs/deployment.md`** — after the paragraph describing the trigger,
      add:

````markdown
Documentation-only pushes do not deploy. The trigger carries an `ignoredFiles` filter; when
every path in a push matches it, Cloud Build never queues a build. The globs are the same
ones CI treats as documentation, printed by the classifier so the two cannot drift:

```bash
pnpm exec tsx tools/ci/src/main.ts --ignored-files
gcloud builds triggers update github Sample \
  --region=us-central1 --project=fluted-citizen-269819 \
  --ignored-files='docs/**,*.md,**/*.md,.claude/**'
```

One non-documentation file in the push and the whole build runs — the filter is a union,
not a per-file decision, so there is no such thing as a partial deploy. A manual
`gcloud builds submit` bypasses the trigger entirely and therefore always deploys, which is
what typing that command means.
````

- [ ] **Step 2: Extend `CLAUDE.md`** — in the CI paragraph under `## Before you push`, note
      that the sweeps are now conditional and where the table lives:

```markdown
Which of those actually run depends on what you touched: `.github/workflows/ci.yml` gates
the server suite, the mapgen sweep and the balance sweep on
`tools/ci/src/changed-areas.ts`, which maps changed paths to jobs and fails open on
anything it does not recognize. Engine changes still expect both sweeps.
```

- [ ] **Step 3: Verify** — `pnpm exec prettier --check --end-of-line auto docs/deployment.md CLAUDE.md`

- [ ] **Step 4: Commit** — `docs(deploy): filter the Cloud Build trigger on doc-only pushes`

---

## Self-review notes

_(filled in during implementation)_
