# What would it take to make this a mobile game?

## Why now

Asked directly in a working session on 2026-08-14, with no scope attached, and
left on this branch when #22 retired the `docs/superpowers/ideas/` directory it
was captured into. It is still a live question: the game is asynchronous with
turn deadlines, which is the shape that most wants a phone.

## What would make it real

**Blocked on one question, and it is the only one worth asking:** which of these
is meant, because they are not variations on each other.

1. The existing browser client, made touch-usable at phone width. Reached by URL.
2. An installable PWA — home-screen icon, offline shell, web push.
3. A native shell around the existing web client (Capacitor-style), in both stores.
4. A native or React Native client sharing only `packages/engine`.
5. A mobile-first redesign of the *game*, not the client.

Anything from 1 to 5 is a different project. Until one is picked there is no
observable outcome to write here, and therefore nothing to prototype.

## What we found

The engine is pure and already shared between server and browser
(`CLAUDE.md` § Invariants), so 4 is cheaper here than it usually is —
sharing the engine with a native client is a build-target question rather
than a rewrite.

The screens that would have to survive a phone viewport are the map, the
per-turn secret orders, the pact/pledge step and the turn report. The map is
the one with no obvious small-screen form.

Two open tasks already push in this direction and would be prerequisites for
any of 1–3: `tasks/submit-orders-unaided.md` and
`tasks/tier-list-round-cue.md`.

## Assumed, not asked

- **This is for existing players who want to play on a phone**, not for app-store
  reach. Reach would change the answer toward 3 or 4 and add store accounts,
  signing and review to the cost; if that is wrong, say so and this doc changes.
- **No timeline or budget**, so cost is the deciding factor between the five.

<!-- Migrated 2026-08-23 from docs/superpowers/ideas/2026-08-14-mobile-game.md,
     which was 74 lines and about 60 of them an inventory of questions nobody
     had asked. The five interpretations were the part worth keeping. -->
