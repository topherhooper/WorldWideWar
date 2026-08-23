---
status: open
kind: task
area: web
priority: 0
blocked-by: ''
---

# Let a new player submit a sane order without being told how

## Next step

Fix the two things that actually stopped people, both in `packages/web/src/game/OrdersPanel.tsx`, before writing any new help text:

1. **The army count defaults to 1 and stays there.** That was Jeff's entire failure -- he thought his orders were invalid when they were just for one army. Default it to the full garrison, or make the current value impossible to miss.
2. **The income line renders only in deploy mode** (`OrdersPanel.tsx:161-165`), and says `4 whole regions` when it means `+4 from whole regions` (`incomeParts`, `:53-87`). Render it in both modes and fix the label.

Then play one turn as a new player and see whether it still needs prose.

## What we know

Three of four players failed at the UI, not at the concept, and Topher's own fix was a screen recording -- so the click sequence is the problem, not the rules.

Two pieces of the existing help text describe a game the client cannot play: `HowCombatWorks.tsx:17-19` teaches SUPPORT orders the web UI cannot issue, and `:44` promises attack odds that are computed but never surfaced. Writing more docs on top of wrong docs makes it worse.

Full evidence, quotes and file references: [docs/onboarding-gaps.md](../docs/onboarding-gaps.md).
