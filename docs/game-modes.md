# Game modes — what each one is, and how to add another

The home grid shows seven cards. Clicking any of them does exactly one thing: `POST /api/games`,
then land on `/g/:id`. That uniformity is deliberate and it is the only thing the seven cards
have in common — behind them sit **four different mechanisms**, and picking the wrong one is
the expensive mistake this document exists to prevent. Adding a card can cost one array entry
or it can cost a second half of the server.

Read this alongside `packages/engine/src/presets.ts` (the cheap axis) and
`packages/engine/src/party/types.ts` (the expensive one).

## The four axes

| Axis           | Values today                                      | Decided in                       | Cost of one more                       |
| -------------- | ------------------------------------------------- | -------------------------------- | -------------------------------------- |
| **Preset**     | `pact` `tiers` `pact-blitz` `tiers-v2` `survival` | `packages/engine/src/presets.ts` | one array entry, one test              |
| **Contest**    | `pact` `tiers`                                    | `packages/engine/src/contest/`   | an implementation plus eight seams     |
| **Party mode** | `traitor` `together`                              | `packages/engine/src/party/`     | branches in deal, rules, actions, copy |
| **Kind**       | `war` `party`                                     | `GameKind` / the `GameDoc` union | a second half of the server and client |

A preset is a **dial setting**. A contest is **new rules inside the war game**. A party mode is
**new rules inside the party**. A kind is **a different game that happens to share a lobby**.
Always try to be a preset. The order above is the order to try them in.

## What each mode is today

### The five war presets

A preset is the identity a war game is created with: it fixes the contest, the tiers payout and
the pacing, and it is **immutable after creation** (`updateConfig`,
`packages/server/src/games.ts:366`). Players, turn length and game length stay lobby-editable.

| Preset       | Contest | Tiers payout | Turn cap | Turn length | War economy   | Neutral Δ | Plunder |
| ------------ | ------- | ------------ | -------- | ----------- | ------------- | --------- | ------- |
| `pact`       | pact    | multiplier   | 10       | 24 h        | every 5 turns | −1        | 1       |
| `tiers`      | tiers   | multiplier   | 10       | 24 h        | every 5 turns | −1        | 1       |
| `pact-blitz` | pact    | multiplier   | 8        | 1 h         | every 3 turns | −2        | 2       |
| `tiers-v2`   | tiers   | income       | 8        | 1 h         | every 3 turns | −2        | 2       |
| `survival`   | tiers   | pooled       | 8        | 24 h        | every 5 turns | 0         | 1       |

Every preset targets a 5-10 turn game, and `MIN_TURN_CAP` is 5. A 25-turn match at a turn a day
was a month of real time, which is longer than a group chat holds a thread. The competitive four
share the anti-turtle economy — neutral growth off, cheap neutrals, plunder on — because
mechanics that reward doing nothing are not fun. The blitz pair runs it hotter for a measured
reason recorded in the header comment of `presets.ts`. `survival` is the exception on neutrals:
it leaves them at mapgen strength, because in co-op the neutral garrison is the enemy rather than
a speed bump between rivals.

Short games cost something, and it is recorded rather than fixed: the competitive victory bars in
`constants.ts` were measured at 25 turns, and at a 10-turn cap 77% of six-player pact games end on
the turn cap instead of in a win. Survival is unaffected, having no early win to reach. See
[docs/design/coop-survival.md](design/coop-survival.md).

**Pact** is the loyalty game: one blind pledge per turn, and the resulting multiplier (×0.80 to
×1.40) applies to every battle you fight. It draws no randomness at all. **Tiers** is the
legibility game: a six-entry tier list per turn, pipelined so a list written on turn N is
published shuffled in the turn-N report, guessed during N+1, and revealed at N+1's resolution.
**Tiers v2** changes where the score lands — guesses pay income directly and every side fights
at a flat ×1.00, so the "biggest lever in the game" is switched off and only the dice separate
two equal stacks (`packages/web/src/game/HowCombatWorks.tsx`).

**Survival** is the cooperative one, and the only preset that changes who you are playing
against. It takes tiers-v2's flat combat and pools the payout: every read scored in a turn sums
into one coalition pot, split among whoever still holds ground. The storm stops being a
symmetric clock and becomes the opponent, driving `stormRaiders` armies onto the map's permanent
core each wave. There is no early win — the coalition can only still be there when the storm is
spent — and the score is how many players are left standing. Two rule flags carry it, `coop` and
`stormRaiders`, both defaulting off so every game in flight keeps today's behaviour.

Its one genuinely different rule is that **losing your last province does not end your turn**:
a landless player keeps writing a list and reading allies, and those reads still pay the people
still fighting. That rule has a single home, `packages/engine/src/participation.ts`, because
resolution, the balance harness, the order route, the deadline sweep and the client all have to
agree about it — and when they did not, the mechanic was scored by the engine and fed by nobody.

### The two party modes

Both are the same tale (Sleeping Beauty), the same `kind: 'party'` document, the same
invitation and the same evening structure. `mode` lives _inside_ `partyJson`, not on the
document — adding one changes no document schema.

|                   | **Dinner Party** (`traitor`)                  | **Bedtime Party** (`together`)                         |
| ----------------- | --------------------------------------------- | ------------------------------------------------------ |
| Who did it        | a grown-up at the table                       | a courtier who went home                               |
| Suspects          | grown-ups present                             | six absent guests (`TOGETHER_SUSPECTS`)                |
| Minimum grown-ups | 3                                             | 1                                                      |
| Falsehoods        | a budget, held by the curser                  | none — `lieBudget` is 0, so nobody can lie             |
| Duo characters    | all four                                      | nursemaid and spinner only                             |
| An accusation     | nomination, then a weighted vote on the floor | settles on the spot — naming a courtier _is_ the guess |
| Opening dials     | 5 candles, 5-minute rounds                    | 3 candles, 2-minute rounds (about ten minutes)         |

The three-grown-up floor on `traitor` is arithmetic, not taste: a nomination carries on
`yes * 2 > total`, so with two grown-ups the innocent one can raise at most half the voices and
the curse can never be broken (`packages/engine/src/party/constants.ts`). `together` exists for
exactly the sizes where that half cannot function, and it keeps the child-facing game intact —
which is the entire point of playing with a four-year-old.

Design and the rejected alternatives: [docs/design/dinner-party.md](design/dinner-party.md).

## The spine every mode shares

This is what "integrates into the site" means concretely. Every mode walks the same nine steps;
the only question is where it branches.

| Step               | File                                                  | What it decides                                                     |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------- |
| 1. The card        | `packages/web/src/pages/Home.tsx`                     | what the grid offers and what payload the click sends               |
| 2. Create          | `packages/server/src/app.ts` `POST /api/games`        | dispatch on `kind` → `createGame` or `createPartyGame`              |
| 3. The document    | `packages/server/src/store.ts`                        | `WarGameDoc \| PartyGameDoc`, discriminated on `kind`               |
| 4. The read        | `app.ts` `GET /api/games/:id`                         | dispatch on `kind` → `getView` or `getPartyView`                    |
| 5. The client fork | `packages/web/src/pages/Game.tsx` (`GameInner`)       | `WarGame` or `PartyGame`, on `view.kind` — absent is war            |
| 6. The lobby       | `pages/Lobby.tsx` / `party/PartyLobby.tsx`            | which dials the host may turn before the game starts                |
| 7. The write       | `PUT /games/:id/orders` / `POST /games/:id/party/act` | one route per kind; the party has exactly one for all eight actions |
| 8. The deadline    | `packages/server/src/tick.ts`                         | resolve a war turn, or advance a party phase                        |
| 9. The poll        | `packages/web/src/useGame.ts` `pollIntervalFor`       | 15 s async war turn vs 2.5 s live mingle                            |

Two things about that spine are worth stating out loud, because both were arrived at the hard
way:

**One status enum, not two.** A dealt-but-unrung party is `status: 'active'` with
`phase: 'invited'` and no deadline, rather than a fourth `GameStatus`. A status is a wire value
a cached bundle will render, and two enums that can disagree about the same game are worse than
one (`packages/server/src/api-types.ts`).

**The party writes on read.** `getPartyView` advances the clock and may write. A once-a-minute
sweep cannot drive a ninety-second vote window, so the lazy advance is the mechanism and
`tick.ts` is the backstop for a room that has pocketed its phones. Any mode with sub-minute
phases inherits this problem.

## Adding a mode

### 1. A new preset — the cheap case

Enough when the new mode only re-dials knobs that already exist: contest, tiers payout, turn
cap, turn length, war economy interval, neutral delta, plunder, and the two co-op flags (`coop`,
`stormRaiders`). A preset may carry rule flags as well as numbers — but only flags whose default
is the behaviour every existing game already has, since `presetRules` writes them into documents
that older code will read back.

1. Add the id to `PresetId` and an entry to `PRESETS` in `packages/engine/src/presets.ts`.
2. Add a case to `packages/engine/src/presets.test.ts` saying what makes it different.
3. Nothing else. `Home.tsx` maps over `PRESETS`, and `createGame` accepts any id
   `presetById` resolves.

Two things to know before picking numbers. Ids that match a `ContestKind` are load-bearing:
`presetById(game.presetId ?? contest)` is how a lobby created before presets existed still
resolves to one, so `pact` and `tiers` must keep meaning what they mean. And CI will run the
800-game balance sweep across 2/4/6/8/12 players on any `packages/engine/` change, with a
fairness gate that exits non-zero — tune against `pnpm sim --preset <id>` first.

Changing an existing preset's dials is also safe for games in flight, because `presetRules`
freezes the resolved `RuleConfig` into the document at creation and stored rules win
(`effectiveRules`, `store.ts`). What a preset edit changes is what _new_ games get.

### 2. A new contest

`packages/engine/src/contest/types.ts` defines the interface, and it exists precisely so a
second implementation can drop in without the resolution pipeline learning anything about it.
Two properties are non-negotiable: input is **pre-committed** alongside orders, and resolution
is **deterministic** given `(state, inputs, rng)`. A contest that wants a second round of input
would double turn latency and let one absent player stall everyone else's battles.

The interface is one function; the wiring is eight seams:

1. `ContestKind` in `packages/engine/src/types.ts:332`, which widens `RuleConfig.contest`.
2. The implementation in `contest/<name>.ts`, returning `ContestOutcome` — a multiplier per
   slot ×100, bonus income per slot, and a per-slot result for the report.
3. The input field on `OrderSet` and its passthrough in `normalizeOrders`
   (`orders.ts:67`) — and it must default to `null`, never throw on rubbish.
4. Report types: a `<name>: Result[]` array on `TurnReport`, empty in the other contests.
5. Dispatch in `resolve.ts` phase 4 (`packages/engine/src/resolve.ts:126`). Today that is a
   ternary; a third contest is the point at which it should become a lookup on `Contest.id`.
6. Redaction. The input must not survive `redact()`, and any state the contest parks on
   `GameState` needs its own rule there — see how `tiersLists` is handled
   (`packages/engine/src/redact.ts:34`).
7. Bots, in two places that must agree: `packages/server/src/resolve.ts:95` for real games and
   `packages/engine/src/simulate.ts:126` for the balance harness. A contest with no bot
   decision makes every sweep meaningless rather than failing loudly.
8. The client: an input panel beside `OrdersPanel`, a branch in `HowCombatWorks`, and a lobby
   pre-game submission if the contest needs one before turn 1 (tiers does; pact does not).

Then give it a preset. A contest with no preset selecting it is unreachable from the site.

### 3. A new party mode

1. Widen `PartyMode` (`packages/engine/src/party/types.ts`), and the `partyMode()` parser in
   `packages/server/src/party.ts` — it is a whitelist, so an unknown string degrades to
   `traitor` rather than erroring.
2. Add its opening dials to `DIALS` in the same file.
3. Branch the rules that read mode: `minGrownUps` and `suspects` in `party/rules.ts`, the cast
   and the lie budget in `party/tale.ts` (`duosFor`, `dealTale`), and whatever an accusation
   means in `party/actions.ts`.
4. `redactParty` already publishes `mode`, so the client can branch on it — the copy lives in
   `PartyLobby.tsx`, `Invitation.tsx` and `PartyNight.tsx`.
5. One more card in `Home.tsx` sending `{ kind: 'party', mode: '<name>' }`, and a row in the
   `it.each` in `Home.test.tsx`.

No document field changes, and no migration: mode is inside `partyJson`, and every party
written before yours still parses.

A new **tale** is not this — it is the largest change the party can take, and the design already
ruled out the JSON-skin version of it. [docs/party-tales.md](party-tales.md) says what a tale
actually is here, and why a mode is usually the right answer instead.

### 4. A new kind

The party is the worked example, so read `git log` around it as the cost estimate rather than
starting from this list. It needed: the `GameKind` union and the `GameDoc` discriminated union
with `isPartyDoc`/`isWarDoc`; a second create function; dispatch in `GET /api/games/:id`; four
routes of its own; its own redactor; its own client tree; its own branch in the tick sweep; its
own poll interval; an `asWarDoc` guard on every war-only endpoint (answering 409, not 500,
because a stale bundle can genuinely send one); and `?? 'war'` fallbacks wherever `kind` is
read, because every document written before it lacks the field.

Justify it the way the party did: it shares a lobby, an invite link, seats and a deadline with
the war game, and **nothing else** — no map, no armies, no turn resolution. If the new thing
shares the map or the orders pipeline, it is a contest or a preset wearing the wrong costume.
If it shares nothing at all, it is a different site.

## Rules that bite whichever route you pick

- **The engine is pure.** No clock, no I/O, no ambient randomness; every draw goes through
  `substream(seed, ...)`. Time arrives as a value — that is why `PartyContext` carries `nowMs`.
  ESLint enforces this by path, which is why the party lives inside `packages/engine`.
- **Invalid input degrades, never throws.** A pledge to a dead player is an abstention. An
  unknown party mode is `traitor`. A rejected party action returns the state it was given plus
  a sentence the guest can read.
- **`redact()` is the only path state takes to a client**, and a mode that invents secret state
  invents a redaction bug at the same moment.
- **Stored documents predate your change.** `?? 'pact'`, `?? []`, `?? 'war'`, `kind` absent
  meaning war — every one of those is load-bearing, not defensive habit.
- **Cloud Run deploys ahead of Firebase Hosting.** For a window after every deploy, an open tab
  posts the _old_ payload to the _new_ server. That is why `createGame` still accepts a bare
  `contest` with no `presetId`, and it is the reason a new required field on a create request
  is a breaking change.
- **CI runs what you touched.** `packages/engine/` pulls in the 300-seed mapgen sweep and the
  800-game balance run (`tools/ci/src/changed-areas.ts`); `packages/server/` or
  `packages/engine/` pulls in the emulator suite. A preset is an engine change.

## Checklist

1. Which axis? Preset, contest, party mode, kind — in that order of preference.
2. Does it reach the site? A card in `Home.tsx`, or a preset in `PRESETS` that the grid renders.
3. Does it survive a redaction pass with nothing secret leaking?
4. Do bots play it — both in `server/resolve.ts` and in `simulate.ts`? And if the mode changes
   _who may still submit_, does every gate agree — resolution, both bot loops, the order route,
   and the deadline sweep? Survival shipped with that rule scored in the engine and fed by
   nothing, which looks exactly like a working feature until you count the armies.
5. Does a game created yesterday still load, and does yesterday's web bundle still create one?
6. Does the player find out what it is without being told over text? See
   [docs/onboarding-gaps.md](onboarding-gaps.md) — this is the failure that has actually
   happened, three times out of four.
