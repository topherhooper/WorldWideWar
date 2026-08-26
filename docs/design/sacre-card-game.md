# S.A.C.R.E. Bleu! — a card game, prototyped

A rules sheet for a 2–7 player, 8-round card game arrived as a bare Google Docs link. It is
**not our design** — it belongs to a third party, and nobody has yet asked them whether building
it, publishing it or naming it is agreed. That is the first fact about this and it gates
everything below.

The prototype answers one question and one only: **can these rules be a pure engine?** They can.
`pnpm sacre --seed s1` plays a complete 4-round-order, 8-round, 4-player game to a scored winner,
and the same seed plays the same game. What it does not answer is the question that actually
decides whether this ships — see "Still open".

## Decisions

| Decision                   | Chose                                                                                               | Rejected, and why                                                                                                                                                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which axis in `game-modes` | A third `kind`, if it is ever built for real                                                        | Preset and contest, because S.A.C.R.E. shares no map, no armies, no orders pipeline and no contest. `docs/game-modes.md:218` — if it shares nothing at all it is a different site, and this shares only lobby, seats, invite link and deadline, which is exactly what the party shares. |
| Where the prototype lives  | Pure rules in `packages/engine/src/sacre/`, CLI in `tools/sacre/`                                   | A standalone throwaway script outside the workspace. The engine's ESLint purity rule is enforced by path, so putting the rules inside `packages/engine` buys the invariant check for free — which is the thing worth testing.                                                           |
| "Precludes winning"        | The cheap reading: a Score is illegal if it leaves you under 3 cards and does not leave you leading | A solver over remaining winning lines. The document's own example is exactly the cheap case (trail by 10, cannot dump your last three low cards), the cheap version is four lines, and a solver would collide with "invalid input degrades, never throws".                              |
| Async vs synchronous       | **Not decided.** Deliberately untouched by the prototype                                            | Deciding it on paper. Advertise and Cycle are blocking sub-turns and every other design question hangs off this one; it wants a brainstorm, not a guess.                                                                                                                                |

## What the running game taught

**Deck exhaustion cannot happen — the idea doc was wrong to flag it.** Return puts _q_ cards on
the bottom and draws _q_ from the top, and round 8's search is the same trade. The deck is
size-invariant. The only thing that ever removes cards from circulation is Score. This was
recorded as an unresolved hole before anything ran, and one game disproved it.

**The deck at 4 players is 14 cards and every one of them is a face card, an Ace or a Joker.**
Two red Q/K/A, two black Q/K/A, four Jacks, two Jokers. So the document's advice — "the deck has
better cards than your hand until it's been exhausted… at least the first player should choose
Return in round 1" — is arithmetic rather than flavour: in rounds 1–7 every Return is close to a
strict upgrade. Bots that Return on repeat do well, which is a balance question for whoever
builds this, not a bug in the rules.

**Both worked scoring examples in the document reproduce exactly**: 9,10,J,Q,K,A,2 of spades = 61
with the Ace looping, and Joker+K+A of clubs = 20 with the Joker at zero. They are the two tests
worth keeping.

**Purity cost nothing.** `pnpm lint` passed first time. Deriving a substream per `(round, seat)`
means every turn is independently reproducible, so a replay does not depend on replaying the
turns before it.

## Still open

The prototype says the rules are expressible. It says **nothing** about whether the game can be
played asynchronously by five people who open a site twice a day, because it never modelled a
turn boundary — a bot simply answers an Advertise the moment it is asked. That is the load-bearing
question, and a green prototype must not be read as evidence about it.

Nor does it say the game is any good: the bots are crude heuristics lifted from the document's own
advice section, and nobody has played it.

Before any of that matters, someone has to ask the author.
