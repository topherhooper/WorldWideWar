# Dinner Party — a fairytale mingle for twenty

Date: 2026-08-25
Status: Prototyped end-to-end, unvalidated with real players

## Summary

A second game type beside the war game: an in-person party game for up to twenty guests, run
on their phones, built so that a five-year-old is genuinely playing rather than being kept
busy. The first tale is Sleeping Beauty. Someone at the christening laid the curse; the hall
has until the last candle goes out to work out who.

The design rests on one idea. **The children and the adults are playing two different games,
and the games are coupled.** A child's game is being a princess and recruiting grown-ups into
the story. An adult's game is assembling the tale from fragments. The coupling is that
children hold clues sealed behind a pretend-favour, so the grown-ups cannot finish their
puzzle without kneeling to a child first.

This document exists for the decisions table below. The narrative of how the thing was built
is in the pull request; the code is a throwaway prototype in `prototypes/dinner-party/`.

## The shape, as prototyped

Guests join by typing a four-letter code the host reads aloud — no accounts, no email, no
login. A child names the grown-up they came with, and the two of them are dealt a **duo
character** with an ability neither half has alone.

The evening runs in timed rounds. During a round guests mingle: you claim you met someone,
they confirm, and both sides are dealt a piece of the puzzle. **You are never told who a
piece came from, but everyone knows who met whom.** That asymmetry is what makes a liar both
possible and catchable, because the curser is the only guest whose phone can hand over
something untrue.

When the bell rings, mingling closes and one name goes to the floor. A banished guest is not
out — they keep mingling, keep collecting and keep arguing, with one voice left to spend.
Banish the curser and the curse breaks. Let the last candle go out and Aurora sleeps.

## Decisions (settled during brainstorming)

The rejected column is the durable half — it is the only part of this git history cannot
reconstruct.

| Question                                             | Decision                                                                                                                            | Rejected, and why                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where does the game live during the party?           | Phones at the table. The host deals roles privately, then everyone plays live in the browser.                                       | Paper at the table (the site as a pre-party generator) and a host-only screen. Both make the site a prop rather than the game.                                                                                                                                                                  |
| Is a new tale a re-skin or its own mechanic?         | Its own mechanic. A tale is code, so only two or three will ever exist.                                                             | One engine, many skins — a new tale as a JSON file, five tales in a weekend. Rejected because Sleeping Beauty has no traitor in it: re-skinned it becomes a murder mystery in a tiara, and the tale does no work. The mechanic _is_ the story.                                                  |
| Is it a deduction game at all?                       | Yes, for the adults.                                                                                                                | A pure play-along where nobody wins. Survives as the shape of the child-facing half, but an evening nobody can win is one nobody argues about afterwards.                                                                                                                                       |
| What does a parent and child pairing do?             | They are a secret two-person team who win or lose together.                                                                         | Kid-has-power/parent-has-knowledge; parent-as-the-kid's-voice; parent-runs-the-kid's-moment. The voice option is the one to revisit if pairs prove too strong — it is the only one that lets a child hold a role as large as the curser.                                                        |
| How many guests?                                     | Up to twenty.                                                                                                                       | A dinner table of five to eight, which the capture assumed. Twenty does not threaten the plumbing; it threatens the fiction, and it rules out every table-sized mechanic.                                                                                                                       |
| What shape is the evening at that size?              | A mingle — private two-person encounters, no shared conversation at any point.                                                      | Courts (four tables of five with a crossing layer) and a host-run show. Twenty people cannot hold one conversation; that is physics, not preference.                                                                                                                                            |
| What does the mingling produce?                      | The tale gets assembled. Every guest holds fragments; the room reconstructs who did what.                                           | Enacting the tale (the curse spreads by contact, someone actually falls asleep) and a chase. Enacting was the one a five-year-old could play without reading a word, and choosing assembly made "how does the child play" a problem that then had to be solved deliberately.                    |
| So what is the five-year-old?                        | Not a role in the puzzle at all. Two coupled games: she plays pretend, the adults solve, and her favours gate their clues.          | Four framings — the only witness, the truth-teller, the courier, full parity in pictures. All four made her a piece inside the adults' deduction and differed only in which piece. That is the wrong axis: any puzzle role makes her the smallest player in a game she cannot follow.           |
| Who confirms a favour was really done?               | The child's own grown-up. A guest claims, the partner vouches.                                                                      | Self-reporting on the claimant's phone (an honour system) and putting a device in the child's hands. The child never touches a phone.                                                                                                                                                           |
| How can the curser act?                              | They alone may hand over something untrue, two or three times a night, delivered anonymously on an encounter.                       | A curse that spreads by touch. Far more legible to a child, and rejected because it announces the culprit's position — the room triangulates the infection front in ten minutes.                                                                                                                |
| How does a round end, and what happens to the loser? | Timed rounds, one nomination at a time, a weighted vote. Banishment does not remove anybody: they keep playing with one voice left. | Elimination, the ordinary Werewolf ending. At twenty guests that leaves ten people with nothing to do and no right to speak, which is the failure mode of every Mafia clone at this size. Taken from Blood on the Clocktower.                                                                   |
| How does the curser win?                             | Five candles. One burns each round, a second whenever the hall banishes an innocent. Last candle out and Aurora sleeps.             | A plain round cap, and a secret errand for the curser. The tale's own prompt already said _before the last candle goes out_, and taking it literally prices a wrongful banishment and gives the curser something to play for. It is also the only part of the adults' clock a child can read.   |
| Is a parent-and-child a character or a link?         | A character. Four duos, each with an ability neither half has alone.                                                                | The pair as bookkeeping — two ordinary parts with a private link. The pair's advantages had been accumulating as special cases across `weightOf` and `viewFor` with nothing to point at and explain at the table.                                                                               |
| What is a duo worth in a vote?                       | Two voices. A guest who came alone has one. Nothing else moves the number.                                                          | Crown-scaled weight — one voice per grown-up who had knelt to your child, capped, and doubled again for the Godmother. It put a well-liked child's grown-up at six voices against a plain guest's one, decisive alone in a hall of twelve, and no amount of simulation could settle the number. |

## The cast

Four duo characters, each built from state the game already tracked, so four distinct
abilities needed no new machinery:

| Duo                                     | Ability                                                 | Built from            |
| --------------------------------------- | ------------------------------------------------------- | --------------------- |
| The Godmother and her Godchild          | Any falsehood reaching her own hand shows itself to her | the piece `fake` flag |
| The Huntsman and the Wolf-Cub           | One question a night: has this guest ever told a lie?   | the lie ledger        |
| The Nursemaid and the Sleeping Princess | She sees every meeting in the hall, not only her own    | the encounter graph   |
| The Spinner and the Thread-Holder       | A piece dealt to the child reaches the grown-up too     | the piece deck        |

## What the prototype established

- **The tale is answerable by construction.** Costumes are dealt distinct and the three
  clues that pin the culprit are always in the deck. 3600 random parties from 3 to 20
  guests: zero unsolvable. An earlier version sliced the clue pool to one per player and
  could slice the pinning clues out, leaving a puzzle with no answer and no way to notice.
- **Falsehoods never silently convict an innocent.** Over 2000 parties with every falsehood
  planted, the room either still names the curser or sees a visible contradiction. The
  contradiction is the tell, and it is what makes the encounter graph worth reading.
- **The design scales the right way.** More guests means more encounters, which means a
  tighter intersection when the room compares who met whom. Most hidden-role games degrade
  at twenty; this one sharpens.
- **No child needs to read, and no child needs a device.** Their screen carries a character,
  a price, a crown count and the candles. Nothing on it is load-bearing text.

## What is not settled

Whether an evening of it is fun. The prototype proves the machine runs and the puzzle is
fair, and says nothing at all about the thing that matters. Every number in it — five
candles, three falsehoods, ninety seconds on the floor, two voices for a duo — is a guess
that wants a real table.

The relationship to the war game is also open. This shares nothing with `packages/engine`
and would not want to: no map, no armies, no turn resolution. What it might share is the
account and lobby plumbing — except that the one thing the prototype demonstrated most
clearly is that a dinner party does not want the account model at all. Twenty guests were
seated in under a minute on a four-letter code and an opaque token, against
`packages/server/src/games.ts:91`, which binds every seat to a Firebase uid.

## The port, 2026-08-25

The prototype is gone; the party is a mode inside the app, reached by the same `/g/:id` link
as every other mode. What follows is the decisions that port made, in the same shape as the
table above — the rejected column being the half git history cannot reconstruct.

| Question                                          | Decision                                                                                                                       | Rejected, and why                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How does a guest without an account play?         | `Seat.dependents` — one Google sign-in speaks for everybody who arrived with it.                                               | A `children: string[]` field. Same code, narrower: a grandparent whose phone will not finish an OAuth redirect on somebody's guest wifi is the same problem as a five-year-old, and `young: false` costs nothing now and a schema migration later.                                                                        |
| Where does "dealt but not started" live?          | A party _phase_ (`invited`), at `status: 'active'` with no deadline.                                                           | A fourth `GameStatus`. It is a wire value read by the home page, the summary list and the sweeper's query; a bundle cached across a deploy would render an unknown one as "Turn 0", and two enums that can disagree about one game is worse than one.                                                                     |
| How does a party document coexist with a war one? | A discriminated union on `kind`, absent meaning war.                                                                           | One wide record with `mapJson`/`rules`/`stateJson` optional. The union turned twenty-six war-only reads into compile errors that named themselves; the wide record would have turned them into runtime surprises on a game with no map.                                                                                   |
| What drives the party clock?                      | A lazy advance at the top of every request, with `tick.ts` as the backstop.                                                    | The sweeper alone. It runs once a minute, and the floor is open for ninety seconds — a minute of latency is invisible on a five-minute round and ruinous on the vote.                                                                                                                                                     |
| How is randomness keyed?                          | On stable facts — `(guest, pieces held)`, `(curser, budget left)`.                                                             | A running action counter. A wall-clock advance interleaving between two actions would shift the stream and break replay; a hand only grows and a budget only falls, so those keys are fresh by construction.                                                                                                              |
| Is two grown-ups a playable hunt?                 | No. Three minimum.                                                                                                             | The prototype's two, which reasoned only that one of them did it. Necessary, not sufficient: a nomination carries on `yes * 2 > total`, so the lone innocent raises at most half the voices in the room and the curse can never break. Two also makes the deduction vacuous.                                              |
| So what does a family of four play?               | `together` — nobody at the table did it, the culprit is one of six courtiers who went home, and an accusation settles at once. | Padding the suspect list while keeping the vote, and simply requiring a third adult. The first leaves falsehoods with nobody to come from; the second does not meet the case. This is the "pure play-along" rejected above as a whole evening, kept for the size where the hunt cannot run.                               |
| Which duos does a co-operative party deal?        | Only the Nursemaid and the Spinner.                                                                                            | All four. The Godmother sees falsehoods and the Huntsman smells liars, and with no liar both are a promise to a four-year-old that never comes true. An ability that cannot fire is worse than none.                                                                                                                      |
| Is an alibi a falsehood?                          | No — the variant is gone.                                                                                                      | Keeping it, and pointing it at the culprit instead. As written it produced a _true_ sentence already in the deck, so it cost a falsehood, marked the curser for the Huntsman and the Godmother, and told the recipient nothing. Aiming it at the culprit is a balance change, not a port.                                 |
| Who counts toward the majority?                   | Every voice still in the room, not only those who spoke.                                                                       | Counting the voices actually raised, which is what the prototype's comment claimed while its code did the former. Kept the code: it is what two thousand simulated parties were checked under, and a hall of twenty should not banish somebody on four votes. If a real evening finds it too strict, the fix is a quorum. |

Two rules exist only because the invitation now arrives days before the party. The Huntsman
cannot spend their one sniff before the first round, or they burn it on a Tuesday when no
falsehood exists yet and the answer is permanently "smells nothing". And the host can drop a
no-show while it is still safe to renumber guests, because somebody who RSVPs and does not
come otherwise holds pieces the room needs and carries a vote nobody can cast.

**The closing paragraph above is superseded.** It says the prototype's clearest finding was
that "a dinner party does not want the account model at all", and that remains the sharpest
risk in this design — but the account model won, because one link in a group chat is what
this repo says _done_ looks like and a four-letter code read aloud does not survive roles
being dealt on Tuesday for Saturday's dinner. `dependents` is how much of the original
finding survived. Whether it survived enough is the open question, and it is the fifth thing
`tasks/dinner-party-first-real-party.md` asks you to watch for.
