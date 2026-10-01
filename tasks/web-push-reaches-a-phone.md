---
status: open
kind: task
area: web
priority: 1
blocked-by: ''
---

# Make a nudge buzz a real phone, iPhone included

## Next step

The step-by-step handoff plan is
[docs/design/group-scheduler-push-plan.md](../docs/design/group-scheduler-push-plan.md); it
is written to be executed by a cheaper model and deleted with this task. The phases after
this one are planned in
[docs/design/group-scheduler-v1-plan.md](../docs/design/group-scheduler-v1-plan.md).

Build the push channel and nothing else from the scheduler:

- A web app manifest and a service worker in `packages/web`.
- Firebase Cloud Messaging on the existing Firebase project.
- Device tokens as an optional field on the user doc. Old docs have none, and every reader
  treats absence as "no devices".
- A push transport inside `notify()` in `packages/server/src/notify.ts`, beside the email
  one, so the per-kind preferences and unsubscribe gate it with no second door.
- An Add to Home Screen walkthrough for iPhone, because without it iOS never offers the
  permission prompt.
- Test over HTTPS through a Firebase Hosting preview channel against the existing Cloud Run
  service, rather than relighting the mothballed site.

Done when a push sent through `notify()` visibly arrives on a home-screen-installed iPhone
and on an Android phone.

## Why this is first

Every later decision in [docs/design/group-scheduler.md](../docs/design/group-scheduler.md)
assumes a push reliably reaches a friend's phone, and nothing in this repo has ever sent one.
It is worth having on its own: the game's turn reminders would arrive as pushes too.

If it does not reliably reach the iPhone, stop and reopen decision Q2 before building
anything else. Organizer-sent prefilled `sms:` links are the likeliest fallback.
