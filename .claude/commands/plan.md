---
description: Write the implementation route after brainstorming
---

Plan the current idea. See CLAUDE.md under **The front door**.

$ARGUMENTS

Requires `## Decisions` in the idea doc. If it is not there, brainstorm first —
a plan written over unmade decisions is a guess with a table of contents.

Append `## Route` to the idea doc: **prose, no checkboxes.** A list of ticked
steps is recoverable from the log and the PR, so the only version that outlives
the work is a stale one claiming to know what is left. Commit `plan: <route>`.

The residue on the trunk is exactly two things — `docs/design/<slug>.md` for the
decisions and the route, and **one** `tasks/` file for the next action. If the
plan wants to open more than one task, it has not picked a first step; say so
instead of filing them.
