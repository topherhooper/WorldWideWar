# Tier-List Round Has No Cue and Hidden Results — Idea

Date: 2026-08-14
Status: Captured — not yet brainstormed
Source: Player group text thread, 2026-08-12. Originally filed as GitHub issue #12
before this project moved to in-repo idea tracking.

## Raw dump

> **Topher:** Sam did you forget your tier list last round?

> **Sam:** I didn't see the cue to rank other people last round 🙃

> 😢

> **Paco:** Also how did you guys see the tier list results? I didn't see where to check
> how I did

> **Topher:** There's a button called show last turn's report

> **Topher:** I got 0/12 for Jeff's vegetables? Fuck me

> **Topher:** I implemented email notifications btw. You can adjust them with settings

## What's being asked

- Prompt players that a ranking round is open.
- Make the results findable.

## Already verified

Confirmed in code while this was a GitHub issue.

**No prompt exists.** `TiersPanel` is rendered alongside the orders panel whenever
`view.contest === 'tiers'` (`packages/web/src/pages/Game.tsx:176-178`). No badge, no
unfilled-list indicator, no blocking of "Lock in orders."

**Validation fires only on lock-in.** `packages/server/src/games.ts:447-450` calls
`tiersWarnings` only if `req.locked`, with the comment "warning about a half-typed list
on every autosave is noise." The text is at `packages/engine/src/contest/tiers.ts:222-225`.
A player who autosaves and lets the deadline expire without pressing Lock never sees it
— the deadline sweep (`packages/server/src/tick.ts:40-41`) resolves anyway.

**Submitting nothing is silent.** `applyTiersRecord` (`tiers.ts:201-213`) installs
`null`, making that player unguessable next turn. `resolveTiers` gives them multiplier
100 — no guess contribution, no author bonus (`tiers.ts:173-182`). The report shows
`— wrote no list` (`ReportView.tsx:81`). No penalty, just forgone upside.

**Results are hidden by default, every turn.** They live in the tiers block of
`ReportView` (`ReportView.tsx:71-98`), reachable only behind the collapsed "Show last
turn's report" button (`Game.tsx:183-190`), and `showReport` is force-reset to `false`
on every turn boundary (`Game.tsx:51`).

## Open questions

- Email notifications were added after this conversation. Does the ranking round already
  trigger one? If so, half of this may be solved for players who read email between
  turns — and unsolved for those who don't.
- Should an incomplete tier list block "Lock in orders", or just warn more loudly? The
  existing comment shows a deliberate choice not to nag on autosave; blocking is a
  stronger move than that decision implies.
- Should last turn's tier results surface on the main game view rather than behind the
  report? The contest is the reason people are playing.
- `showReport` resetting to `false` each turn looks deliberate. Is it?

## Constraints & non-goals

- Missing a list is already a soft failure by design — no penalty, just forgone upside.
  Nothing here should turn it into a hard one.

## Suggested next step

Brainstorm. Check the email-notification behavior first, since it may have changed the
problem since this was captured.
