---
description: Capture a new idea on its own branch, without starting the work
---

Capture, do not implement. The full flow is in CLAUDE.md under
**The front door**; this command only starts it.

$ARGUMENTS

1. Ask **at most one** question, and only if you cannot name a concrete outcome
   without it. Everything else you wanted to ask becomes a line under
   `## Assumed, not asked`.
2. `git checkout -b idea/<slug> origin/main` — from the trunk explicitly, not
   from whatever branch the repo happens to be sitting on.
3. Write `ideas/<slug>.md` — open every link that was mentioned and record what
   it actually said, and put `file:line` pointers to the code this touches.
4. Commit `note: <the idea in one line>`.
5. Stop. Offer prototype (default) and brainstorm as alternatives, one line
   each on why this idea might want one over the other. Do not pick for me
   unless I have already said which.
