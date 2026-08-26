# S.A.C.R.E. Bleu! — a card game someone else designed, offered to the site

## Why now

A single link arrived, with no words attached:

> https://docs.google.com/document/d/1oD0-NXmB7erBbs43IhiIeWrUtVpWW7MZ9pwskeJrZFA/edit

That is the whole prompt. Everything below this section is me reading the document and the
codebase; none of it is something that was said out loud.

The document is **"S.A.C.R.E. (Score, Advertise, Cycle, Return, or Exchange)"** — a complete
rules sheet for a 2–7 player card game played with a standard deck. Owned by
`jeffrey.hunt90@gmail.com`, created 2022-12-08, last modified 2024-09-22, shared with us
2026-08-14. It has a public short link printed at the bottom: `tinyurl.com/sacrecardgame`.

**It is not our design.** That is the first fact about this idea and it does not go away.

## What would make it real

> Four people in a group chat each play one full 8-round game of S.A.C.R.E. to a scored winner
> in the browser, hands staying secret, without anyone asking how a turn works.

Phrased that way on purpose. It is the one sentence at the top of `CLAUDE.md` with the war game
swapped out, and it carries the same sting: three of four players could not enter a valid order
in the game we already have without being walked through it over text
([docs/onboarding-gaps.md](../docs/onboarding-gaps.md)). S.A.C.R.E. has **five** options per
turn, three of which require reacting to another player. A correct implementation nobody can
play is not a game, and this one has more surface to be unplayable across than anything on the
site today.

## What we found

### What the document actually says

Recorded here rather than linked, because the Google Doc is not ours, can change or be
un-shared under us, and a bare clone in a sandbox has to get the complete picture
(`CLAUDE.md` § "Git is the harness").

**Setup.** Split a standard deck into four piles: red Q/K/A (1), black Q/K/A (2), numbers 2–10
(3), Jacks (4). Under 7 players both Jokers go in pile 4; at 7 players one Joker goes into each
of piles 1 and 2. Shuffle 1, 2 and 3, then deal face-down:

| Players | From pile 1 | From pile 2 | From pile 3 | Total |
| ------- | ----------- | ----------- | ----------- | ----- |
| 2       | 1           | 1           | 13          | 15    |
| 3       | 1           | 1           | 10          | 12    |
| 4       | 1           | 1           | 8           | 10    |
| 5       | 1           | 1           | 7           | 9     |
| 6       | 1           | 1           | 6           | 8     |
| 7       | 1           | 1           | 5           | 7     |

Everything left over from all four piles is shuffled together to form the deck. So the deck is
deliberately **face-card-rich** at the start, and the rules' own advice leans on that: "at least
the first player should choose Return in round 1."

**The shape of a game.** Eight rounds. Each round, every player takes one turn choosing exactly
one of Score, Advertise, Cycle, Return or Exchange. Turn order rotates left; the shortest player
goes first. **A player holding fewer than 3 cards flips their hand face-up and skips all
remaining turns.** Highest score wins; ties go to whoever is latest in turn order; there is no
second place, and the losers say "Sacré bleu!"

**Score.** Lay down one same-suit run of at least 3 cards. Numbers score face value, all of
J/Q/K/A score 10 each, and the order is J, Q, K, A with the Ace looping round to 2 — so
9,10,J,Q,K,A,2 of spades is 61. Jokers substitute for any card but score 0. One run per turn, and
you may not extend a run already scored. And: _scoring a sequence that precludes winning is not
allowed._

**Advertise.** Put a non-Joker card face-up in front of you. Every other player must put a
non-Joker card face-down of equal or greater _potential scoring value_ — offer an 8 and they owe
you an 8-through-Ace; offer a Queen and they owe a 10-through-Ace, since all face cards score 10.
Anyone who cannot reveals their hand to you privately as proof. You peek at every face-down card,
pick one partner, and swap. The rest go back.

**Cycle.** Force everyone with enough cards, yourself included, to simultaneously pass a fixed
quantity a fixed number of seats to their left — "Cycle 3 cards to the player four spots to your
left." Maximum quantity is half the deal size rounded up. You may not require the cards be picked
at random. Players holding fewer cards than the quantity sit the whole thing out, and the pass
skips past them. Cycle is unavailable in round 8, and unavailable if the previous player holding
more than 2 cards chose Cycle.

**Return.** Put any number of cards on the bottom of the deck in any order, then draw the same
number off the top, unseen.

**Exchange.** Hand a player one card face-down. If that leaves them holding 8 or more, they set
3 aside face-down first. Look at the rest of their hand, take one card, and reveal it. You may
not take a card another player revealed via Exchange since your own last turn. Their set-aside
cards come back.

**Round 8.** Cycle is off. Every hand and the deck are face-up from the start of the round.
Return becomes _search the deck and take whatever you like_. And choosing Advertise, Return or
Exchange earns a free bonus Score immediately afterwards — so the last round is where a well-fed
hand cashes out twice.

**The advice section** is worth keeping because it states the intended arc: gather high cards in
the first third, commit to a suit in the middle third, maximise one big run in the last third.
Winners typically score two runs. Don't Score in your first two turns — named in the doc as the
common new-player mistake.

### Where the cost lands in this repo

Not a plan. Just the pointers, so whoever picks this up next does not rediscover them.

**The axis is the expensive one.** [docs/game-modes.md:19](../docs/game-modes.md) puts **Kind**
at the bottom of the preference order and prices it at "a second half of the server and client",
and `docs/game-modes.md:218` sets the test that decides this: _"If the new thing shares the map
or the orders pipeline, it is a contest or a preset wearing the wrong costume. If it shares
nothing at all, it is a different site."_

S.A.C.R.E. shares no map, no armies, no orders pipeline and no contest. It shares a lobby, seats,
an invite link and a deadline — which is exactly and only what the party shares, and the party
was justified on precisely that basis. So it is a **third kind**, or it is a different site.
Nothing cheaper is honest.

**The party is the cost estimate.** `packages/engine/src/party/` is 3,123 lines including tests —
`types.ts` (232), `actions.ts` (345 + 494 test), `tale.ts` (352 + 189), `redact.ts` (299 + 255),
`clock.ts` (159 + 130), `state.ts` (153), `rules.ts` (122) — and that bought a game with eight
actions and no cards. Read `git log` around it rather than trusting any list.

**The nine-step spine** every mode walks (`docs/game-modes.md:105-115`):
`packages/web/src/pages/Home.tsx` (the card), `packages/server/src/app.ts` (`POST /api/games`
dispatch on kind), `packages/server/src/store.ts` (the `GameDoc` union),
`packages/web/src/pages/Game.tsx` (`GameInner` forks on `view.kind`),
`packages/server/src/tick.ts` (the deadline), `packages/web/src/useGame.ts` (`pollIntervalFor`).

**Two invariants bite harder here than anywhere else on the site:**

- `packages/engine/src/rng.ts` — the engine is pure and ESLint enforces it, so every shuffle,
  every deal and every unseen draw in Return goes through `substream(seed, ...)`. That is not a
  burden; it is what makes a card game replayable and crash recovery a re-run.
- `packages/engine/src/redact.ts` — a hand is the most secret state the site would have ever
  held, and **round 8 turns every hand and the deck face-up**. That is a redaction _mode_, not a
  UI toggle: `redact()` is the only path state takes to a client, and it would need to know what
  round it is.

### Rule holes found by reading closely

Findings, not tasks. These are what a brainstorm would have to settle, and several of them are
more interesting than the implementation.

- **"Scoring a sequence that precludes winning is not allowed"** is the hardest rule in the
  document. Enforcing it means deciding whether any winning line still exists for you — a solver,
  not a validation. And it collides head-on with `CLAUDE.md`'s "invalid input degrades, never
  throws": the engine cannot both silently normalise a bad Score and refuse one on the grounds
  that it forecloses victory. At a table this is settled by a human going "you can't do that."
- **Exchange's memory.** "You cannot choose a card that was revealed by a different player via
  Exchange since your prior turn" requires per-card provenance with a lifetime measured in _your_
  turns, not rounds. That is real hidden state that has to survive redaction and a page refresh.
- **Advertise's private proof.** A player reveals their hand _to one other player_ as proof they
  hold nothing eligible. `redact()` today produces one view per viewer from shared state; a
  one-to-one disclosure that exists for a single sub-step has no shape in it yet.
- **Deck exhaustion is never addressed.** Return in rounds 1–7 draws from the top of a deck that
  can run out; round 8's Return searches a deck that may be empty. At a table you notice and
  shrug.
- **Scoring your last three cards ends your game** — under 3 cards means face-up and skipped for
  the rest of the match. Combined with the preclude-winning rule, the endgame has a shape the
  document never spells out: your final Score is also your resignation.
- **A typo worth not propagating:** Return says "draw ... from the top of _your_ deck". The deck
  is shared; there is one.

Two things checked that do hold, so nobody re-checks them:

- Cycle's cap is consistent — 5 players are dealt 9 cards, half rounded up is 5, which matches
  the document's own example.
- Advertise's "equal or greater potential scoring value" is coherent given face cards all score
  10: offering a Queen really does mean a 10 is an acceptable answer.

## Assumed, not asked

Cheap to correct here, expensive to correct after code exists.

1. **That this belongs in this codebase** — that the link means "build this", not "here is a
   scoring mechanic worth stealing for the war game" and not "read this, unrelated".
2. **That async-first is the constraint it must bend to.** This site resolves on a deadline for
   people who open it twice a day. S.A.C.R.E. has _blocking sub-turns_: Advertise stops until
   every other player has answered, Cycle needs a simultaneous face-down pass from everyone at
   once. The nearest thing the repo already has is the party's advance-on-read
   (`docs/game-modes.md:125-128`), which exists for sub-minute phases and writes during a GET.
   This is the load-bearing assumption and the one most likely to be wrong.
3. **That we do not have permission.** The design is `jeffrey.hunt90@gmail.com`'s. Nobody has
   said whether implementing it, publishing it, or naming it is agreed. Unresolved, and it is
   cheap to resolve by asking a person.
4. **That the physical-only rules need substitutes, undecided.** The shortest player goes first;
   the card box is rotated 45° each round as a round counter; the losers exclaim "Sacré bleu!"
   None of the three survives the trip to a browser as written, and the third one is the game's
   whole personality.
