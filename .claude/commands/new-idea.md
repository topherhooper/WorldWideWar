---
description: Capture a raw context dump as a structured idea doc. Organizes only — never implements.
argument-hint: <paste anything — a chat thread, a complaint, a half-formed feature idea>
allowed-tools: Bash(git fetch:*), Bash(git checkout:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git status:*), Bash(git rev-parse:*), Bash(date:*), Bash(pnpm exec prettier:*), Write, Read, Glob, Grep
---

# New idea

Capture the dump below as an idea document. This is the step **before** brainstorming.
Your job is to organize information, not to act on it.

<dump>
$ARGUMENTS
</dump>

## What you do

1. **Branch off main.**

   ```bash
   git fetch origin main
   git checkout -B idea/<slug> origin/main
   ```

   `<slug>` is a short kebab-case name for the idea, derived from the dump.

2. **Write `docs/superpowers/ideas/<YYYY-MM-DD>-<slug>.md`** using the template below.
   Use today's real date from `date +%Y-%m-%d`.

3. **Format, commit, push.**

   ```bash
   pnpm exec prettier --write docs/superpowers/ideas/<YYYY-MM-DD>-<slug>.md
   git add docs/superpowers/ideas/<YYYY-MM-DD>-<slug>.md
   git commit -m "docs(ideas): capture <slug>"
   git push -u origin idea/<slug>
   ```

   Prettier runs on **that one file only**. CI checks `format:check` first, so an
   unformatted doc turns CI red later for whoever picks this idea up — in a file they
   did not write. Formatting your own output is not evaluating the codebase.

   Push, but do **not** open a PR. A capture that exists only in a container is lost
   when that container is reclaimed, which defeats the point of capturing it. A pushed
   branch with no PR is durable and claims nothing.

4. **Print the file path and stop.** One or two sentences, no summary of the contents —
   the user just wrote them.

## Hard rules

These are the point of this command. Breaking them defeats it.

- **Do not write, modify, or delete any code.** Not a fix, not a one-liner, not a typo.
- **Do not run tests, builds, or the app.** The one exception is formatting your own
  output — see step 3. You are not permitted to lint or evaluate the codebase.
- **Do not create GitHub issues, PRs, or comments.** Pushing a branch is fine and
  expected; it makes the capture durable without claiming anyone's attention. Opening a
  PR claims attention, and nobody asked for that yet.
- **Do not launch research subagents.** No Task/Agent calls, no deep investigation.
- **Do not answer questions raised in the dump.** Record them under `## Open questions`.
  If the dump asks "how does X work?", that is an open question, not an assignment.
- **Do not evaluate, triage, prioritize, or recommend a solution.** Someone dumping
  context is not asking what you think of it.

You may read files **only** to attach a path to something the dump already names —
e.g. the dump says "the storm code" and you note it lives at `packages/engine/src/storm.ts`.
That is orientation, not research. Cap it at a couple of lookups. Anything you did not
verify that way goes under `## Unverified claims` — stated as a claim someone made,
never as a fact you are vouching for.

If the dump is ambiguous, capture the ambiguity. Do not resolve it.

## Template

```markdown
# <Title> — Idea

Date: <YYYY-MM-DD>
Status: Captured — not yet brainstormed
Source: <where this came from: group chat, meeting, own notes…>

## Raw dump

<the input, verbatim and unedited — do not summarize, tidy, correct, or reorder it.
This section is the reason the command exists. Keep typos. Keep the tangents.>

## What's being asked

<the distinct asks, as a list. One line each. If the dump contains five complaints,
list five. Do not merge them into a theme, and do not editorialize.>

## Open questions

<everything the dump asks or leaves unresolved, including questions aimed at a person
rather than the code. Unanswered.>

## Constraints & non-goals

<anything the dump rules out, budgets, deadlines, "don't want to chase every problem",
existing decisions it must live with. Omit the section if the dump states none.>

## Unverified claims

<assertions made in the dump that would need checking before acting. Attribute them:
"Sam says spaces that look adjacent aren't connected." Do not check them now.>

## Suggested next step

<one line, usually: brainstorm this, or run /one-shot on it. Not a plan.>
```

## Why this command exists

The failure mode is an agent that reads a context dump and helpfully gets to work —
researching, filing, fixing, answering. That produces motion before anyone has decided
what the work is, and it buries the original context under the agent's interpretation
of it. The raw dump preserved verbatim is what makes the next step possible.
