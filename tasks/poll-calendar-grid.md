---
status: open
kind: task
area: web
priority: 1
blocked-by: ''
---

# New poll is a grid filled from your calendar

## Next step

Replace the date and time rows in `packages/web/src/polls/NewPoll.tsx` with a date range and
daily hours (default: the next 14 days, 18:00–23:00) and an hourly grid for that window.
"Use my calendar" fills it from Google free/busy, any cell can be toggled after, and Create
stores the window and the hours left free as what the poll offers. The server's poll document
takes those fields beside `candidates`, tolerating stored polls without them, and the smoke
suite (`packages/server/src/smoke/two-accounts.smoke.ts`) moves to the new shape in the same
PR. Delete the probe page (`polls/CalendarProbe.tsx`, its route and its link) and reuse its
read, which works: `reauthenticateWithPopup` with the `calendar.freebusy` scope, then
`freeBusy` with the token from `credentialFromResult`.

Done when the owner, on the test host in desktop Chrome, creates a poll without typing a date
or time: picks a range, sees the grid filled from their calendar with no raw JSON on screen,
toggles a few cells, creates it, and sees the offered hours on the poll page.

The owner's four points on the probe, which this answers: integrate it into the new poll flow;
no large JSON blob; the grid instead of specific date and time fields; the grid adjustable once
filled. Why, and what comes after: [docs/design/calendar-availability.md](../docs/design/calendar-availability.md).
