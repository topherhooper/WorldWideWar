---
description: Take an idea doc through the full superpowers workflow autonomously — spec, plan, minimal implementation, draft PR.
argument-hint: [path to an idea doc — defaults to the newest in docs/superpowers/ideas/]
---

# One-shot

Take an idea document all the way to a draft PR, autonomously, in the smallest
implementation that satisfies it.

Idea doc: `$ARGUMENTS` — if empty, use the most recently modified file in
`docs/superpowers/ideas/`.

## Autonomy contract

**Do not ask questions.** Every open question in the idea doc gets resolved by picking
the option that requires the least new code, and recorded in the spec's `## Decisions`
table with the discarded alternatives named in the `Rejected:` paragraph. A recorded
assumption is reviewable in the PR; a question stalls the run.

The single exception: if an ambiguity is genuinely load-bearing — proceeding either way
produces work that is useless if you guessed wrong — stop and report what you need.
That is the only condition under which this command may end unfinished. "I'd like
confirmation" is not that condition.

Work that requires a human (credentials, a Cloud Build trigger, a DNS record) goes under
`## Prerequisites (blocked on human)` in the plan and does not block the rest.

## Steps

### 1. Read the idea doc

Read it fully, including `## Raw dump` — the summary sections are lossy.

**Continue on the idea's own branch. Do not cut a new one from `main`.**

```bash
git fetch origin
git checkout idea/<slug>     # already local? just switch to it
git rebase origin/main       # pick up whatever landed since capture
```

`/new-idea` wrote the doc on `idea/<slug>` and pushed it there; that branch was never
merged to `main`. Branching fresh from `main` lands you in a tree where the idea doc
does not exist — and the "newest file in `docs/superpowers/ideas/`" default then finds
nothing, or worse, some older idea.

One branch per idea, carried the whole way: `idea/<slug>` accumulates idea → spec →
plan → code and becomes the PR's head branch, so the PR diff tells the whole story from
capture to implementation.

If you were handed a doc that has no branch of its own (e.g. one already on `main`),
then cut `idea/<slug>` from `origin/main` and carry on the same way.

### 2. Brainstorm → spec

Use `superpowers:brainstorming` for the thinking, non-interactively. Write
`docs/superpowers/specs/<YYYY-MM-DD>-<slug>-design.md` in the house format:

- H1 `<Feature> — Design`, then plain `Date:` and `Status:` lines. No YAML front matter.
- `## Goal`
- `## Decisions (settled during brainstorming)` — a `| Question | Decision |` table,
  immediately followed by a `Rejected:` paragraph giving the roads not taken with the
  reason for each in parentheses.
- Sections named for the layer being touched (Engine / Server / Web / Testing).
- `## Out of scope for v1` — this is where scope creep goes to die. Use it generously.

Match `docs/superpowers/specs/2026-08-11-tiers-contest-design.md` for voice and shape.

### 3. Plan

Use `superpowers:writing-plans`. Write `docs/superpowers/plans/<YYYY-MM-DD>-<slug>.md`
(slug identical to the spec's, minus `-design`). The opening four elements are fixed:

```markdown
# <Feature> Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** <what and why>, per the approved spec `docs/superpowers/specs/<...>-design.md`.

**Architecture:** <how it fits the existing system, by layer>

**Tech Stack:** TypeScript ESM monorepo (pnpm), Vitest, Fastify + Firestore (server, tested against the emulator), React 19 + react-router (web).
```

That blockquote is byte-identical across every plan in this repo. Copy it exactly.

Then `## Global Constraints` (invariants, ending with the commands to run and
"Commit after every task."), `## File Structure` as a `| File | Role |` table with a
trailing `Tests:` line, then `### Task N:` blocks separated by `---`. Each task:

- `**Files:**` with explicit `Create:` / `Modify:` and approximate line numbers
- `**Interfaces:**` as `Consumes:` / `Produces:`
- TDD checkboxes: write failing test → run and confirm it fails → implement → run tests
  → commit, with the commit message written out verbatim in conventional-commits form
  scoped by package (`feat(engine):`, `fix(web):`, `docs(engine):`)

Code blocks are complete and paste-ready, not sketches.

### 4. Open the draft PR — before writing any code

Commit the spec and plan, push, and open the **draft** PR now, with the plan's task list
mirrored into the body as an unchecked progress checklist. Subscribe to it.

```bash
git add docs/superpowers && git commit -m "docs: spec and plan for <slug>"
git push -u origin <branch>
```

This is deliberately early. The PR is the durable record of the run — if this context
dies mid-implementation, a fresh one recovers by reading the branch and the checklist
rather than starting over. An unopened PR at the end of a three-hour run is a run you
cannot resume.

### 5. Implement

Use `superpowers:subagent-driven-development`, one task at a time, TDD throughout.

**After every task, without exception:**

1. Tick that task's `- [ ]` → `- [x]` in the plan file **first**, so it lands in the
   same commit as the work it describes. Do not commit and then amend.
2. Commit with the message the plan specifies.
3. `git push`.

The pushed plan file is the resume point. A restarted context reads it, finds the first
unchecked task, and continues from there — no re-derivation, no guessing what landed.
Never batch several tasks into one push; the window where work exists only in this
container is the window where it can be lost.

Update the PR body's checklist as you go. Do not post a comment per task — the checklist
is the status, and a stream of progress comments is noise.

### 6. Verify

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
pnpm test:server   # needs Java 21 + the Firebase emulator
```

Never proceed past a red check. If `pnpm test:server` cannot run in this environment,
skip it and **say so explicitly in the PR body** — do not report a green run you did
not get. CI (`.github/workflows/ci.yml`) runs `format:check` first, plus a 300-seed
mapgen sweep and an 800-game balance sweep, so engine changes can fail CI on a gate
that passes locally.

### 7. Finish

Push the last commit, then bring the PR body to its final state and stop.

**The PR description becomes the squash commit message** — this repo squash-merges and
takes the commit message from the PR title and body. So the body is permanent history,
not a note to a reviewer. Write it accordingly: `## Summary` naming the spec and plan
paths explicitly, then `## Design highlights` as bolded-lead bullets. Drop the
in-progress checklist once every box is ticked; it is scaffolding, not history.

## The no-bloat gate

Run this against your own diff before step 7. It is the difference between a one-shot
and a sprawl.

- **No new dependencies.** If you believe one is required, that is a load-bearing
  ambiguity — stop and ask.
- **No abstraction the spec didn't ask for.** No interface with one implementation, no
  factory with one product, no config knob nobody requested, no plugin point for a
  second case that does not exist yet.
- **Every new exported symbol has a caller in the same diff.** If nothing calls it, it
  is speculative — delete it.
- **Prefer modifying an existing file over creating one.** New files are a cost.
- **No defensive code for conditions the types rule out.**
- **No rewriting adjacent code you happened to read.** Note it in `## Self-review notes`
  and leave it alone.
- **Comments explain why, not what**, and match the density of the surrounding file.

If the diff outgrew what the spec justifies, cut it before committing rather than
explaining it in the PR.

Record any deliberate departure from the spec under `## Self-review notes` at the end of
the plan, with the justification — as `docs/superpowers/plans/2026-08-11-web-client.md`
does. Silent deviation is the thing to avoid; a justified one is fine.
