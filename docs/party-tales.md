# Adding a tale to the dinner party

Read the decision on record before anything else, because it constrains what this guide can
honestly be:

> **Is a new tale a re-skin or its own mechanic?** Its own mechanic. A tale is code, so only two
> or three will ever exist. _Rejected: one engine, many skins — a new tale as a JSON file, five
> tales in a weekend. Rejected because Sleeping Beauty has no traitor in it: re-skinned it becomes
> a murder mystery in a tiara, and the tale does no work. The mechanic **is** the story._
>
> — [docs/design/dinner-party.md](design/dinner-party.md)

So this is not a "drop a JSON file in `tales/`" guide, and writing one would be building the
thing that was turned down. What follows is the honest version: what a tale is in this codebase,
which parts of the party are tale-shaped and which survive any tale unchanged, and what a second
one actually costs.

For the wider question of what a "mode" is and which axis a new idea belongs on, see
[docs/game-modes.md](game-modes.md). A tale is the most expensive axis of all — expensive enough
that §3 below exists to talk you out of it.

## The discriminator that does nothing yet

`tale: 'sleeping-beauty'` is a field on `PartyState` (`party/types.ts:165`), on `PartyGameDoc`
(`store.ts:73`) and on `PartyGameView` (`api-types.ts:105`). It is written in three places and
**branched on nowhere.** The redactor ignores it and serves a module-level constant:

```ts
const TALE = {
  title: 'Sleeping Beauty',
  prompt:
    'Someone at this christening cursed the baby. Find out who before the last candle goes out.',
};
// ...
tale: dealt(state) ? { ...TALE } : null,
```

That is the shape of the work, in miniature. The slot for a second tale exists at every layer
that stores or ships one; what does not exist is a single line that reads it. Making that field
load-bearing is the first step of any route below, and it is small.

## What is tale-shaped and what is not

Almost all of the party is tale-neutral. The evening's structure — seats, rounds, a bell, a
floor, a weighted vote, candles as a clock — is machinery that would carry a different story
without noticing.

| Tale-neutral, survives any tale                                                                                          | Tale-coupled                                               |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `state.ts` — build, clone, seat, drop                                                                                    | the costume axes and the 64-costume deck                   |
| `clock.ts` — rounds, bell, vote settling, `advanceParty` — **except its outcome prose**                                  | the clue grammar: pinning, chipping, alibi sentences       |
| `rules.ts` — voices, weights, who may vote, who speaks for whom                                                          | the falsehood grammar (`makeLie`, five variants)           |
| `actions.ts` — the eight actions and the one transaction shape — **except its reject prose and the two duo seams below** | `FAVOURS`, `DUOS`, `KID_PARTS`, `GROWN_PARTS`, `lieBudget` |
| `redact.ts` — assembles rather than filters — **except the `TALE` const**                                                | candles as the fiction of the clock                        |
| the whole server half, the routing, the tick sweep, the poll intervals                                                   | the ending strings, wherever they are written              |

Two entries in that right column are not in `tale.ts`, and they are the ones that will surprise
you. **The prose is scattered.** `clock.ts` writes `'the last candle went out — Aurora sleeps'`
and `'the curse is broken — you named the one who laid it'`; `actions.ts` rejects with
`'no child laid that curse'` and `` `${suspect.name} was never at the christening` ``. Those are
Sleeping Beauty sentences living inside tale-neutral machinery. Collecting them is a
prerequisite for a second tale and a decent standalone change on its own.

### The four abilities are four different seams

This is the concrete evidence for "a tale is code". A duo character looks like data in `DUOS`,
but every ability is implemented somewhere else, keyed on the `duoId` string:

| Duo           | Ability                                           | Implemented in                                                                         |
| ------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Godmother** | falsehoods show themselves to her                 | `redact.ts` — `fake: duoId === 'godmother' ? p.fake : null`                            |
| **Huntsman**  | one question: has this guest ever lied            | `actions.ts` `applySniff`, **plus its own `sniff` variant on the `PartyAction` union** |
| **Nursemaid** | sees every encounter in the hall                  | `redact.ts` — the `hall` field                                                         |
| **Spinner**   | a piece dealt to the child copies to the grown-up | `actions.ts` `dealPiece`                                                               |

A new cast is therefore not a new array. Each character is a change at whichever seam its
ability lives on, and one of them widened the action union — `sniff` exists in the wire protocol
only because the Huntsman does. Four characters needed no new machinery precisely because they
were each built out of state the game already tracked; a fifth is only cheap if the same is true
of it.

## Three routes, cheapest first

### 1. A new mode inside Sleeping Beauty — usually the right answer

Before reaching for a tale, check whether the idea is a **mode**. `together` is the worked
example and it is substantial: nobody at the table is guilty, the suspects are six courtiers who
went home, there are no falsehoods, the cast shrinks to two duos, and an accusation settles on
the spot instead of going to a vote. That is a different game for a different room — and it cost
branches in `duosFor`, `dealTale`, `minGrownUps`, `suspects` and `applyNominate`, with **no new
tale, no document field and no migration**.

If your idea can be expressed as "same christening, different rules", stop here and follow
[docs/game-modes.md](game-modes.md) §3.

### 2. A re-skin — cheap, and the design says no

New words over the same mechanic: swap the costume axes, the clue sentences, the parts and the
favours; point `TALE` at the new title; gate all of it on `state.tale`. Perhaps a day's work.

The design rejected this as a way to make _tales_, and the reasoning holds: the deduction is a
costume-pinning puzzle wrapped in a traitor, and the traitor is already an import into Sleeping
Beauty rather than something the story supplies. Re-skinned onto another story, the words change
and the game does not — you get the same evening with different nouns, plus a second cast to
maintain and a second set of strings to keep in step.

If you want the new words anyway, the honest framing is a **variant of Sleeping Beauty**, not a
second tale: keep `tale: 'sleeping-beauty'`, put the swap behind a mode, and do not spend the
discriminator on it. Spending `tale` on a re-skin is what makes the field mean nothing later.

### 3. A second tale — the real thing

A second tale earns the name when the mechanic is _of_ the story: the puzzle, the culprit's move,
and the clock all come from the tale rather than being inherited from this one. That is a design
problem before it is an engineering one, and it belongs in `ideas/` and a brainstorm before any
code — the question to answer first is **what does this story make possible that a christening
does not**, and if the answer is "nothing, but the words are nicer", see route 2.

When the mechanic is settled, the engineering shape is:

**Make the discriminator real first.** One commit, no new tale: collect the scattered prose,
give `redact.ts` a lookup on `state.tale` instead of a constant, and confirm every existing test
still passes. Nothing changes behaviourally and the seam now exists.

**Then define what a tale supplies.** Roughly:

```ts
interface Tale {
  id: PartyState['tale'];
  title: string;
  prompt: string;
  cast: readonly Duo[];
  favours: readonly Favour[];
  /** Costumes, culprit, parts, deck, opening hands — leaves the party `invited`. */
  deal(state: PartyState, seed: string): PartyState;
  /** The culprit's move, or null for a tale whose culprit cannot lie. */
  makeLie(state: PartyState, seed: string): string | null;
  /** Every ending sentence this tale can write. */
  outcome(state: PartyState, ending: Ending): string;
}
```

**And be clear about what stays out of it.** The abilities do not go in this interface, because
they are not data — each is a branch at a seam in `redact.ts` or `actions.ts`, and pretending
otherwise produces an interface that cannot express the Huntsman without also owning the action
union. Dispatch the cast from the tale; implement each ability where it lives; accept that a
tale with genuinely new abilities touches those files. That honesty is the whole reason the
design says two or three tales, ever.

## Invariants a tale must hold

**Solvable by construction, not by luck.** The three pinning clues are always in the deck, and
costumes are dealt distinct, so pinning all three attributes names exactly one guest. An earlier
version sliced the pool per player, could slice the pinning clues out, and left a puzzle with no
answer and no way to notice. The gate is the seeded sweep at `party/tale.test.ts:55` — 3,600
parties from 3 to 20 guests, asserting distinct costumes, that the pinning clues survive, and
that they resolve to exactly the culprit. **A new tale needs its own equivalent property and its
own sweep.** If you cannot state the property, the tale is not solvable and you have not noticed.

**The attribute space must exceed the hall.** 4 gowns × 4 gifts × 4 places is 64 distinct
costumes against a ceiling of `MAX_PARTY_GUESTS = 20`. Choose axes that multiply out past 20 or
pinned attributes stop naming one person and the puzzle quietly stops having an answer.

**Every draw comes from a named substream, keyed so it cannot drift.** Note the keys already in
use: `('party', 'piece', guest.id, hand size)` and `('party', 'lie', culprit.id, lies remaining)`.
Both key on a quantity that only ever moves one way, so a clock advance interleaved between two
encounters cannot shift the stream. A running counter would have. Copy that discipline.

**Redaction assembles, it does not filter.** Anything not addressed to a viewer is never built.
A tale that adds a secret adds it to `cardFor`, never to the base view with a strip afterwards.

**Degrade, never throw.** Twenty grown-ups outrun a twenty-name cast once duos have eaten from
it, and `dealParts` numbers the overflow rather than leaving a guest with no part — a guest
nobody can talk about is worse than an inelegant name.

**Guest names must be distinct**, because alibi clues name guests and two guests called Sam make
one sentence that reads as two. `seatGuests` in `server/party.ts` already suffixes duplicates;
any tale whose clues name people inherits that requirement.

## Migration hazards

Parties in flight were dealt by the code that existed when the host pressed deal, and their
state is in `partyJson`. Two fields are stored **by position or by id**, so editing the tables
they point into silently rewrites a running party:

- **`guest.favour` is an index into `FAVOURS`.** Reordering or removing an entry changes what
  every child in every in-flight party is owed, mid-evening. Append only.
- **`guest.duoId` is a `DuoId` string.** Removing or renaming a duo orphans stored guests whose
  card no longer resolves.

Held pieces are stored as text, so clue-grammar changes are safe for parties already dealt —
yesterday's party keeps yesterday's sentences and finishes correctly. `formatVersion: 1` on
`PartyState` is the escape hatch if a change cannot be made compatible; nothing reads it yet, and
a tale that needs it should be the change that teaches it to.

## Checklist

1. Is it a mode rather than a tale? ([docs/game-modes.md](game-modes.md) §3 — usually yes.)
2. Does the mechanic come from the story, or are you re-skinning? If re-skinning, make it a
   variant and keep the discriminator.
3. Is `state.tale` actually read yet? If not, that commit comes first, on its own.
4. State the solvability property, and write its sweep before the tale.
5. Does the attribute space multiply out past `MAX_PARTY_GUESTS`?
6. Every draw on a named substream, keyed on a monotone quantity.
7. Does each new ability have a seam, and does one of them widen `PartyAction`?
8. Have you appended to `FAVOURS` and `DUOS` rather than reordering them?
9. Mirror the tests: `tale.test.ts` for the deal, `redact.test.ts` for the secrets,
   `actions.test.ts` for the moves, `together.test.ts` for a mode-shaped variant.
