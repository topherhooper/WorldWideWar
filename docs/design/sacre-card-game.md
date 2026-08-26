# S.A.C.R.E. Bleu! — a card game, prototyped

A rules sheet for a 2–7 player, 8-round card game arrived as a bare Google Docs link. It is
**not our design** — it belongs to a third party, and nobody has yet asked them whether building
it, publishing it or naming it is agreed. That is the first fact about this and it gates
everything below.

It is now a mode on the site (`kind: 'cards'`), live and co-present rather than async. The
prototype that preceded it answered one question — can these rules be a pure engine? — and the
answer was yes; everything below records what that cost and what it decided.
`pnpm sacre --seed s1` plays a complete 4-round-order, 8-round, 4-player game to a scored winner,
and the same seed plays the same game. What it does not answer is whether anyone enjoys playing it — see
"Still open".

## Decisions

| Decision                         | Chose                                                                                                         | Rejected, and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which axis in `game-modes`       | A third `kind` (`cards`)                                                                                      | Preset and contest, because S.A.C.R.E. shares no map, no armies, no orders pipeline and no contest. `docs/game-modes.md:218` — if it shares nothing at all it is a different site, and this shares only lobby, seats, invite link and deadline, which is exactly what the party shares.                                                                                                                                                                                             |
| Where the rules live             | Pure rules in `packages/engine/src/sacre/`, CLI in `tools/sacre/`                                             | A standalone throwaway script outside the workspace. The engine's ESLint purity rule is enforced by path, so putting the rules inside `packages/engine` buys the invariant check for free — which is the thing worth testing.                                                                                                                                                                                                                                                       |
| "Precludes winning"              | The cheap reading: a Score is illegal if it leaves you under 3 cards and does not leave you leading           | A solver over remaining winning lines. The document's own example is exactly the cheap case (trail by 10, cannot dump your last three low cards), the cheap version is four lines, and a solver would collide with "invalid input degrades, never throws".                                                                                                                                                                                                                          |
| Turn model                       | **Live and co-present, party-shaped** — everyone at the table at once, fast poll, phases advancing in minutes | Async simultaneous, the war game's model, because the rules are strictly sequential: "the shortest player goes first and turns rotate to the left". And async _sequential_, because at 4 players that is 32 blocking turns each waiting on one named person, Advertise and Cycle block on everyone else inside a single turn, and there is no sane auto-play — a war-game no-show submits nothing and the turn still resolves, but "did not pick an option" has no equivalent here. |
| A turn's shape                   | A phase machine: `choosing → awaiting → over`, with a pending naming who still owes an answer                 | Resolving a whole turn in one function, which is what the prototype did and what a real mode cannot do: Advertise and Cycle stop mid-turn and wait for other people.                                                                                                                                                                                                                                                                                                                |
| An unanswered Advertise or Cycle | **Fill it in on timeout** — cheapest eligible card, or worst cards                                            | Waiting indefinitely, which lets one person end everyone's evening; and cancelling the turn, which quietly punishes the seat that did nothing wrong. Filling in follows "invalid input degrades, never throws".                                                                                                                                                                                                                                                                     |
| Round 8's free Score             | The turn stays with the seat for one more action, and `skip` declines it                                      | Scoring it automatically. The bonus is offered whenever a run exists, but a run can still be refused — it may extend a set already laid, or end your game behind — so without a decline the seat could only watch the clock.                                                                                                                                                                                                                                                        |
| Extending a scored set           | Read narrowly: a run may not butt against one you already laid in that suit                                   | The wide reading — any second run in a suit you have scored — which would forbid the document's own advice to commit to a suit.                                                                                                                                                                                                                                                                                                                                                     |

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

## What the prototype missed, and how it was found

Kept because the pattern is more useful than the bugs. **None of these came from playing the
game.** The prototype ran eight rounds to a winner and looked correct; every one of them was found
either by auditing the code against the rules sheet afterwards, or by a test written against the
real server.

Found by reading the rules sheet against the code:

- **Seven players crashed.** Piles 1 and 2 hold six cards each (Q, K, A across two suits) and every
  player takes one from each, so a full table is one short. The rules cover it exactly — at seven
  players a Joker goes into each pile instead of both into pile 4 — and that was the rule the
  prototype had skipped. The rule whose entire purpose is to make seven players work.
- **"Extending an already scored set is not allowed"** had no implementation, because there was no
  table state at all. Now read narrowly, and the narrow reading is a decision above.
- **Advertise's proof-of-hand** was skipped. With bots in one process it changes nothing, which is
  exactly why it survived: it is the one genuine one-to-one disclosure on the site, and skipping it
  meant walking past the hardest part of the redactor without noticing.

Found by the emulator tests, once there was a server to test:

- **A finished turn never handed on.** The action layer carried out the option and stopped; nothing
  said the turn was spent. Invisible in the harness, which ended turns itself.
- **Round 8's free Score had been dropped entirely** — surfaced only while fixing the above.
- **A refused bonus Score stranded the seat**, with nothing to do but watch the clock. Hence
  `skip`.

The lesson worth keeping: a prototype that reaches its stated goal is evidence that the happy path
computes, and nothing else. The audit and the first real test are where the rules get checked.

## Still open

**Nobody has played it.** Not the engine question — that is settled — but the only one that
decides whether it belongs on the site. The bots are heuristics lifted from the document's own
advice section, and no human has taken a turn.

Two things a first real game would settle. Whether **two minutes a turn** is right: it is a guess,
and it is the dial the host can change. And whether **Return is too strong**: at four players the
deck is 14 cards and every one is a face card, an Ace or a Joker, so in rounds 1–7 almost every
Return is close to a free upgrade. The document's own advice says as much ("at least the first
player should choose Return in round 1"), which suggests it is intended — but intended and fun are
different claims.
