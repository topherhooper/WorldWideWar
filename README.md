# World Wide War

An asynchronous, browser-based multiplayer strategy game. Risk-shaped territory conquest, built
to feel fast and a bit chaotic rather than the long grind the genre usually becomes.

Two ideas carry the design.

**Simultaneous secret orders.** Players submit orders whenever they are online, and the server
resolves everyone's orders together when the turn deadline fires — or early, the moment all live
players lock in. Nobody waits for anyone else's turn, which is what makes the game genuinely
async. The collisions this produces are the engine of chaos: armies swap provinces and bounce,
three players pile into one empty territory and shred each other, and a player who evacuates a
province a moment before it is attacked hands it over without a fight.

**Combat variance comes from a social contest, not dice.** Where a Risk-like rolls for combat
strength, this game runs a **Pact** — a blind, per-turn, mutual-pledge prisoner's dilemma whose
outcome becomes the multiplier on every battle you fight that turn. You pledge to one player,
secretly, at the same time you submit orders. Mutual pledges reward both sides; betraying a
partner who honored you pays best of all, and is named publicly in the turn report forever after.
A small dice term survives on top so upsets stay possible.

Because pact history is permanent and visible, a one-shot dilemma (where defection trivially
dominates) becomes an iterated one across a 25-turn game. A known serial backstabber finds nobody
will pledge to them, and spends the rest of the match at a multiplier penalty while everyone else
runs cooperative pairs. That punishment is emergent, not coded.

## Status

Early development. The engine and procedural map generator come first and are playable from a
terminal before any server or UI exists — the point is to tune game feel against simulation data
rather than intuition.

## Repository layout

```
packages/engine/   Pure rules: map generation, orders, pact contest, resolution, bots
tools/simulate/    Balance harness — runs seeded bot games and reports fairness/social metrics
tools/mapviz/      Renders generated maps to SVG so the generator can be eyeballed
```

The engine is a pure function of `(state, orders, ctx)` with no clock, no I/O, and no ambient
randomness — a constraint enforced by ESLint, not convention. That purity is what makes replays
exact, makes crash recovery a matter of simply re-running the turn, and lets the browser run the
identical code to preview orders.

## Requirements

- Node 22+
- pnpm 10+

## Getting started

```bash
pnpm install
pnpm typecheck
pnpm test
```

## Development commands

| Command          | What it does                                               |
| ---------------- | ---------------------------------------------------------- |
| `pnpm test`      | Run the full test suite                                    |
| `pnpm typecheck` | Type-check every package                                   |
| `pnpm lint`      | Lint, including the engine-purity rules                    |
| `pnpm format`    | Format with Prettier                                       |
| `pnpm sim`       | Play seeded bot games and print balance and social metrics |
| `pnpm mapviz`    | Render generated maps to SVG for inspection                |

## License

Not yet determined.
