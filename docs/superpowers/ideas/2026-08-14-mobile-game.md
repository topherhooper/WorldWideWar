# Make This a Mobile Game — Idea

Date: 2026-08-14
Status: Captured — not yet brainstormed
Source: Own notes — asked directly of Claude in a working session, 2026-08-14.

## Raw dump

> what would it take to make this a mobile game?

## What's being asked

- Scope the work required to make World Wide War a mobile game.

That is the whole dump. It is one question with no scope attached, so most of the
substance below is the ambiguity it leaves open rather than anything it states.

## Open questions

**What "mobile game" means here.** The dump does not say, and the options are not
variations on one another — they differ in cost, distribution, and what has to be
rebuilt:

- A responsive/touch-friendly version of the existing browser client, still reached by
  URL.
- An installable PWA — home-screen icon, offline shell, web push.
- A native shell around the existing web client (Capacitor/Cordova-style), submitted to
  the App Store and Play Store.
- A genuinely native or React Native client sharing only the engine package.
- Something else entirely — a mobile-first redesign of the game itself, not just the
  client.

**Whether this is a port or a second front end.** The engine is documented as pure and
already shared between server and browser; whether that sharing extends to a mobile
target is unexamined.

**What the mobile screen has to show.** The game is a map game with per-turn secret
orders, a pact/pledge step, and a turn report. Which of those survive a phone-sized
viewport unchanged, and which need a different interaction model, is unaddressed.

**Notifications.** The game is asynchronous with turn deadlines. Existing notification
behavior (the tier-list idea doc mentions email notifications having been implemented)
versus push on mobile is not discussed here.

**Distribution and accounts.** App store review, store accounts, signing, release
process, and whether the current auth flow works inside a native shell — none of it is
mentioned.

**Who this is for.** Whether the motivation is existing players who want to play on a
phone, or reach/discoverability from being in an app store, is not stated, and the two
point at different answers.

**Timeline, budget, and appetite.** The dump gives none.

## Constraints & non-goals

None stated in the dump. Repo-level constraints that any answer would have to live with
are in `CLAUDE.md` and `README.md` — notably that the engine is pure and ESLint-enforced
— but the dump itself rules nothing in or out.

## Unverified claims

The dump makes no factual claims to check.

For orientation only, and not as an evaluation: the repo currently has
`packages/engine`, `packages/server` and `packages/web`. `README.md` still describes a
layout of `packages/engine/`, `tools/simulate/` and `tools/mapviz/`, so the README's
repository-layout section is behind the tree. Nothing here has been checked for its
bearing on mobile.

## Suggested next step

Brainstorm — starting by pinning down which of the "mobile game" readings above is
actually being asked about, since the rest of the work depends entirely on that.
