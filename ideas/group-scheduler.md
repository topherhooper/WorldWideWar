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

## Feature to consider: plans that change with headcount

> A feature to consider is multiple options based on participation. Like different game
> suggestions based on confirmed count

Decided for v1 as organizer-typed tiers (Q10, below). A poll's outcome would be conditional on how many commit: each candidate time
shows its confirmed count and what that count unlocks ("3 → Catan, 5+ → Werewolf"). Two reasons it
matters beyond convenience:

- **It is a poke.** "One more and Saturday becomes Werewolf night" makes the holdout _pivotal_,
  which is a sharper lever than "4 of 5 have answered." It names what the group gains from them
  rather than what they are failing to do.
- **It ties back to this repo.** The repo's own games run at different headcounts (the balance
  gate sweeps 2/4/6/8/12 players, per `CLAUDE.md`); a scheduler that knows the confirmed count could
  suggest one of them. That is a link, not a dependency.

## Assumed, not asked

- "whensgood" means WhenIsGood (whenisgood.net), not when2meet or another tool.
- Social events among friends, not work meetings — no calendar-sync integration needed for v1.
  (The standing availability profile from Q6 stands in for calendar sync until the phone app.)
- It lives in this monorepo and reuses the server, not a fork into a new repo. Confirmed by Q11.
- The group is small (2–12) and everyone is reachable through the organizer's group chat.
- ~~Respondents must not need an account; the organizer may.~~ Overturned by Q4: accounts
  from the start. Q5: sign-in comes before the first answer.
- "Effective psychology" means the poke should get a reply, not maximize engagement — it must
  not feel like a dark pattern to a friend.
- Work happens on the session's designated branch `ccr-c6180847-yl4zb4` rather than
  `idea/group-scheduler`, because this sandbox may only push there.

## Decisions

| Decision                                                                                                                                                                                                          | Rejected                                                                                                                                                                                                                            | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pokes arrive as push notifications from an app every respondent installs (Q2).                                                                                                                                    | Paid SMS (Twilio etc.); email via the existing `notify()`; organizer's own phone sending texts (Android SMS gateway, iOS Shortcuts automation); one-tap prefilled `sms:` links the organizer sends; carrier email-to-text gateways. | Texting is the best channel but must cost nothing, which rules out paid SMS. Email is not where friends are. The organizer-phone options keep the organizer in the loop or depend on one person's handset. Carrier gateways are being shut down (AT&T's included). Accepted cost: a holdout who never installs cannot be poked at all — the install is now the first poke.                                                                                                                                                            |
| Ship a full web app first, then a separate native phone app; no Capacitor wrap (Q4). In the web phase, "installs an app" means Add to Home Screen and web push.                                                   | Capacitor wrapping the web app; native (Expo/React Native) from day one; web app only, forever.                                                                                                                                     | A real phone app is the long-term goal, but the web app is free and reuses `packages/web` and the server. The owner chose a separate native app over a wrapped web view. Native-only features (reading the phone calendar to pre-fill availability, Yes/No buttons on iPhone notifications) wait for the phone app.                                                                                                                                                                                                                   |
| Accounts from the start, one account shared and synced across web and phone app (Q4).                                                                                                                             | Anonymous respondents with no account (WhenIsGood's model); separate per-platform identities.                                                                                                                                       | Sync across devices needs a server-side identity, and Firebase Auth already provides one (`packages/web/src/auth.tsx`, `packages/server/src/auth.ts`). Cost: sign-in now sits in front of a first answer, the friction WhenIsGood avoids. Consequence for later: if the iOS app offers Google sign-in, App Store review requires Sign in with Apple too.                                                                                                                                                                              |
| Sign in before seeing or answering a poll (Q5).                                                                                                                                                                   | Firebase anonymous guest on link-open, answer first, upgrade to a real account after (`linkWithCredential` keeps the uid).                                                                                                          | One kind of user and no upgrade path to build or test. Accepted cost: every invitee meets a sign-in screen before the poll, which is the drop-off point WhenIsGood avoids, so sign-in must be one tap and the poll's title and who asked should show behind it.                                                                                                                                                                                                                                                                       |
| Each account keeps a standing weekly availability profile; every poll arrives pre-filled from it, and answering is confirming or fixing exceptions (Q6).                                                          | Painting a fresh grid per poll (WhenIsGood); tapping Yes/Maybe/No on organizer options with nothing pre-filled (Doodle).                                                                                                            | Accounts exist now, so availability can outlive one poll. After the first poll, answering is one tap. It also gives the poke a default-with-an-out to say ("we think you're free Saturday — confirm?"), and lets a poll show a likely answer before anyone responds. Cost: the first-time setup is a bigger ask than one poll, so it must be skippable or built from the first answer.                                                                                                                                                |
| An organizer creates a poll as a few candidate times; each respondent's profile pre-ticks Yes/No on each, and they confirm (Q7).                                                                                  | A date range where the tool proposes the best times by overlaying everyone's profiles.                                                                                                                                              | Cheapest version that works, phone-friendly, and keeps the organizer in charge of what is on the table. The date-range version is the more ambitious product and stays open as a later "suggest times" button on the create screen; it needs no change to the profile data, only a reader over it.                                                                                                                                                                                                                                    |
| Only an explicit answer counts. The profile pre-fills, but silence is never an answer; a holdout stays "not answered" until they commit (Q8).                                                                     | The profile answering for a silent respondent at the deadline (default-with-an-out); a per-poll organizer toggle for it.                                                                                                            | Owner: "They must commit." A pre-filled guess the friend never confirmed is not a plan anyone can hold them to. Consequence: pokes have to move people by pressure (progress, deadline, who is still missing) rather than by defaults, and a holdout can still stall the group, so the pokes carry the whole weight. The default-with-an-out candidate in the strategy list is dropped.                                                                                                                                               |
| Everyone in the poll sees who hasn't answered, by name, and any member can send a holdout a nudge that arrives as from them ("Alex is waiting on you for Saturday") (Q9).                                         | Organizer sees names while the group sees only a count; counts only, every poke sent by the app.                                                                                                                                    | Since silence never answers (Q8), pressure is the only lever left, and a nudge from a named friend lands harder than one from an app. It also spreads the chasing across the group instead of leaving it all to the organizer. Risk: it becomes a shaming tool, so peer nudges need a rate limit (proposed: one per friend per holdout per day).                                                                                                                                                                                      |
| v1 polls carry optional headcount tiers the organizer types ("3+: Catan", "5+: Werewolf"); each candidate time shows its confirmed count and the tier reached, and pokes can say "1 more unlocks Werewolf" (Q10). | A catalog of games with player ranges that suggests automatically; leaving tiers out of v1.                                                                                                                                         | Text plus a number is cheap, and it powers the pivotal-person poke from day one, which matters because pressure is the only lever (Q8). A catalog needs curating and covers only games, while tiers cover any plan that scales with headcount.                                                                                                                                                                                                                                                                                        |
| The scheduler lives in this repo, beside the game, importing the existing server code (Q11).                                                                                                                      | A new repo seeded with copies of `tick.ts`, `notify.ts`, `unsub.ts` and the auth pieces.                                                                                                                                            | Owner: "I would like to continue to maintain this fairly functional project." One repo keeps the game maintained alongside the new product, with no copied code to drift. What this costs: (1) `CLAUDE.md`'s one-sentence spec is about the game, so the scheduler needs its own; (2) `tools/ci/src/changed-areas.ts:44` knows only engine/server/web/tools, so a scheduler area is needed or scheduler-only changes will still run the game's sweeps; (3) shipping means relighting the mothballed site (#40, `docs/deployment.md`). |
