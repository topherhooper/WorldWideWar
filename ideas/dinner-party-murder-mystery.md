# Dinner party: a murder mystery, roles handed out by the host

## The idea, as it was said

> new idea. game type is dinner party. start with a murder mystery where some of the
> players could be 5yo or so. a key feature should be that before the game starts, roles
> are passed out by the host

Asked one question — where the game lives when the party is actually happening. Answer:
**phones at the table.** The host distributes roles through the site, privately; then
everyone plays live in the browser over dinner — accusations, reveals and resolution all
in-app.

## The one observable thing that would make it real

A host and four guests sit down to dinner, one of them five years old. The host taps
through role assignment on their phone; each guest's phone shows only their own role. Forty
minutes later the table names a murderer — and nobody at the table had the rules explained
to them by the host.

The five-year-old is not a decoration on that sentence. A player who cannot read fluently,
cannot hold a hidden agenda across an hour, and will announce their own role at the first
opportunity is the actual design constraint. If the game only works when everyone can keep
a secret, it is not this game.

## What this collides with

This repo's whole spec is one sentence in `CLAUDE.md`: _five friends in a group chat each
open the site once or twice a day, take two minutes to submit orders_. A dinner party
inverts every clause of it — same room instead of a group chat, one sitting instead of
twice a day, forty continuous minutes instead of two.

Two things survive the inversion, and they are the reason this is worth writing down rather
than starting a new repo:

- **Secret per-player state with one audited exit.** `redact()` is the only path state takes
  to a client (`packages/engine/src/redact.ts:28`), and it already carries a
  viewer-dependent secret: tier lists come back real for their author and shuffled for
  everyone else (`redact.ts:33-41`). A murder role is the same shape.
- **A pre-game gate that waits on secret submissions.** The tiers preset already refuses to
  start until every human seat has submitted a hidden list in the lobby —
  `submitLobbyList` (`packages/server/src/games.ts:432`), `canActivate`
  (`games.ts:261-266`), `activate` (`games.ts:269-284`). "Roles are passed out before the
  game starts" is that gate with the direction reversed: the host writes the secrets, not
  the player.

The third pillar of the current design — simultaneous secret orders resolved against a
deadline — has no obvious dinner-party analogue and may simply not come along.

## What the code actually does today

Where the existing shape helps, and where it is in the way.

**"Game type" is already a first-class concept, but shallower than this needs.**
`PresetId = 'pact' | 'tiers' | 'pact-blitz' | 'tiers-v2'` (`packages/engine/src/presets.ts:24`)
and `ContestKind = 'pact' | 'tiers'` (`packages/engine/src/types.ts:332`). Every one of
those is a _combat multiplier variant_ of the same territory game. They share a map, armies
and orders. A murder mystery is not a fifth entry in that union — the union is one level
too deep.

**Game creation welds a game to the map.** `createGame` generates a map before the lobby
even fills (`packages/server/src/games.ts:88`) and stores `mapJson` on the doc
(`games.ts:107`). A game with no territory has nowhere to sit in `GameDoc` as written.

**Every seat is an authenticated account with an email.** Seats hold
`{ uid, name, email, isBot }` (`games.ts:91`), and `verifyUser` builds that from a Firebase
ID token (`packages/server/src/auth.ts:29-33`). A five-year-old has no Google account and no
email. Either the host's device fans out to guest devices some other way, or seats need a
guest identity that is not a login. This is the hardest structural collision, and it is
load-bearing for "phones at the table" — five phones need five identities in under a minute,
at a table, before the food gets cold.

**Pacing is measured in days.** `deadlineAt = now + turnMinutes * 60_000`
(`games.ts:283`) with `defaultTurnMinutes: 1440` (`presets.ts:49`). Nothing forbids small
numbers, but every affordance around the clock — the email reminder in
`packages/server/src/notify.ts`, the Cloud Scheduler tick in `packages/server/src/tick.ts` —
assumes a slow game.

**The onboarding failure already on record is the same failure this idea would hit harder.**
Three of four players could not enter a valid order without being walked through it over
text — `docs/onboarding-gaps.md`, open as `tasks/submit-orders-unaided.md`. A dinner party
has no group chat to be walked through in, and one player is five. The bar here is strictly
higher than the bar the repo is currently failing to clear.

No links were mentioned, so none were opened.

## Assumed, not asked

- **This is a new game _type_, a sibling of the war game, not a fifth preset inside it.**
  Shared account/lobby/redaction plumbing, different rules package. If it is meant to be a
  mode of the war game, this doc is wrong from the top.
- **The host is a player too**, not a neutral game master — they have a role like everyone
  else, and the murderer might be them. Cheaper socially: nobody sits out their own dinner.
- **Host-assigned, not host-authored.** The host presses a button and the site deals roles;
  the host does not write the mystery. Authoring a mystery per party fails the two-minute
  test before the game even starts.
- **Roles are dealt to devices, not printed.** "Passed out by the host" is an act of
  authority over the deal, not a physical card — though a printable fallback for the
  five-year-old, who may not have a phone, is an open question.
- **Party size is roughly 4–8**, table-sized, and not the 2–12 the map generator spans.
- **One sitting, no persistence between parties.** No reputation system carrying across
  dinners, which is the mechanism the war game leans hardest on.
- **Ages are an input.** The host says who is young, and the game gives those players
  simpler roles — a public, concrete job rather than a secret to hold. Nobody has decided
  whether that is a difficulty setting, a separate role pool, or something the game infers.
- **"Some players could be 5yo" means mixed ages at one table**, not a separate under-6
  edition. The adults still want a real game.

## Prototype goal

With the host on one browser window and four guests on four more — one of them marked as a
little kid — the host taps Deal once, and every window then shows exactly one role, its own,
the kid's window showing a public job instead of a secret, and no guest able to obtain
another guest's role from the server by any request they are able to make.

That last clause is the half worth building. Dealing roles is a shuffle; the thing this repo
already knows how to get right, and the thing a dinner party would be ruined by getting
wrong, is that a secret has exactly one way out to exactly one viewer.

## What the prototype showed

Built in `prototypes/dinner-party/` — one Node file, one HTML string, in memory, no deps.
Driven with five separate browser contexts (five phones) under Playwright. The goal was met:

```
Topher (host)  The Rival        SECRET
Jeff           The Detective    SECRET
Dana           The Heir         SECRET
Sam            The Murderer     SECRET
Nora (5)       The Dog          public job
```

every window shows exactly one card · the kid got a public job · the murderer is a grown-up

**The identity problem mostly evaporated.** The capture called it the hardest structural
collision — five phones, five identities, no logins, a five-year-old with no email. At
prototype scale it took a four-letter room code read aloud (`makeCode` drops vowels and
`I/O/0/1`, so it survives being shouted across a table) and an opaque token in
`sessionStorage`. Nobody signed in. That does not make the collision with
`packages/server/src/games.ts:91` disappear, but it reframes it: the dinner party does not
need the account model, so the question is whether it can be allowed to skip it rather than
how to stretch it.

**The redaction property was cheap, and cheap for a specific reason.** `viewFor` assembles a
response addressed to one token rather than filtering a fuller one down. A leak would
require adding code, not forgetting to remove it. Forged tokens, empty tokens and guessed
UUIDs all return `me: null`, and a guest's entire response body mentions zero roles besides
their own. This is the same shape as `redact()` and it cost about fifteen lines.

**Surprise 1 — the host is not a player unless you make them one.** Built the obvious way,
`hostToken` and a player token are different things, and the host ends up a game master who
sits out their own dinner. That contradicts an assumption written down two hours earlier.
Worked around by having one token carry both capabilities: authority to deal, and a seat to
be dealt to. It is a token-design question, not a UI one, and it will recur in any real
version.

**A deduction the design hands out for free.** The roster is public including the little-kid
flag, and kids are dealt from the public pool, so the whole table can infer that no kid is
the murderer. Probably what you want at a real dinner party — but it is a rule nobody chose,
falling out of the age split.

**What it does not show.** Whether any of this is fun. The prototype deals; it does not play.
Whether a five-year-old is satisfied by ringing a bell, and whether the adults' mystery
survives having a barking dog at the table, are questions no amount of dealing answers.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                        | Rejected                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Each tale brings its own mechanic.** The story dictates the rule, so a tale is code rather than content: The Little Mermaid means one player genuinely may not speak all evening; Sleeping Beauty means a curse-clock the table has to beat; Swan Lake means an impostor wearing another player's face. Accepts that only two or three tales will ever exist. | **One engine, many skins** — keep the prototype's hidden-role deduction and let the fairytale supply names, cards and art.                                                                                                                                  | The skin version makes a new tale a JSON file and five tales a weekend, which is most of its appeal. It was rejected because Sleeping Beauty has no traitor in it: re-skinned, it becomes a murder mystery in a tiara, and the tale is doing no work. The mechanic _is_ the story — a mermaid who cannot speak is a rule a five-year-old will remember for a decade, and it cannot be reached by renaming a murderer.                                                                                                                                                                                                                                                                                                             |
| 1b  | (same decision)                                                                                                                                                                                                                                                                                                                                                 | **Not a deduction game at all** — cards hand out parts and the evening is acting the tale out, nobody wins.                                                                                                                                                 | Closest to what a princess-loving five-year-old actually wants, and it survives as the shape of the _kid-facing_ half of a tale. Rejected as the whole design because the adults at the table need something with teeth, and an evening nobody can win is one nobody argues about afterwards — which is the repo's whole test for whether a game worked.                                                                                                                                                                                                                                                                                                                                                                          |
| 2   | **The parent and kid are a secret two-person team** — they know each other's roles, they win or lose together, and the table does not know they are bound.                                                                                                                                                                                                      | **Kid has the power, parent has the knowledge** (two halves of one role, useless apart, forcing them to whisper); **parent is the kid's voice** (one role, two legitimate viewers); **parent runs the kid's moment** (parent has no role, kid is the star). | Chosen for what it gives the kid that the prototype did not: a confidant, and a stake in the real game rather than a public job invented to keep them busy. The voice option was the runner-up and is the one to revisit if pairs prove too strong, since it is the only one that lets a five-year-old hold a role as large as the impostor. Known cost, accepted with eyes open: this leans on a five-year-old keeping a secret, which the capture says outright they will not do. Treat "the kid will blurt it" as a design input rather than a bug — a pair whose cover survives being announced is the thing to aim for.                                                                                                      |
| 3   | **Up to 20 players.** The game must work at a party, not only at a table of five.                                                                                                                                                                                                                                                                               | **A dinner table of five to eight**, which is what the capture assumed and the prototype was built and tested against.                                                                                                                                      | Direct call from Topher. It is the most expensive decision here, because several tale mechanics under decision 1 are silently table-sized: a mermaid who may not speak is a rule nobody notices in a room of twenty, and a single impostor among twenty is not a deduction, it is a lottery. Twenty does not threaten the plumbing — a four-letter code and per-token cards scale without changes — it threatens the fiction.                                                                                                                                                                                                                                                                                                     |
| 4   | **Mingling — the evening is a mesh of private two-person encounters**, with no shared conversation at any point. Your phone tells you who to find; the game happens in exchanges around the room.                                                                                                                                                               | **Courts** — four tables of five inside the party, each playing its own tale, with something crossing between them; **a show the host runs** — one conversation with hard beats, Werewolf at party scale.                                                   | Scales past twenty without strain, and the courts option was the expensive one (a cross-court layer on top of the tales). Two costs, one of which turned out not to be a cost: mingling was offered with the warning that it hands a five-year-old a room of strangers and stops the parent+kid pair moving together — but under decision 2 the pair is exactly the mitigation, since a bound parent and child have every reason to work the room as one unit, and the kid is chaperoned by the rules rather than by an exception. The real cost stands against decision 1: table-sized mechanics do not survive. A mermaid who may not speak is invisible in a mingle, so that tale needs a different rule or does not get made. |
