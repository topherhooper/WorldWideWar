# Working in this repo

See `README.md` for what the game is and `docs/deployment.md` for the runbook. This
file covers how work gets done here.

## What done looks like

Five friends in a group chat each open the site once or twice a day, take two minutes
to submit orders without asking anyone how, and come back wanting to argue about what
happened.

That one sentence is the whole spec, and everything here is scored against it. It is
not aspirational — it is the thing that has actually failed. Three of four players
could not enter a valid order without being walked through it over text; see
[docs/onboarding-gaps.md](docs/onboarding-gaps.md). A correct engine nobody can play
is not a game.

## Git is the harness

Everything this repo tracks lives in git or in files in the repo. No database, no
installed tool, no server-side state, **no GitHub Issues**. A bare `git clone` in a
Claude Code **web** sandbox gets the complete picture. That is a hard constraint, not
a preference.

Upstream for the harness itself: `github.com/topherhooper/harness`. This is a copy —
project-specific rules below are expected to diverge from it.

### Where information lives

| Information                          | Home                    | Lifetime            |
| ------------------------------------ | ----------------------- | ------------------- |
| A live idea, before it is work       | `ideas/*.md`            | the branch only     |
| What's open, what's next             | `tasks/*.md`            | until resolved      |
| Working notes on an idea             | branch commits          | until squashed      |
| What happened, and why we believe it | `git log main`          | forever             |
| The full record, dead ends included  | the PR on GitHub        | forever, off `main` |
| Findings worth a narrative           | `docs/<topic>.md`       | append-only         |
| Design decisions and roads not taken | `docs/design/<slug>.md` | append-only         |
| How the game stands right now        | `README.md`             | current state       |
| How to work here                     | this file               | —                   |

**No file holds two kinds.** `README.md` describes the game as it stands; it does not
track tasks and does not narrate how something got resolved. If you catch yourself
writing the open front into a doc, make a `tasks/` file instead.

`docs/design/` holds the specs that predate this harness. They are kept for their
`## Decisions` tables and the rejected alternatives beside them — the one thing in a
spec that git history cannot reconstruct. Add to them when a decision is genuinely
load-bearing; don't write a new one per feature.

### The front door — idea to plan

**A new idea is captured, not started.** When I mention an idea, the default response is stage
1 below — never opening an editor. You may ask **at most one question** before capturing, and
only if you cannot name a concrete outcome without it; anything else you wanted to ask becomes
a stated assumption in the idea doc, where it is cheap to correct.

Four stages. Each is a commit prefix, so the branch log says which stage the idea is in and
nothing has to track it.

**1. Capture** — `git checkout -b idea/<slug> origin/main`, write `ideas/<slug>.md`, commit
`note: <idea in one line>`. The doc holds the idea in the words it was said in, the one
observable thing that would make it real, every link opened and what it actually said,
`file:line` pointers into the code it touches, and the assumptions made instead of asking.
Then **stop** and offer stage 2a and 2b as alternatives — do not pick unless I have said which.

**The idea doc never reaches `main`.** It is deleted in the PR that merges the idea, and its
content disperses into three homes that already exist: the PR body (the finding),
`docs/design/<slug>.md` (decisions worth keeping), and at most one `tasks/` file (the next
action). If nothing survives dispersal, the idea produced nothing — delete the branch, which is
also a result. An idea doc that reaches `main` is a leak; `./scripts/ready.sh` reports it.

**2a. Prototype** (the default — it is cheaper to learn from a thing that runs). Precondition:
`## Prototype goal` in the idea doc, one sentence with an observable outcome. If it cannot be
written, the idea is not ready to prototype; brainstorm instead. Then run **autonomously**, no
check-ins, notebook commits as you go. Shortest path explicitly licenses: no refactoring, no
cleanup, no error handling the goal does not need, no tests unless the test is the goal,
hardcode it, skip the abstraction. Prototype code is notebook — allowed to be embarrassing,
expected to be thrown away.

**Stop at the second surprise.** Work around the first unexpected blocker and note it; the
second one ends the run. That is a count rather than a judgement, because a rewrite arrived at
one increment at a time is defensible at every step. Two endings, both results:

- it worked → PR titled `<area>: <what changed>`, body written as a finding
- it cannot be done without major changes → write `## Why not` (what the change actually is,
  what it costs, what would have to be true to make it worth doing), PR titled
  `ruled-out: <idea>`, and **merge it** so `main` carries the reason and the idea is not
  re-proposed in six months

**2b. Brainstorm** — one question per turn, only questions whose answer changes what gets
built. Append `## Decisions` to the idea doc, one row per decision with what was rejected and
why, committing `decision: <what was chosen>`. The rejections are the durable half: they are
the only thing in the file git cannot reconstruct.

**3. Plan** — only after brainstorming. Append `## Route`: **prose, no checkboxes**, committed
`plan:`. A list of ticked steps is recoverable from the PR and the log, so the only copy that
outlives the work is a stale one. The residue on `main` is exactly two things:
`docs/design/<slug>.md` for the decisions and route, and **one** `tasks/` file for the next
action. A plan that wants to open more than one task has not picked a first step — say so.

**Branch commits on an idea branch keep using conventional commits for code**; `note:`,
`decision:` and `plan:` sit alongside them and mark the stage, so a capture commit is `note:`
even on a branch whose other commits are `feat(engine):`.

#### What to delegate to a subagent

Delegate the stages whose output is a diff; keep the ones whose output is a question. Capture,
brainstorm and plan stay in the main session because the judgement in them is mine.
**Prototyping**, and the **dispersal** work at merge — writing `docs/design/` from the
`decision:` commits, deleting the idea doc, drafting the PR body from the branch log, running
the formatter — go to a subagent on the cheapest model that can do the job.

That is safe here specifically because the record is the branch log rather than the transcript:
a subagent that commits `try:` and `dead-end:` leaves exactly the trace I would, and discarding
its context afterwards costs nothing. The test for handing something off is the same as the
precondition for prototyping — **if the goal cannot be stated in one paragraph, it is not ready
to delegate.**

### The open front — `tasks/*.md`

One file per task, named by slug and never numbered, since two branches would
otherwise claim the same number.

**File conservatively.** The default answer to "should this be a task?" is no. An
over-full `tasks/` list is not a richer picture of the work — it is a list nobody
reads, in which the two things that matter are buried among a dozen that never will.
Four rules:

1. **A task has to move the game toward that one sentence up top.** Not "would improve
   things", not "is unresolved". Tidiness, completeness, test coverage and
   refactorability are not reasons on their own.
2. **Curiosity is not a task.** Hypotheses, oddities noticed in passing, and questions
   worth answering _someday_ are not the open front. Write them into
   `docs/<topic>.md` if they're interesting, or nowhere at all. Never file a task
   whose only product is an answer.
3. **One task per thread, not one per step.** File the next action. Don't pre-file the
   steps behind it — that chain is narrative and belongs in `docs/`; the successor
   becomes a task when it actually becomes next. A long `blocked-by` chain means a
   plan got filed instead of a task.
4. **The next step should be the cheapest thing that might work**, not the measurement
   that would prove what's wrong.

Nobody has to have asked for a task, but somebody has to actually want it done. Prefer
editing an existing task over opening a second one beside it, and prefer a sentence in
the reply over either.

```yaml
---
status: open # open | blocked
kind: task # task | experiment | chore
area: web # engine | server | web | deploy | docs | repo
priority: 0 # 0 highest
blocked-by: '' # slug of another task, or empty
---
```

**Resolving a task means deleting its file.** The deletion lands in the squash commit,
so the commit message becomes the closure record:

```bash
./scripts/ready.sh                     # open and unblocked, by priority
git log -- tasks/<slug>.md             # one task's entire life
git log --diff-filter=D -- tasks/      # everything ever resolved
```

Blocking resolves by **file existence**, not by the `status` field — deleting a
blocker automatically surfaces whatever it was blocking. Resolving is therefore one
action with nothing to keep in sync. `status: blocked` is documentation only.

`ready.sh` is bash and coreutils and nothing else, deliberately, so it runs in a bare
clone before `pnpm install`. Do not rewrite it in TypeScript.

### Branch commits are a lab notebook

Commit early and often on a branch. These never reach `main`, so they cost nothing and
are allowed to be wrong. Use conventional commits scoped by package —
`feat(engine):`, `fix(web):`, `docs(server):`, `wip(web):`. For work that is an
investigation rather than a build, `try:` / `result:` / `dead-end:` are better and
allowed; what matters is that the log says what was believed at each step. The three
front-door prefixes — `note:`, `decision:`, `plan:` — are not optional and sit alongside
whichever of those the code commits use.

What must not happen is an empty branch log because everything was squashed into one
commit at the end.

### PRs and squash-merge

The repo is configured **squash-only**, with the squash commit message taken from the
PR title and description, and branches auto-deleting on merge.

So **the PR description is the permanent record** — write it as a finding someone
reads a year later in `git log`, not as a note to a reviewer. Negative results count.
The PR _title_ becomes the commit subject on `main`, so it leads with its area:
`web: …`, `engine: …`, `repo: …`.

```bash
git checkout -b <area>/<slug> origin/main
#   ... notebook commits ...
gh pr create --fill-verbose      # then rewrite the body as a finding
gh pr merge --squash
```

Branch from `origin/main` explicitly, not from whatever is checked out. A session that
starts in a working copy left on another branch will otherwise build on it silently, and
the mistake surfaces as unrelated CI failures on a PR that does not mention them.

**Do not hard-wrap the PR body.** Write each paragraph as one long line. GitHub
re-wraps the description at ~72 characters when it becomes the commit message, so text
already wrapped at 95 comes out ragged, with orphan fragments mid sentence. Bullet
lists are fine; it is prose paragraphs that break. (This is the opposite of the rule
for `docs/**`, which _is_ hard-wrapped near 95 columns.)

Squashing is not losing the notebook — it promotes the conclusion out of it. The messy
commits stay readable on the PR page forever, just not in `main`.

**When not to open a PR:** a typo or doc-only correction goes straight to `main`.
Anything with a question attached gets a branch.

### Session protocol

```bash
./scripts/ready.sh                     # tasks, plus any idea branches in flight
git log main --oneline -15
gh pr list
```

If `ready.sh` says you are on an `idea/*` branch, read that idea doc before anything else — it
is the only place the assumptions behind the branch are written down. Otherwise that is the
entire memory load: nothing to install, no context injected, no plugin.

### Committing

Commit as findings land rather than asking each time — that is expected here, not
something to check first. Destructive git operations (history rewrites, force pushes,
deleting branches beyond the automatic post-merge cleanup) still need asking.

**Push after every task, not at the end.** Long autonomous runs happen in containers
that can be reclaimed, and work that exists only in one is work you are about to lose.
Open the PR early for the same reason: an unopened PR at the end of a three-hour run
is a run nobody can resume.

### When this stops scaling

Two tripwires, so the system upgrades on a threshold instead of quietly decaying:

- **`tasks/` past ~6 files** → read it as a generation problem, not an organisation
  one. Something is being filed that shouldn't be. Prune before reaching for
  subdirectories.
- **a task file past one screen** → it has become an investigation. Move the narrative
  into `docs/<topic>.md` and leave the task pointing at it.
- **more than ~2 open `idea/*` branches** → collecting ideas rather than building them. Pick
  one and resolve the rest, by merging a `ruled-out:` or by deleting the branch.
- **an `idea/*` branch with no commit past `note:` after ~2 weeks** → delete it. Most ideas do
  not survive contact, and that is their normal end.
- **any `ideas/*.md` on `main`** → a leak. The dispersal step was skipped.

Do not add a tracking tool before hitting one of these. The last one was removed for
failing the bare-clone test.

### Keeping this file current

When you do something this file does not describe, or follow a rule here that cost more than it
returned, add one line to the PR body prefixed `harness:` saying what happened. That is the
whole maintenance process — no audit, nothing to remember between sessions. General lessons go
upstream to `github.com/topherhooper/harness` before they go anywhere else; ones specific to
this repo stay here.

## Invariants

**The engine is pure.** `resolveTurn` is a function of `(state, orders, ctx)` — no
clock, no I/O, no ambient randomness. All randomness goes through
`substream(seed, ...)` in `packages/engine/src/rng.ts`. ESLint enforces this; it isn't
a convention you can weigh against convenience. Purity is what makes replays exact and
crash recovery a matter of re-running the turn.

**Invalid input degrades, never throws.** Inside resolution, bad orders are dropped or
normalized (see the Pact normalization pattern) rather than raising.

**`redact()` is the only path state takes to a client.** Anything secret must not
survive it, fog or no fog — `packages/engine/src/redact.ts`.

**Stored documents predate your change.** Every reader tolerates missing fields
(`?? 'pact'`, `?? []`). Games in flight were written by an older schema.

## Before you push

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm test:server
```

`pnpm test:server` needs Java 21 and the Firebase emulator. If you can't run it, say so
rather than reporting a green run.

CI (`.github/workflows/ci.yml`) runs the same gate starting with `format:check`, then
two sweeps that can fail on changes which pass locally: a 300-seed mapgen sweep, and an
800-game balance run across 2/4/6/8/12 players that exits non-zero on a fairness gate.
Engine changes should expect both.

Which of those actually run depends on what you touched. A `changes` job maps the changed
paths to jobs through `tools/ci/src/changed-areas.ts` and the rest of the workflow reads
its output: `format:check`, `lint` and `typecheck` always run; `pnpm test` skips only on a
documentation-only change; the server suite needs `packages/server` or `packages/engine`;
the sweeps need `packages/engine` (mapgen) or `packages/engine`/`tools` (balance). Anything
the table does not recognize — the lockfile, root config, the workflow itself — runs
everything. Documentation-only pushes to `main` also skip deployment; see
`docs/deployment.md`.

**`pnpm format:check` is unreliable locally.** With `core.autocrlf=true` and no
`.gitattributes`, it fails all ~100 files on CRLF and buries the handful that are
genuinely misformatted — which is how ten bad files reached CI on #6. Use

```bash
pnpm exec prettier --check --end-of-line auto .
```

`pnpm format` (write, not check) is unaffected, so the gate above still stands.

## Conventions

- Branches: `<area>/<slug>` off `main` — `web/storm-warning-deadline`,
  `repo/harness`. Auto-deleted on merge.
- Commits within a branch: conventional commits scoped by package. These are working
  history; the squash message is what lands on `main`.
- Prose in `docs/**` is hard-wrapped near 95 columns and argues _why_, not just _what_.
  PR bodies are the exception — never wrapped.
- `docs/**` is force-included in `.gitignore`. Several build-output patterns there are
  unanchored, so a doc folder named `out/`, `data/` or `build/` would otherwise be
  ignored silently. `tasks/**` needs no such rule, but check before renaming it.
