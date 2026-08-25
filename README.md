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

## Winning

There are several ways to end a game, and they pull in different directions — the point is that
two tables playing the same map should be able to arrive somewhere different.

| Route            | How                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Conquest**     | Be the last power standing.                                                                                                                       |
| **Domination**   | Hold a decisive share of the surviving world.                                                                                                     |
| **Hegemony**     | Hold whole regions — every territory in them — covering much of the map, for two turns running. Rewards a compact, defensible empire over sprawl. |
| **Decapitation** | Hold your own founding capital and most of everyone else's, for two turns. Surgical rather than a land grab.                                      |
| **Condominium**  | Two players, one unbroken mutual concord, jointly dominant.                                                                                       |
| **Concordat**    | Three players bound pairwise by recent cooperation, none of whom has ever betrayed another.                                                       |
| **Turn cap**     | Nobody closed it out; standings decide, and there are no draws.                                                                                   |

Two rules keep the shared routes honest. **A solo win always beats a shared one**, so nobody ever
settles for splitting a victory they could have taken outright. And **a shared win must exclude
somebody** — if the winners are everyone still alive, that is a draw wearing a different name.

The two shared routes also compete. A condominium wants one unbroken partnership; a concordat wants
three pairs that have each cooperated recently. Since you may only pledge one player per turn,
closing a triangle means rotating pledges and forfeiting the streak a condominium needs. You have to
commit to one.

## Status

Early development. The engine and procedural map generator come first and are playable from a
terminal before any server or UI exists — the point is to tune game feel against simulation data
rather than intuition.

## The Dinner Party

A second game lives in the same app, for a room rather than a group chat: **Sleeping Beauty as
an assembly puzzle**, for up to twenty guests on their phones at a real party. Someone at the
christening laid the curse, every guest wears a public costume, and the clues constrain the
culprit's costume rather than naming anyone — so the hall solves it by talking, and only the
curser's phone can hand over something untrue.

It is built so a five-year-old is genuinely playing rather than being kept busy. Children hold
clues sealed behind a pretend-favour, so the grown-ups cannot finish their puzzle without
kneeling to a child first — two coupled games, one of which needs no reading at all.

Both shapes start from the same grid and share the ordinary `/g/:id` invite link. **Dinner
Party** is the hunt and needs three grown-ups or more; with two, the innocent one can never
carry a vote. **Bedtime Party** is co-operative — nobody present laid the curse, the culprit is
a courtier who went home, and a family of four can finish in about ten minutes. Either way the
host deals the roles whenever the guest list is settled, and each guest's page becomes their
private invitation: their character, their costume, their ability, and one guest's secret.

Design and decisions: [docs/design/dinner-party.md](docs/design/dinner-party.md).
Adding a tale: [docs/party-tales.md](docs/party-tales.md).

## Repository layout

```
packages/engine/   Pure rules: map generation, orders, pact contest, resolution, bots
packages/engine/src/party/   The dinner party: the tale, the evening, and its redactor
packages/server/   Fastify API over Firestore: lobbies, turn resolution, the deadline sweep
packages/web/      React client: the map, the orders panel, and the invitation
tools/simulate/    Balance harness — runs seeded bot games and reports fairness/social metrics
tools/mapviz/      Renders generated maps to SVG so the generator can be eyeballed
```

The engine is a pure function of `(state, orders, ctx)` with no clock, no I/O, and no ambient
randomness — a constraint enforced by ESLint, not convention. The party lives inside that same
package for exactly that reason: it inherits the purity rules by path, so its deal replays
bit-for-bit too. That purity is what makes replays
exact, makes crash recovery a matter of simply re-running the turn, and lets the browser run the
identical code to preview orders.

Both shapes reach players through the same grid, the same `/g/:id` link and the same deadline
sweep, but they are built from four different mechanisms — a preset, a contest, a party mode and
a game kind. [docs/game-modes.md](docs/game-modes.md) says what each mode is today, where it
branches, and what adding another actually costs.

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
