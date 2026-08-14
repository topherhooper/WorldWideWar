# Movement and Combat Are Undocumented — Idea

Date: 2026-08-14
Status: Captured — not yet brainstormed
Source: Player group text thread, 2026-08-12 → 2026-08-13. Originally filed as GitHub
issue #7 before this project moved to in-repo idea tracking.

## Raw dump

> **Paco:** What are the movement rules ... There's a mention of support orders but I
> can't seem to order multiple territories to move into the same one. Also, it seems
> certain territories aren't allowed to move to others that they border?

> **Jeff:** I don't think I understand movement can you check and see if my orders are
> rational or if there's like a key game function I'm missing

> **Jeff:** Give me a walkthrough write up of how movement and combat works I am clearly
> not following

> **Topher:** I can't do that for you. Ai made this game

> **Paco:** But that said the movement rules are hella confusing

> **Jeff:** I am not entering until someone tells me how to move my units
> I have no idea if I'm even entering valid orders
> Or if my people are just chilling
> I'm not asking for much

> **Topher:** So you really aren't going to play until you completely understand the
> game? Cause that's not really going to work.

> **Topher:** click "move", select how many armies you want to move, click your
> territory with requisite armies, choose one of the highlighted territories that you
> want to move to.

> **Jeff:** I submitted

> **Topher:** I made you a video [screen recording, 2026-08-13]

> **Jeff:** I will keep playing. My error was not adjusting my army count

> **Topher:** We don't have to keep play if y'all don't want to. I just thought a silly
> ai war categories game would be fun

## What's being asked

- Write down how movement works, somewhere a player will find it in the game.
- Write down how combat resolves when two players move into the same territory.
- The click sequence itself needs to be discoverable without being told over text.

## Open questions

- Does this belong in `HowToWin.tsx` alongside victory conditions, in a separate
  panel, or inline at order-entry time where the confusion actually happens?
- Is a written walkthrough enough, or does the order-entry UI need to change so the
  rules are legible without a document? Three of four players failed at the UI, not at
  the concept.
- Jeff's actual error was the army count defaulting to 1 and staying there. Is that a
  docs problem or a UI defaulting problem?

## Constraints & non-goals

- Topher's position: players shouldn't need to completely understand the game before
  playing. So the goal is enough to submit a sane order, not a rules lawyer's manual.
- The game is meant to feel "silly" and fast. A dense manual works against that.

## Already verified

Two related findings, confirmed in code while this was still a GitHub issue:

- `packages/web/src/game/HowCombatWorks.tsx:17-19` already teaches the support rules to
  players — but the web UI has no way to issue a SUPPORT order. `EntryMode` is
  `'move' | 'deploy'` only (`packages/web/src/game/OrdersPanel.tsx:21`), and
  `pages/Game.tsx:80-116` can only emit `{ kind: 'MOVE' }`. The engine implements
  support fully (`packages/engine/src/orders.ts:161-186`, `resolve.ts:503-521`).
- The same file promises "the odds shown when you commit an attack"
  (`HowCombatWorks.tsx:44`). `battleOdds` exists at `packages/engine/src/combat.ts:84`
  but is called only by the bot (`packages/engine/src/bot/index.ts:568`), never surfaced
  in the UI.

So part of the documentation problem is that the existing documentation describes a
game the client cannot play.

## Unverified claims

- Paco: "I can't seem to order multiple territories to move into the same one." This is
  legal in the engine and always was — the real constraint is one order per _source_
  territory, and a second order from the same source is silently dropped
  (`packages/engine/src/orders.ts:120-130`). Whether that is what Paco hit is unconfirmed.

## Suggested next step

Brainstorm. Worth deciding first whether this is one piece of work or two — a docs pass
and a separate UI pass — because the support-order gap makes the current help text
wrong, not just incomplete.
