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

## What it touches

The poll code is on #46's branch (`web/poll-people-can-answer`) and not yet on `main`, so these
pointers are into that branch.

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

| #   | Chosen                                                                                                                                                                                                                      | Rejected                                                                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Build around Google Calendar for everyone: each member's availability is read from their own calendar. A member without one paints it by hand on a WhenIsGood-style grid.                                                   | Reading only the organizer's calendar to suggest times, with friends answering Yes/No as in #46 (the assumption this doc was captured with). The hourly profile learned from answers (Q6, Q16, phase 3 of the v1 plan) as the main source of availability. Holding calendar reading back for the native phone app (Q4). | Owner, after using #46 on the test host: scheduling has to be much easier, and a calendar most people already keep is the cheapest source of truth. The grid is the floor for anyone without Google Calendar, not a second-class path to design around. Reverses the standing assumption in `group-scheduler.md:51` that no calendar sync is needed for v1.                  |
| D2  | A poll is a date range plus daily hours (e.g. the next two weeks, 18:00–23:00). Everyone's availability, from calendar or painted grid, overlays into a heatmap; the app ranks the best few times; the organizer locks one. | A range, then the app proposes the top three and members confirm Yes/No on those (keeps Q8's explicit answer, costs a second round). Keeping #46's 2–6 organizer-typed candidate times with calendars pre-ticking Yes/No (smallest change, but the organizer still picks times blind).                                  | Owner's choice. With availability already known, asking the organizer to guess times first throws the calendar's value away, and a second voting round is the friction this idea exists to remove. Supersedes Q7 and #46's create screen and Yes/No answer card; #46's membership, link-outside-the-wall, lock, cancel and preview carry over. Locking by hand (Q14) stands. |
