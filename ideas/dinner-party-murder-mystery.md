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

This repo's whole spec is one sentence in `CLAUDE.md`: *five friends in a group chat each
open the site once or twice a day, take two minutes to submit orders*. A dinner party
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
those is a *combat multiplier variant* of the same territory game. They share a map, armies
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

- **This is a new game *type*, a sibling of the war game, not a fifth preset inside it.**
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
