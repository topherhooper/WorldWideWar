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

Playable in a browser. `pnpm dev` serves a game you can create, share a code for, and play
through to a result — against bots, against other people, or both at once. Games live in memory,
so a restart clears the table; everything needed to change that is already in one file.

## Repository layout

```
packages/engine/   Pure rules: map generation, orders, pact contest, resolution, bots
packages/server/   Game lifecycle, deadlines, per-player redaction, JSON API and event stream
packages/web/      The browser client: interactive map, order sheet, turn report
tools/simulate/    Balance harness — runs seeded bot games and reports fairness/social metrics
tools/mapviz/      Renders generated maps to SVG so the generator can be eyeballed
```

The engine is a pure function of `(state, orders, ctx)` with no clock, no I/O, and no ambient
randomness — a constraint enforced by ESLint, not convention. That purity is what makes replays
exact, makes crash recovery a matter of simply re-running the turn, and lets the browser run the
identical code to preview orders.

The server owns exactly the two things the engine refuses to know about: **who may submit what**,
and **when the turn is due**. A turn resolves the moment every live human has locked in, or when
the deadline fires — whichever comes first. A player who misses their deadline does not pass:
their half-built draft is completed by the same bot brain that plays the empty seats, because a
passive seat in a free-for-all is free food and warps the game around whoever borders it.

Every read of game state leaves the server through one function, `redact`, so there is a single
place to audit what a player is entitled to see. Orders and pledges are never redacted for the
stronger reason that they are never sent: the resolver reads them straight from storage and no
read path from the outside world can reach them.

The client is compiled by `tsc` and served as plain ES modules — no bundler anywhere in the
project. It may import _types_ from the engine and server, never values; that too is an ESLint
rule rather than a convention, since a stray value import is a bare specifier the browser cannot
resolve.

## Requirements

- Node 22+
- pnpm 10+

## Getting started

```bash
pnpm install
pnpm dev
```

Then open <http://localhost:8787>, name yourself and create a table. Leave **human seats** at 1 and
you are playing bots straight away; raise it and you get a table code to share — everyone who opens
the link takes a seat, and the game starts once they are all in. Set `PORT` to serve elsewhere.

A turn is three decisions: place your reinforcements, order each province (hold, march, or support a
neighbour's fight), and pledge to one rival. Lock in, and the turn resolves as soon as everyone else
has — or when the clock runs out, whichever comes first.

## Development commands

| Command          | What it does                                               |
| ---------------- | ---------------------------------------------------------- |
| `pnpm dev`       | Build everything and serve the game on port 8787           |
| `pnpm test`      | Run the full test suite                                    |
| `pnpm typecheck` | Type-check every package                                   |
| `pnpm lint`      | Lint, including the engine- and browser-purity rules       |
| `pnpm format`    | Format with Prettier                                       |
| `pnpm sim`       | Play seeded bot games and print balance and social metrics |
| `pnpm mapviz`    | Render generated maps to SVG for inspection                |

## HTTP API

The browser client is one consumer of a small JSON API, not a privileged one.

| Endpoint                     | What it does                                                         |
| ---------------------------- | -------------------------------------------------------------------- |
| `POST /api/games`            | Create a table; the response seats you and returns your token        |
| `GET /api/games`             | Lobbies still open to join                                           |
| `POST /api/games/:id/join`   | Take a seat, by game id or table code                                |
| `POST /api/games/:id/start`  | Host only: begin now, filling empty seats with bots                  |
| `GET /api/games/:id`         | The game as one viewer may see it, redacted for `?token=`            |
| `GET /api/games/:id/map`     | The generated map — public, and constant for the whole game          |
| `POST /api/games/:id/orders` | Save a draft, or lock it in with `{"locked": true}`                  |
| `POST /api/games/:id/resign` | Leave the war                                                        |
| `GET /api/games/:id/history` | Every turn report so far                                             |
| `GET /api/games/:id/stream`  | Server-sent events; each carries only a version number to refetch on |

## License

Not yet determined.
