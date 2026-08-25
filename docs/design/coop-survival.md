# Cooperative Survival — Design

Date: 2026-08-23
Status: Engine built and measured; not yet reachable by players

## Summary

A cooperative preset in which there are no rivals, only the world. The tiers contest
becomes the coalition's economy: every read scored in a turn -- including reads made by
players who have already lost their last province -- sums into one pool that is split
among whoever still has ground to deploy on. The storm stops being a symmetric clock and
becomes the opponent, driving raiders onto the permanent core each wave. The game cannot
be won early; it can only be survived, and the score is how many players are left
standing.

It is built on `contest: 'tiers'` rather than the pact, because the pact is a loyalty
game and there is nobody to betray.

## Decisions

| Decision                             | Chosen                                            | Why                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| What the enemy is                    | The storm, driving raiders inward                 | Bots already exist and would have been cheaper, but an enemy empire reads as team-vs-team with the storm as scenery, not as PvE.        |
| Where raiders land                   | The permanent core (`wave === -1`)                | Measured. The collapse frontier did nothing at all -- see the negative result below.                                                    |
| What a read pays                     | A shared pool, split among the living             | Rides on `bonusIncome[]`, which already flows to `pendingBonusIncome` at `resolve.ts:426`. No new state field, no schema migration.     |
| What an eliminated player does       | Keeps writing lists and reading allies            | The async failure mode is a player knocked out on turn 3 of a once-a-day game with nothing to open the site for. Their reads still pay. |
| Whether the coalition can win early  | No                                                | An early win would make the storm optional. You do not beat the world; you outlast it.                                                  |
| How a shared win avoids being a draw | Survivor count is the score, standings still rank | Five survivors and two are different endings, and the report still says who carried it.                                                 |
| Turn cap                             | 8, inside a new 5-10 target for every preset      | A 25-turn match at one turn a day is a month of real time; the table loses the thread long before the storm does.                       |

## The exclusion rule

`victory.ts` opens with a rule that has governed every shared victory so far: **a shared
win must exclude somebody**, because otherwise it is a draw wearing a different name, and
the design promises none. Cooperative survival suspends it. That is worth stating plainly
rather than burying, because it is the one design rule this mode breaks.

It is suspended because the reasoning behind it does not reach this case, not because
co-op is an exception to it. The rule exists so nobody settles for splitting a victory
they could have taken outright -- which presumes a rival to take it from. Here the
excluded party is the world. What the rule actually protects against is a draw, and that
is handled instead by making the survivor _count_ the score.

## Negative result: raiders on the collapse frontier

The first implementation put raiders on surviving territory bordering the ground that had
just burned. It reads well -- the dispossessed press against the people who still have
land -- and it does nothing measurable.

The reason is the schedule. At short caps `stormInterval` is 1, so the ring bordering
this wave's collapse is the ring that burns next turn. Every raider was spent on land
that was already doomed, and the pressure never reached the core where the endgame is
fought. Over 300 games at each of 4, 5 and 6 players, 0 raiders and 6 raiders differed by
0.05 mean survivors.

Aimed at the permanent core instead, at five players:

| `stormRaiders` | mean survivors | extinction |
| -------------- | -------------- | ---------- |
| 0              | 3.90 / 5       | 0%         |
| 2              | 3.95 / 5       | 0%         |
| 4              | 3.73 / 5       | 1%         |
| 6              | 3.43 / 5       | 5%         |

The preset ships 4. Two is still indistinguishable from none, which is worth remembering
if the number is ever tuned by intuition again.

**These are bot games.** Bots order tier lists by canned popularity and coordinate
nothing, so the pool they generate is close to a floor. Humans reading each other should
beat these numbers, and the difficulty may need raising once real tables play it.

## Short games, and what they cost

Every preset now targets 5-10 turns and `MIN_TURN_CAP` drops from 10 to 5. Two
consequences, one fixed and one open.

**Fixed: the storm no longer runs past the end.** `stormFirstWave` was a fraction of the
cap, floored at 4. At a cap of 8 that started the storm on turn 4 with six waves at
interval 1, so the last two never fired and the map ended half-burnt -- which would make
"outlast the storm" unwinnable by construction. The start is now pulled earlier so the
final wave lands inside the game. It is inert at the old caps: 25 still starts on 10, 15
still on 6.

**Open: short games gut the competitive victory routes.** The bars in `constants.ts` were
measured at 25 turns. At a 10-turn cap, 6-player pact games end on the turn cap 77% of the
time (231 of 300) instead of in a victory, against 21% at 25 turns. Every gate still
passes and seat fairness is unaffected, so nothing is broken -- but "play ten turns and
count territory" is a different game from the one those routes were tuned for. Survival is
unaffected, because it has no early win to reach.

Retuning the competitive bars for a short clock is not filed as a task yet. It becomes one
when somebody actually wants a short pact game to end in a win rather than on points.
