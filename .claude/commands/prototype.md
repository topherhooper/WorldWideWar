---
description: Take the shortest path to one stated outcome, autonomously
---

Prototype the current idea. The rules are in CLAUDE.md under **The front door**;
what matters most is that this runs to a result without checking in.

$ARGUMENTS

**Precondition.** `## Prototype goal` in the idea doc — one sentence, observable
outcome. If it is missing, write it, show it to me, and stop there. If it cannot
be written, say so and recommend brainstorming instead.

**Then go, without asking.** Notebook commits as you work: `try:`, `result:`,
`dead-end:`. No refactoring, no cleanup, no error handling the goal does not
need, no tests unless the test is the goal. Hardcode it. Prototype code is
allowed to be embarrassing and expected to be thrown away.

**Stop at the second surprise.** Work around the first unexpected blocker and
note it in the doc. The second one ends the run — that is a count, not a
judgement, because every increment of a rewrite looks reasonable on its own.

**Two endings, both results:**

- It worked → open the PR, title `<area>: <what changed>`, body written as a
  finding rather than a changelog.
- It cannot be done without major changes → write `## Why not` (what the change
  is, what it costs, what would make it worth doing), open the PR titled
  `ruled-out: <idea>`, and merge it. Merging is the point: main then carries the
  reason and I will not re-propose this in six months.

Either way, disperse before merging: delete `ideas/<slug>.md`, and open at most
one `tasks/` file if a next action actually survives.
