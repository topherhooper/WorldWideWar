---
status: open
kind: task
area: web
priority: 1
blocked-by: ''
---

# Make the ranking round noticeable and its results findable

## Next step

Check first whether the ranking round already triggers an email. Notification preferences shipped in #5, after this was reported, and may already solve half of it -- an hour of reading before an hour of building.

If it doesn't: surface last turn's tier results on the main game view rather than behind the collapsed report, since the contest is the reason people are playing. The cue for the open round is the cheaper half; the hidden results are the half that made two players think they had no result at all.

## What we know

Sam missed the round entirely ("I didn't see the cue to rank other people"); Paco couldn't find the outcome. There is no badge, no unfilled-list indicator, and validation fires only on lock-in (`server/src/games.ts:447-450`), so a player who autosaves and lets the deadline expire never sees a warning.

Results sit behind "Show last turn's report", and `showReport` is force-reset to `false` every turn boundary (`Game.tsx:51`). That reset looks deliberate -- confirm before changing it.

Writing no list is a soft failure by design: no penalty, just forgone upside. Don't turn it into a hard one.

Detail: [docs/onboarding-gaps.md](../docs/onboarding-gaps.md).
