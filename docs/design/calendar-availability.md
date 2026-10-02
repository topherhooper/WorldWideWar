# Calendar availability for Quorum polls

Quorum's polls take availability from each member's Google Calendar, and anyone without one
paints a WhenIsGood-style grid. This reverses the standing assumption in
[group-scheduler.md](group-scheduler.md) that "no calendar-sync integration is needed for v1",
replaces Q7's organizer-typed candidate times with a date range and a heatmap, and replaces
phase 3's profile learned from Yes/No answers with a remembered weekly pattern.

It came from first use. On 2026-10-01 the owner tried the phase 2 poll (#46) on the test host
and said: _"We will need to make it much easier to schedule. Ideally by plugging into my google
calendar."_

## Decisions

| #   | Chosen                                                                                                                                                                                                                                                   | Rejected                                                                                                                                                                                                                                                                                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Build around Google Calendar for everyone: each member's availability is read from their own calendar. A member without one paints it by hand on a WhenIsGood-style grid.                                                                                | Reading only the organizer's calendar to suggest times, with friends answering Yes/No as in #46 (the assumption the idea was captured with). The hourly profile learned from answers (Q6, Q16, phase 3 of the v1 plan) as the main source of availability. Holding calendar reading back for the native phone app (Q4).                                | Owner, after using #46 on the test host: scheduling has to be much easier, and a calendar most people already keep is the cheapest source of truth. The grid is the floor for anyone without Google Calendar, not a second-class path to design around.                                                                                                                 |
| D2  | A poll is a date range plus daily hours (e.g. the next two weeks, 18:00–23:00). Everyone's availability, from calendar or painted grid, overlays into a heatmap; the app ranks the best few times; the organizer locks one.                              | A range, then the app proposes the top three and members confirm Yes/No on those (keeps Q8's explicit answer, costs a second round). Keeping #46's 2–6 organizer-typed candidate times with calendars pre-ticking Yes/No (smallest change, but the organizer still picks times blind).                                                                 | Owner's choice. With availability already known, asking the organizer to guess times first throws the calendar's value away, and a second voting round is the friction this exists to remove. Supersedes Q7 and #46's create screen and Yes/No answer card; #46's membership, link-outside-the-wall, lock, cancel and preview carry over. Locking by hand (Q14) stands. |
| D3  | A member's calendar is read only when they open the poll and tap "Use my calendar": the browser asks Google for free/busy once, shows their grid filled in, and they confirm it. The server stores the confirmed grid for that poll and no Google token. | Staying connected, with the server holding a refresh token and reading every poll live, even ones the member never opens (overrides Q8, needs token storage and Google verification of the scope, since Testing-mode tokens lapse about weekly). Connected-but-confirm: live pre-fill on the server, counted only once confirmed (both costs at once). | Owner's choice. Keeps Q8 — only an explicit answer counts — and keeps the server holding no Google credentials, so five friends can run in Testing mode without verification. Cost accepted: everyone still has to open the link, so pokes still carry the weight, and a calendar changed after confirming is not seen until the member reopens the poll.               |
| D4  | A grid member's painting is also saved as a weekly pattern on their account, and their next poll opens pre-painted from it for them to fix and confirm.                                                                                                  | Painting every poll from empty, pure WhenIsGood (simplest, nothing stored beyond the poll, but grid users pay full cost every time).                                                                                                                                                                                                                   | Owner's choice. Makes the second poll one tap for grid users too, the promise the calendar makes. Phase 3 shrinks to storing and pre-filling a pattern; Q16's "learned from Yes/No answers" model has nothing to learn from once answers are grids, so it is dropped.                                                                                                   |
| D5  | Merge #46 as built, then replace its create screen and Yes/No answer card in the PRs that follow.                                                                                                                                                        | Reworking #46's screens on its branch before merging (one large PR open through the whole build). Closing #46 and starting fresh from main (throws away tested membership, preview, lock and cancel code).                                                                                                                                             | Owner's choice. Most of #46 survives D2, so landing it gave this work a tested base and keeps each later PR small.                                                                                                                                                                                                                                                      |

## What the prototype established

On 2026-10-02 a throwaway page on the test host (`/p/calendar`, #49) proved D3's premise in
desktop Chrome. Firebase's `reauthenticateWithPopup` with a `GoogleAuthProvider` carrying
`https://www.googleapis.com/auth/calendar.freebusy` returns a Google access token through
`GoogleAuthProvider.credentialFromResult`. The browser can call Calendar's `freeBusy` with that
token as a Bearer header, with no API key and nothing on the server, and the hourly grid drawn
from the response matched the owner's real evenings. It needed two console steps: enabling
`calendar-json.googleapis.com` in `fluted-citizen-269819` and adding the scope to the OAuth
consent screen.

Not established: the iPhone home-screen app. Popups do not work there, so the token has to come
back through `reauthenticateWithRedirect` and `getRedirectResult`, which nobody has tried. That
is the largest remaining risk to D1, since the group uses phones.

The owner's verdict on the probe was a list of what the real screen must do, not a list of
defects in the read: it belongs in the new-poll flow, the raw JSON must go, the date and time
fields must give way to the grid, and the grid must be editable after the calendar fills it.

## Still assumed

- Grid cells are one hour, as Q16 chose; an hour counts as busy if any part of it is.
- Only the primary calendar is read, which the narrow scope allows by id `primary`; every
  calendar would need a calendar-list scope.
- Anyone can edit their filled grid before confirming (free on paper is not always free).
- The organizer's own grid is the set of hours offered: what they leave free is what the poll
  asks everyone else about, as on WhenIsGood.
- Ranking counts members free across a whole span of an event length the organizer names, ties
  toward the earlier time.

## Route

The organizer side comes first, because it is the screen the owner rejected and it fixes the
poll's shape for everything after it. New poll keeps its title, swaps the date and time rows
for a date range and daily hours with sensible defaults, and draws the hourly grid for that
window. "Use my calendar" fills it from free/busy, any cell can be toggled after, and creating
the poll stores the window and the hours offered. The server's poll document gains those
fields beside `candidates`; stored polls predate them, so readers tolerate both shapes, and the
two-account smoke suite in the test-host deploy moves to the new shape in the same PR. The
probe page is deleted there, its read absorbed into the grid.

The member side follows on the same grid: a friend opening the link sees only the offered
hours, fills them from their calendar or by hand, edits and confirms, and everyone sees a
heatmap of counts with the best spans ranked and the organizer's lock on top. #46's Yes/No
card goes then. The weekly pattern for grid users (D4) comes after that, then the redirect flow
for the iPhone home-screen app, then phases 4 to 6 of the v1 plan re-read against this shape,
since tiers and pokes were written for candidate times.
