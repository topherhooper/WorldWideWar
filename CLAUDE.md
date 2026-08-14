# Working in this repo

See `README.md` for what the game is and `docs/deployment.md` for the runbook. This
file covers how work gets done here.

## The workflow

Features move through four artifacts, each one the input to the next:

| Stage          | Command / skill                           | Lands in                         |
| -------------- | ----------------------------------------- | -------------------------------- |
| **Capture**    | `/new-idea`                               | `docs/superpowers/ideas/`        |
| **Brainstorm** | `superpowers:brainstorming`               | `docs/superpowers/specs/`        |
| **Plan**       | `superpowers:writing-plans`               | `docs/superpowers/plans/`        |
| **Implement**  | `superpowers:subagent-driven-development` | code + tests, committed per task |

`/one-shot <idea-doc>` runs the whole chain autonomously and stops at a draft PR.

Naming is `YYYY-MM-DD-<kebab-slug>.md` at every stage. Specs add a `-design` suffix;
the plan reuses the spec's slug without it. One spec may fan out into several plans,
tagged `(1 of 3: server, web, deploy)` in the H1.

The two commands live in `.claude/commands/`. Read them before hand-rolling either
step — the document formats they describe are the house style, taken from the existing
specs and plans, and new artifacts should be indistinguishable from those.

### Requires the superpowers plugin

`.claude/settings.json` enables `superpowers@claude-plugins-official` for this repo, so
trusting the folder is normally all it takes — `claude-plugins-official` is a built-in
marketplace. If the skills don't resolve, install it once by hand:

```
/plugin install superpowers@claude-plugins-official
```

The artifacts and both commands still work without the plugin; you just do the thinking
yourself instead of leaning on the skills.

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

## Commit and push cadence

Open the draft PR **before** implementation starts — as soon as the spec and plan are
written — then commit, tick the plan's checkbox, and push after **every task**.

The pushed plan file is the resume point. If a session dies mid-run, the next one reads
the plan from the branch, finds the first unchecked `- [ ]`, and continues from there.
Batching several tasks into one push widens the window where work exists only in a
container that can be reclaimed. An unopened PR at the end of a long run is a run
nobody can resume.

Track progress by keeping the PR body's checklist current, not by posting a comment per
task.

## Merging

**This repo squash-merges, and the squash commit message is taken from the PR title and
body.** The PR description is therefore permanent history on `main`, not a note to a
reviewer — write it to be read a year later by someone running `git log`.

That is a repository setting: Settings → General → Pull Requests → allow squash merging
only, with the default commit message set to "Pull request title and description."

## Conventions

- Branches: `claude/<kebab-topic>-<suffix>` off `main`. Idea branches: `idea/<slug>`.
- Commits within a branch: conventional commits scoped by package — `feat(engine):`,
  `fix(web):`, `docs(server):`. These are working history; the squash message is what
  lands on `main`.
- PR bodies: `## Summary` naming the spec and plan paths explicitly, then
  `## Design highlights` as bolded-lead bullets. Merge subjects end up as
  `<prose subject> (#N)`.
- Prose in docs is hard-wrapped near 95 columns and argues _why_, not just _what_.
- Backlog lives in each spec's `## Out of scope for v1`, and in
  `docs/superpowers/ideas/` for anything not yet specced. This project does not use
  GitHub issues.
- `docs/**` is force-included in `.gitignore`. Several build-output patterns there are
  unanchored, so a doc folder named `out/`, `data/` or `build/` would otherwise be
  ignored silently.
