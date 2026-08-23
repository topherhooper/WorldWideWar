# What players could not figure out

Findings from the player group thread, 2026-08-12 → 2026-08-14, with the code
confirmed at the time. Append new findings; don't rewrite old ones.

The through-line is that **three of four players failed at the UI, not at the
concept**. Nobody said the game was too complex. They said they could not tell
what they were allowed to do.

## Movement — players could not submit a valid order

> **Jeff:** I don't think I understand movement can you check and see if my orders are
> rational or if there's like a key game function I'm missing
>
> **Jeff:** I am not entering until someone tells me how to move my units. I have no
> idea if I'm even entering valid orders. Or if my people are just chilling.
>
> **Paco:** the movement rules are hella confusing

Resolved over text, then with a screen recording:

> **Topher:** click "move", select how many armies you want to move, click your
> territory with requisite armies, choose one of the highlighted territories that you
> want to move to.
>
> **Jeff:** My error was not adjusting my army count.

Jeff's actual failure was the army count defaulting to 1 and staying there. That
is a UI defaulting problem wearing a documentation problem's clothes.

### The help text describes a game the client cannot play

- `packages/web/src/game/HowCombatWorks.tsx:17-19` teaches the support rules, but
  the web UI has no way to issue a SUPPORT order. `EntryMode` is `'move' | 'deploy'`
  only (`packages/web/src/game/OrdersPanel.tsx:21`) and `pages/Game.tsx:80-116` can
  only emit `{ kind: 'MOVE' }`. The engine implements support fully
  (`packages/engine/src/orders.ts:161-186`, `resolve.ts:503-521`).
- The same file promises "the odds shown when you commit an attack"
  (`HowCombatWorks.tsx:44`). `battleOdds` exists (`packages/engine/src/combat.ts:84`)
  but is called only by the bot (`bot/index.ts:568`), never surfaced in the UI.

So part of the documentation problem is that the existing documentation is wrong,
not merely incomplete.

### Unconfirmed

Paco: "I can't seem to order multiple territories to move into the same one."
That is legal in the engine and always was. The real constraint is one order per
*source* territory, and a second order from the same source is silently dropped
(`packages/engine/src/orders.ts:120-130`). Whether that is what Paco hit was never
established.

## Income — the breakdown uses terms defined nowhere

> **Sam:** Also what is war economy?
>
> Income 10: 3 base + 2 from 6 supplied lands + 1 war economy + 4 whole regions.
> I can't emphasize enough how little I understand this game

The string is built by `incomeParts` (`packages/web/src/game/OrdersPanel.tsx:53-87`),
mirroring `computeIncome` (`packages/engine/src/income.ts:17-46`):

| Fragment | Source |
|---|---|
| `3 base` | `BASE_INCOME = 3` (`constants.ts:54`) |
| `2 from 6 supplied lands` | `floor(suppliedCount / TERRITORIES_PER_INCOME)`, `TERRITORIES_PER_INCOME = 3` (`constants.ts:55`) |
| `1 war economy` | `floor(state.turn / WAR_ECONOMY_INTERVAL)`, `WAR_ECONOMY_INTERVAL = 5` (`constants.ts:58`) |
| `4 whole regions` | `regionBonusFor(...)` — the summed **bonus**, not a count (`income.ts:49-70`) |

- **War economy** is a global ramp: +1 income per 5 turns elapsed, to shorten the
  late game (`constants.ts:57-58`, `income.ts:27-28`).
- **Supplied** means connected to your capital through your own territory
  (`packages/engine/src/supply.ts:1-31`). This is arguably the most important
  economic rule in the game — cutting a player's map in half halves their income
  that turn — and it also gates deployment (`orders.ts:96-99`). Nothing in the UI
  visualizes which of your territories are supplied.

Two defects found alongside:

- **`4 whole regions` is mislabeled.** It reads as a count but is income from
  however many whole regions you hold; one region can be worth up to 8
  (`generate.ts:471`). Should read `+4 from whole regions`.
- **The line only renders in deploy mode** (`OrdersPanel.tsx:161-165`), so a player
  in move mode never sees their income breakdown at all.

`HowToWin.tsx` covers victory conditions and region bonuses (line 76) but says
nothing about supply, income composition, or the war economy.

## The tier-list round — no cue, and the results are hidden

> **Topher:** Sam did you forget your tier list last round?
>
> **Sam:** I didn't see the cue to rank other people last round 🙃
>
> **Paco:** Also how did you guys see the tier list results? I didn't see where to
> check how I did

- **No prompt exists.** `TiersPanel` renders alongside the orders panel whenever
  `view.contest === 'tiers'` (`packages/web/src/pages/Game.tsx:176-178`). No badge,
  no unfilled-list indicator, no blocking of "Lock in orders."
- **Validation fires only on lock-in.** `packages/server/src/games.ts:447-450` calls
  `tiersWarnings` only if `req.locked`, commented "warning about a half-typed list on
  every autosave is noise." A player who autosaves and lets the deadline expire never
  sees it — the sweep (`packages/server/src/tick.ts:40-41`) resolves anyway.
- **Submitting nothing is silent.** `applyTiersRecord` (`tiers.ts:201-213`) installs
  `null`; `resolveTiers` gives multiplier 100 with no author bonus (`tiers.ts:173-182`).
  The report shows `— wrote no list` (`ReportView.tsx:81`). No penalty, just forgone
  upside — deliberately, and nothing here should turn it into a hard failure.
- **Results are hidden by default, every turn.** They live in the tiers block of
  `ReportView` (`ReportView.tsx:71-98`), reachable only behind the collapsed "Show
  last turn's report" button (`Game.tsx:183-190`), and `showReport` is force-reset to
  `false` on every turn boundary (`Game.tsx:51`). That reset looks deliberate; nobody
  has confirmed it.

Email notifications shipped in #5 after this conversation. Whether the ranking round
triggers one was never checked, and it may already solve half of this for players who
read email between turns.
