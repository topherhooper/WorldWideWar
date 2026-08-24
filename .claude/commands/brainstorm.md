---
description: Socratic design pass on the current idea, one question at a time
---

Brainstorm the current idea. See CLAUDE.md under **The front door**.

$ARGUMENTS

**One question per turn.** Ask only questions whose answer changes what gets
built — "which of these two libraries" when both work is not one; "does this
survive a restart" usually is. When you run out of those, say so and stop rather
than reaching for more.

Append `## Decisions` to the idea doc as you go, and commit each one
`decision: <what was chosen>`. Record what was **rejected and why** in the same
row — the rejections are the only part of this file that git cannot reconstruct,
and they are what survives into `docs/design/<slug>.md`.

When the decisions are settled, offer the plan stage or a prototype. Do not
write the plan unprompted.
