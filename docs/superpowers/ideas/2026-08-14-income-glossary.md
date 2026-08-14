# Income Breakdown Uses Undefined Terms — Idea

Date: 2026-08-14
Status: Captured — not yet brainstormed
Source: Player group text thread, 2026-08-13. Originally filed as GitHub issue #9
before this project moved to in-repo idea tracking.

## Raw dump

> **Sam:** Also what is war economy?
>
> Income 10: 3 base + 2 from 6 supplied lands + 1 war economy + 4 whole regions.
> I can't emphasize enough how little I understand this game

## What's being asked

- Define "war economy" for the player.
- Define "supplied", which appears in the UI only inside this one string.
- Define "whole regions" / the region bonus.

## Already verified

Confirmed in code while this was a GitHub issue. The string is built by `incomeParts`
(`packages/web/src/game/OrdersPanel.tsx:53-87`), mirroring `computeIncome`
(`packages/engine/src/income.ts:17-46`):

| Fragment                  | Source                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `3 base`                  | `BASE_INCOME = 3` (`constants.ts:54`)                                                             |
| `2 from 6 supplied lands` | `floor(suppliedCount / TERRITORIES_PER_INCOME)`, `TERRITORIES_PER_INCOME = 3` (`constants.ts:55`) |
| `1 war economy`           | `floor(state.turn / WAR_ECONOMY_INTERVAL)`, `WAR_ECONOMY_INTERVAL = 5` (`constants.ts:58`)        |
| `4 whole regions`         | `regionBonusFor(...)` — the summed **bonus**, not a count of regions (`income.ts:49-70`)          |

- **War economy** is a global ramp: everyone gains +1 income per 5 turns elapsed, to
  shorten the late game (`constants.ts:57-58`, `income.ts:27-28`).
- **Supplied** means connected to your capital through your own territory
  (`packages/engine/src/supply.ts:1-31`). This is arguably the most important economic
  rule in the game — cutting a player's map in half halves their income that turn — and
  it also gates deployment (`orders.ts:96-99`, `cannot deploy to territory N: out of supply`).

Two further problems found alongside:

- **`4 whole regions` is mislabeled.** It reads as a count of regions but is income from
  however many whole regions you hold; a single region can be worth up to 8
  (`generate.ts:471`). Should read `+4 from whole regions`.
- **The line only renders in deploy mode** (`OrdersPanel.tsx:161-165`), so a player in
  move mode never sees their income breakdown at all.

`packages/web/src/game/HowToWin.tsx` covers victory conditions and region bonuses
(line 76) but says nothing about supply, income composition, or the war economy.

## Open questions

- Glossary section in `HowToWin.tsx`, or hover/tap definitions on each term in the
  income line itself? The terms appear where the confusion happens, which argues for
  inline.
- Supply is a large enough mechanic that it may deserve its own explanation rather than
  a glossary entry — it gates both income and deployment, and nothing in the UI
  visualizes which of your territories are supplied.

## Constraints & non-goals

- Sam's framing — "I can't emphasize enough how little I understand this game" — suggests
  the fix should reduce reading, not add a wall of text.

## Suggested next step

`/one-shot` is plausible here: the mislabeled string and the deploy-mode-only rendering
are small, well-understood fixes. The supply explanation is the part that may want a
brainstorm first.
