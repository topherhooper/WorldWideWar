---
status: open
kind: task
area: web
priority: 1
blocked-by: ''
---

# A poll two friends can answer

## Next step

Phase 2 of [docs/design/group-scheduler-v1-plan.md](../docs/design/group-scheduler-v1-plan.md),
which has the steps; the why is in
[docs/design/group-scheduler.md](../docs/design/group-scheduler.md). The push channel from
phase 1 is in place, and the test host is described in
[docs/deployment.md](../docs/deployment.md) under "The test host".

Done when two signed-in accounts on the test host can: one creates a poll with three candidate
times and shares the link; the other opens it signed out, sees the title and who asked, signs
in, confirms Yes/No on each time; both see the per-time counts and who said what; the organizer
locks one time and both see it locked.

When this lands, this file is replaced by the one task for phase 3.
