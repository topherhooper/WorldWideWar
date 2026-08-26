# S.A.C.R.E. Bleu! — a card game, prototyped

A rules sheet for a 2–7 player, 8-round card game arrived as a bare Google Docs link. It is
**not our design** — it belongs to a third party, and nobody has yet asked them whether building
it, publishing it or naming it is agreed. That is the first fact about this and it gates
everything below.

The prototype answers one question and one only: **can these rules be a pure engine?** Mostly — see
"What the prototype does not implement" for the two rules it leaves out and why.
`pnpm sacre --seed s1` plays a complete 4-round-order, 8-round, 4-player game to a scored winner,
and the same seed plays the same game. What it does not answer is whether anyone enjoys playing it — see
"Still open".

## Decisions

| Decision                   | Chose                                                                                                         | Rejected, and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which axis in `game-modes` | A third `kind`, if it is ever built for real                                                                  | Preset and contest, because S.A.C.R.E. shares no map, no armies, no orders pipeline and no contest. `docs/game-modes.md:218` — if it shares nothing at all it is a different site, and this shares only lobby, seats, invite link and deadline, which is exactly what the party shares.                                                                                                                                                                                             |
| Where the prototype lives  | Pure rules in `packages/engine/src/sacre/`, CLI in `tools/sacre/`                                             | A standalone throwaway script outside the workspace. The engine's ESLint purity rule is enforced by path, so putting the rules inside `packages/engine` buys the invariant check for free — which is the thing worth testing.                                                                                                                                                                                                                                                       |
| "Precludes winning"        | The cheap reading: a Score is illegal if it leaves you under 3 cards and does not leave you leading           | A solver over remaining winning lines. The document's own example is exactly the cheap case (trail by 10, cannot dump your last three low cards), the cheap version is four lines, and a solver would collide with "invalid input degrades, never throws".                                                                                                                                                                                                                          |
| Turn model                 | **Live and co-present, party-shaped** — everyone at the table at once, fast poll, phases advancing in minutes | Async simultaneous, the war game's model, because the rules are strictly sequential: "the shortest player goes first and turns rotate to the left". And async _sequential_, because at 4 players that is 32 blocking turns each waiting on one named person, Advertise and Cycle block on everyone else inside a single turn, and there is no sane auto-play — a war-game no-show submits nothing and the turn still resolves, but "did not pick an option" has no equivalent here. |

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

## What the prototype does not implement

Found by auditing the code against the rules sheet rather than trusting the run. Recorded rather
than fixed, because guessing an answer into prototype code is worse than leaving the question
where whoever builds this will read it.

- **"Extending an already scored set is not allowed."** There is no table state at all — scored
  cards simply leave the hand — so nothing stops a player scoring 5-6-7♣ and later 8-9-10♣. Left
  open on purpose: the rule is genuinely ambiguous about whether that second run _is_ an
  extension, and it needs settling with the author, not by a coin flip in code.
- **Advertise's "reveal their hand privately to you as proof."** Players with no eligible card are
  silently skipped. With bots in one process that changes nothing, which is exactly why it is
  worth flagging: it is the one step that has no shape in `redact()`, so the prototype skipped
  past the hardest part of the eventual mode without noticing.

Two more that are bot policy rather than missing rules, so nobody reads them as coverage: in
round 8 the bot always takes Return-then-bonus-Score, so the Advertise- and Exchange-plus-bonus
paths never execute; and `lastCycleSeat` is never cleared, so the no-Cycle-twice-in-a-row check
can fire on a stale seat.

**One thing that was broken and is now fixed.** Seven players crashed. The rules put a Joker into
each of piles 1 and 2 at a full table precisely because those piles hold six cards (Q, K, A across
two suits) and seven players need one from each; the prototype had left both Jokers in pile 4. The
rule whose entire purpose is to make 7 players work was the rule that had been skipped.

**What is confirmed working**, so nobody re-derives it: all five options occur across five seeds
(Return 78, Exchange 26, Advertise 19, Score 19, Cycle 15); every player count from 2 to 7 plays
to a winner; the same seed replays the same game; and both worked scoring examples from the
document match.

## Still open

**Not the turn model — that is settled above.** The question the prototype was said to leave open
was "can this be made async", and the answer is essentially no; the useful question is whether it
is worth building as a live, co-present mode. Three details in the rules sheet all point the same
way, and none of them is about implementation: round 8 flips every hand _and the deck_ face-up for
the whole table to see, the round counter is a physical card box the first player rotates 45° per
round, and turn order is decided by who is shortest. It is a game for people in a room.

That makes the party the precedent to copy rather than the war game — `kind`-shaped, a 2.5 s poll,
and the advance-on-read trick that exists because a once-a-minute sweep cannot drive a phase that
lasts ninety seconds (`docs/game-modes.md:125-128`). It also means the cost is the party's cost,
not the war game's.

What genuinely remains: **nobody has played it.** The bots are crude heuristics lifted from the
document's own advice section, and a prototype that proves the rules compute proves nothing about
whether four people enjoy an evening of it. The cheapest next thing that would tell us is a real
game with real cards — the rules need a deck and nothing else.

And one balance flag from the run, for whoever builds it: with the deck at 4 players being 14
cards and all of them face cards, Aces or Jokers, Return is close to a free upgrade in rounds 1-7.
