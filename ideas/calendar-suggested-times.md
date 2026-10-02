# Calendar-suggested poll times

## The idea, as said

> Poll is on the test site. We will need to make it much easier to schedule. Ideally by
> plugging into my google calendar

Said on 2026-10-01, right after the phase 2 poll (#46) was first used on
`test.topherhooper.com`. "Much easier to schedule" is the complaint; Google Calendar is the
proposed lever.

## What would make it real

An organizer who has connected Google Calendar opens New poll on the test host, sees a short
list of times in the next two weeks when their calendar is free, and builds a three-time poll by
tapping suggestions, without typing a single date or time.

## Prototype goal

On `test.topherhooper.com`, the owner taps "Use my calendar", grants Google's free/busy access,
and sees the next 14 days from 18:00 to 23:00 as an hourly grid with their real busy hours
marked busy, both in desktop Chrome and in the iPhone home-screen app.

That tests the one thing every decision below rests on: that a browser-only free/busy read
(D3) works through the app's existing Firebase Google sign-in, including inside the iPhone
home-screen app, where popups do not work and the redirect flow must come back with the
Calendar token. Expected human steps, not surprises: enabling the Calendar API in
`fluted-citizen-269819` and adding the `calendar.freebusy` scope to the OAuth consent screen,
which a sandbox without Google credentials cannot do.

## What it touches

The poll code landed on `main` with #46.

- `packages/web/src/polls/NewPoll.tsx:67-99` — the "When could it work?" rows: a `date` input
  and two `time` inputs per candidate, at least two rows. This is the screen the complaint is
  about. Suggestions would fill these rows rather than replace them.
- `packages/web/src/polls/times.ts:25` `rowInstants`, `:40` `nextRow` — turn a row into
  instants and copy the previous row's times; a suggestion is just a pre-filled row.
- `packages/web/src/auth.tsx:73` — `new GoogleAuthProvider()` with no extra scopes. Reading a
  calendar means asking for a Calendar scope here or in a separate, later consent step.
- `packages/server/src/polls.ts` — unchanged if suggestions stay client-side; a poll is still a
  list of candidate times.

Decisions this reopens, in `docs/design/group-scheduler.md`:

- `:51-53`, "Assumptions still standing": _"These are social events among friends, not work
  meetings, so no calendar-sync integration is needed for v1. The standing availability profile
  from Q6 stands in for it until the phone app."_ This idea says otherwise after first use.
- `:66`, Q7: the rejected alternative was a date range where the tool proposes the best times,
  kept open "as a later 'suggest times' button on the create screen". This idea is that button,
  fed from a calendar instead of from profiles.
- `:62` and `:134`, Q4: reading a calendar to pre-fill availability was held back for the native
  phone app. This would bring a version of it into the web phase.
- `:75`, Q16, and phase 3 of `docs/design/group-scheduler-v1-plan.md:375` — the hourly
  availability profile, learned from answers. Calendar free/busy could fill the same profile
  directly, which would change what phase 3 builds.

Deployment, `docs/deployment.md:252` and `:291-297`: the browser API key is restricted to the
sign-in APIs. A Calendar call made with the user's OAuth access token as a Bearer header should
not need the key at all, but the Calendar API would have to be enabled in the project and the
scope added to the OAuth consent screen.

## Links

None were given. Nothing below was checked against a live page; it is from memory and is the
first thing a prototype should confirm:

- Google Calendar's `freeBusy.query` returns busy intervals for a calendar without event titles,
  and there is a narrow `calendar.freebusy` scope for it.
- Calendar scopes are "sensitive", not "restricted": an app in Testing mode can use them for up
  to 100 named test users after an "unverified app" warning, and verification is needed only to
  go beyond that. Refresh tokens issued in Testing mode expire after about seven days.
- Firebase's `GoogleAuthProvider.addScope()` plus a popup or redirect returns a Google OAuth
  access token (about an hour) in the credential, which the browser can use directly.

## Assumed, not asked

- ~~**"My google calendar" means the organizer's own calendar.**~~ Overturned by D1: every
  member's availability comes from their own calendar.
- **Read free/busy only.** No event titles are read or stored, and nothing is written: locking a
  time does not create a calendar event or send an invite. (`.ics` invites are already listed as
  out of v1 in the plan, `:664`.)
- **Suggest, never decide.** The organizer still picks which times go on the poll, matching Q7's
  "keeps the organizer in charge".
- **Optional.** Connecting a calendar is a button on the create screen; the form still works by
  hand for anyone who skips it.
- **Client-side first.** The browser asks for the scope only when the organizer taps the button,
  calls Calendar with a short-lived token, and the server stores no Google token. Server-side
  refresh tokens are only needed if suggestions must work without a fresh consent each time.
- **Suggestions are evening and weekend spans** (say, weekday 18:00–22:00 and weekend
  afternoons and evenings) that the calendar shows as free, in the organizer's time zone, over
  the next 14 days. The exact windows are a guess.
- **Testing mode is acceptable** for the group of five, with each friend added as a test user;
  Google verification is a launch problem, not a prototype one.
- **It sits beside #46, not inside it.** Phase 2 lands as built; this is a change to the create
  screen after it.
- "Much easier" may also mean the form itself is too fiddly (three inputs per row came from
  Q17). The calendar is assumed to be the main lever; quick presets without a calendar are a
  fallback, not the idea.

## Decisions

| #   | Chosen                                                                                                                                                                                                                                                   | Rejected                                                                                                                                                                                                                                                                                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Build around Google Calendar for everyone: each member's availability is read from their own calendar. A member without one paints it by hand on a WhenIsGood-style grid.                                                                                | Reading only the organizer's calendar to suggest times, with friends answering Yes/No as in #46 (the assumption this doc was captured with). The hourly profile learned from answers (Q6, Q16, phase 3 of the v1 plan) as the main source of availability. Holding calendar reading back for the native phone app (Q4).                                | Owner, after using #46 on the test host: scheduling has to be much easier, and a calendar most people already keep is the cheapest source of truth. The grid is the floor for anyone without Google Calendar, not a second-class path to design around. Reverses the standing assumption in `group-scheduler.md:51` that no calendar sync is needed for v1.                  |
| D2  | A poll is a date range plus daily hours (e.g. the next two weeks, 18:00–23:00). Everyone's availability, from calendar or painted grid, overlays into a heatmap; the app ranks the best few times; the organizer locks one.                              | A range, then the app proposes the top three and members confirm Yes/No on those (keeps Q8's explicit answer, costs a second round). Keeping #46's 2–6 organizer-typed candidate times with calendars pre-ticking Yes/No (smallest change, but the organizer still picks times blind).                                                                 | Owner's choice. With availability already known, asking the organizer to guess times first throws the calendar's value away, and a second voting round is the friction this idea exists to remove. Supersedes Q7 and #46's create screen and Yes/No answer card; #46's membership, link-outside-the-wall, lock, cancel and preview carry over. Locking by hand (Q14) stands. |
| D3  | A member's calendar is read only when they open the poll and tap "Use my calendar": the browser asks Google for free/busy once, shows their grid filled in, and they confirm it. The server stores the confirmed grid for that poll and no Google token. | Staying connected, with the server holding a refresh token and reading every poll live, even ones the member never opens (overrides Q8, needs token storage and Google verification of the scope, since Testing-mode tokens lapse about weekly). Connected-but-confirm: live pre-fill on the server, counted only once confirmed (both costs at once). | Owner's choice. Keeps Q8 — only an explicit answer counts — and keeps the server holding no Google credentials, so five friends can run in Testing mode without verification. Cost accepted: everyone still has to open the link, so pokes still carry the weight, and a calendar changed after confirming is not seen until the member reopens the poll.                    |
| D4  | A grid member's painting is also saved as a weekly pattern on their account, and their next poll opens pre-painted from it for them to fix and confirm.                                                                                                  | Painting every poll from empty, pure WhenIsGood (simplest, nothing stored beyond the poll, but grid users pay full cost every time).                                                                                                                                                                                                                   | Owner's choice. Makes the second poll one tap for grid users too, the same promise the calendar makes. Phase 3 shrinks to storing and pre-filling a pattern: the "learned from Yes/No answers" model of Q16 (a Yes marks the span free, a No only its first hour) has nothing to learn from once answers are grids, so it is dropped.                                        |
| D5  | Merge #46 as built, then replace its create screen and Yes/No answer card in the PRs that follow. Its body records that the candidate-times shape was superseded here.                                                                                   | Reworking #46's screens on its branch before merging (main never carries the old shape, but one large PR stays open through the whole calendar build). Closing #46 and starting fresh from main (cleanest history, but throws away tested membership, preview, lock and cancel code).                                                                  | Owner's choice. Most of #46 survives D2 — membership, the poll link outside the sign-in wall, the public preview, lock, cancel, the routes and their 39 server tests — so landing it gives the calendar work a tested base and keeps each later PR small.                                                                                                                    |

### Still assumed after brainstorming

- Grid cells are one hour, as Q16 chose for the profile; free/busy is rounded to the hour, and
  an hour counts as busy if any part of it is.
- Only the member's primary calendar is read, which the narrow `calendar.freebusy` scope
  allows by id `primary`; reading every calendar they have needs a calendar-list scope.
- A calendar user can still edit their filled-in grid before confirming (free on paper, not
  free in practice).
- The best-times ranking counts members free for the whole of a span the organizer names as
  the event length; ties break toward the earlier time.
