# Group scheduler — a better WhenIsGood

## As said

> I want to solve scheduling social events. I like whensgood site. But let's make a better one
> that makes it easier to share availability. Have better poking when waiting for responses
> that are effective psychology strategies. We'll reuse components of this project. Let's
> brainstorm how we achieve the goal.

Two halves, and they are different problems:

1. **Sharing availability is too much work** — the grid is the friction.
2. **The organizer is stuck chasing the last one or two people** — the poke is the friction.

## What would make it real

Five friends get one link in the group chat. Each marks their availability on a phone in under
thirty seconds without making an account, and the last holdout answers after the tool pokes
them — **without the organizer sending a single follow-up text**.

That is the same shape as this repo's own spec sentence ("five friends in a group chat ... take
two minutes ... without asking anyone how"), which is part of why it fits here.

## Links opened

- **"whensgood"** — read as **WhenIsGood** (`whenisgood.net`); no site by the literal name
  turned up. Direct fetch of `whensgood.com` was blocked by the sandbox egress proxy, so what
  follows is from search-result summaries, not the site itself:
  - Create a date/time grid, share a link, respondents paint the slots they are free.
  - Free, **no accounts**; a $20/year tier removes ads and adds Excel export.
  - "It stops at collecting availability with no calendar invite, no payment, **no
    reminders**, and thin timezone handling."
  - Has been "quietly running the same way for well over a decade."

  So the gap the idea names is real and specific: WhenIsGood has no poke at all.

## What this repo already has that it would reuse

- **Deadline sweeper** — `packages/server/src/tick.ts:39` `runTick`, driven every minute by
  Cloud Scheduler → `POST /internal/tick` (`docs/deployment.md`). Already does "remind the
  people who haven't acted when time is short": `tick.ts:82-89` fires at
  `REMINDER_FRACTION = 0.25` of the window left (`tick.ts:32`), once per turn via
  `remindedTurn` (`tick.ts:163`), body at `tick.ts:134`. A response poll is a turn with one
  order per person and no resolution step.
- **The one mail door** — `packages/server/src/notify.ts:69` `notify()`, preference-gated,
  every message carries a one-click unsubscribe (`List-Unsubscribe` headers at
  `notify.ts:95-98`). Backed by Resend (`packages/server/src/mailer.ts:25`).
- **Signed links without sign-in** — `packages/server/src/unsub.ts:13` HMAC signer. The same
  trick could sign a per-respondent "answer from here" link so a poke is one tap, not a login.
- **Invite-by-link** — `packages/server/src/games.ts:322` `joinGame`, `app.ts:221` route; the
  invite link shape is deliberately kind-agnostic (`app.ts:70`).
- **Multiple "kinds" on one doc store** — `packages/server/src/store.ts:90`
  `GameDoc = War | Party | Sacre`. A poll could be a fourth kind, or a separate collection.
- **Firebase Hosting + Cloud Run + Firestore** pipeline — `docs/deployment.md`.

## What fights it

- **The web app is entirely behind Google sign-in** — `packages/web/src/main.tsx:29`
  `<RequireAuth>`. WhenIsGood's whole appeal is no account. `notify()` also keys everything on
  `uid` (`notify.ts:20-23`). A respondent-without-account path is new ground, not reuse.
- **The site is mothballed** (#40, `docs/deployment.md:437` onward; `paused/index.html` is
  what Hosting serves). Shipping this means relighting the stack or standing up a second one.
- **Email is not where five friends are.** The spec sentence says _group chat_. The repo
  sends email only; there is no SMS or chat integration.

## Candidate poke strategies (to be argued about, not adopted)

Named so the brainstorm has something to push against. None is researched yet.

- **Social proof / progress** — "4 of 5 have answered; it's down to you."
- **Visible holdouts** — the results page names who hasn't answered; mild public
  accountability.
- **Default with an out** — "We'll assume you can do any of these unless you say otherwise by
  Thursday." Turns silence into an answer, which flips who has to act.
- **Deadline / loss framing** — "Saturday is about to be locked in without you."
- **Friction removal** — a one-tap answer straight from the poke ("Can you do Sat 7pm? Yes /
  No"), rather than reopening a grid.
- **Organizer-sent, tool-written** — the poke is a pre-written message the organizer pastes
  into the group chat, so it comes from a friend's name in the channel people read.
- **Escalating cadence** — gentle → specific → last call, rather than one reminder at 25%.

## Assumed, not asked

- "whensgood" means WhenIsGood (whenisgood.net), not when2meet or another tool.
- Social events among friends, not work meetings — no calendar-sync integration needed for v1.
- It lives in this monorepo as a new kind/package and reuses the server, not a fork into a new
  repo. (Could be wrong — the mothball argues for something cheaper to host.)
- The group is small (2–12) and everyone is reachable through the organizer's group chat.
- Respondents must not need an account; the organizer may.
- "Effective psychology" means the poke should get a reply, not maximize engagement — it must
  not feel like a dark pattern to a friend.
- Work happens on the session's designated branch `ccr-c6180847-yl4zb4` rather than
  `idea/group-scheduler`, because this sandbox may only push there.

## Decisions

| Decision                                                                       | Rejected                                                                                                                                                                                                                            | Why                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pokes arrive as push notifications from an app every respondent installs (Q2). | Paid SMS (Twilio etc.); email via the existing `notify()`; organizer's own phone sending texts (Android SMS gateway, iOS Shortcuts automation); one-tap prefilled `sms:` links the organizer sends; carrier email-to-text gateways. | Texting is the best channel but must cost nothing, which rules out paid SMS. Email is not where friends are. The organizer-phone options keep the organizer in the loop or depend on one person's handset. Carrier gateways are being shut down (AT&T's included). Accepted cost: a holdout who never installs cannot be poked at all — the install is now the first poke. |
