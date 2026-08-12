# Tiers Contest & Configurable Turn Cap — Design

Date: 2026-08-11
Status: Approved pending spec review

## Summary

Two features:

1. **Tiers** — a second contest implementation behind the existing `Contest` interface
   (`packages/engine/src/contest/types.ts`). Where Pact is a loyalty game, Tiers is a
   *legibility* game: each turn every player ranks a topic A–F in secret, and rivals score by
   correctly guessing how others ordered their lists. Knowing your rivals pays; being known pays
   too.
2. **Configurable turn cap** — game length becomes a creation option, with the time-based rule
   knobs derived from it so short and long games stay balanced.

## 1. The Tiers contest

### Core loop

A game is created with `contest: 'pact' | 'tiers'`. Tiers input is blind, single-phase and
pre-committed alongside orders, exactly as the Contest interface requires. Lists are **pipelined
across turns** so every playable turn has scoring potential:

1. **Lobby ("turn 0").** The first topic is visible on join. A seat is not ready until its
   first list is submitted.
2. **Write (every turn).** A topic is announced at turn start — drawn deterministically from a
   curated topic bank via the game's seeded RNG, without repeats; the same topic for everyone.
   Each player writes six free-text entries, one per tier A–F: their honest ranking for the
   topic. Entries must be distinct after normalization (lowercase, trim, strip punctuation).
3. **Publish.** When a turn resolves (and at game start for lobby lists), each player's six
   items appear in the report **shuffled** (deterministic seeded shuffle). Everyone sees *what*
   you wrote, not *where* you put it.
4. **Guess (every turn).** Alongside writing their next list, each player picks **up to two
   living rivals** and reorders each rival's shuffled items into A–F as they believe the author
   placed them. Guessing is optional; abstaining is neutral.
5. **Reveal.** At resolution the author's true ordering is revealed, guesses are scored, and
   multipliers apply to every battle that turn.

Each list lives one cycle: written on turn N, shuffled items published in the turn-N report,
guessed during turn N+1, revealed and scored in the turn-N+1 report. A player's final list is
never guessed. Dead players' lists leave the guessable pool.

Table talk ("I obviously put Waffle House in A") is signaling, exactly like pact coordination in
chat — legal and intended.

### Scoring

All values live in the ×100 multiplier space Pact uses (Pact spans 80–140; the dice nudge still
applies on top). Constants are tunable at implementation; this is the approved shape.

**Guess score** — per item versus the author's true placement:

| Placement    | Points |
| ------------ | ------ |
| Exact tier   | 2      |
| One tier off | 1      |
| Further      | 0      |

Maximum 12 per guess. Random-permutation expectation ≈ 3.7.

**Multiplier** = `clamp(80, 140, 100 + guessing + being_read)`:

- **Guessing:** each submitted guess contributes `(score − 6) × 2` → −12…+12 per guess, so two
  guesses span −24…+24. A wild guess *hurts* — guessing is a wager, not free upside. Abstaining
  contributes 0.
- **Being read:** with `B` = the best guess score made against your list, you gain
  `max(0, B − 6)` → up to +6, never negative. An illegible list denies rivals points but earns
  you nothing: being predictable is a mutual good.

**No bonus income** in v1 (`bonusIncome` is all zeros; Pact's courted-income has no analogue
here).

**Turn report** shows: the topic, each author's revealed ordering, each guess with its score,
and a named callout for the best read of the turn ("X read Y like a book — 11/12"), mirroring
how betrayals are named under Pact.

### Engine architecture

New files: `packages/engine/src/contest/tiers.ts`, `packages/engine/src/contest/topics.ts`.

- **Input type:**
  `TiersInput = { list: string[] /* 6, A→F */, guesses: Array<{ target: Slot, order: number[] /* permutation of 0–5 over the target's shuffled items */ }> /* ≤2 */ }`
- **Normalization mirrors Pact:** invalid input degrades silently rather than erroring. A guess
  targeting a dead player, yourself, a slot without a published list, a duplicate target, or a
  malformed permutation is dropped. A malformed or missing list (absent player) means that slot
  is simply unguessable next turn — no author bonus possible, no penalty either.
- **Topic bank:** ~50 curated topics, each with ~10 canned candidate items. Bots sample six
  canned items and order them (seeded RNG), so a bot's list is guessable like anyone's. Topic
  per turn = seeded draw without repeats within a game.
- **State additions (per slot):** current list (items in author order), its published shuffle
  (or the seed to derive it), and the topic history. `redact.ts` hides author orderings and all
  pending inputs; shuffled items are public once published.
- **Dispatch:** game config gains `contest: 'pact' | 'tiers'`; the resolve pipeline selects the
  implementation by id. Resolution stays a pure function of (state, inputs, rng) — replay
  hashes must remain stable.

### Victory conditions under Tiers

Condominium and Concordat are built on pact streaks (`pactStreak`, `concordAt`), which do not
exist in a Tiers game. **Tiers games run solo routes + turn cap only** (conquest, domination,
hegemony, decapitation, standings at the cap). An "attunement" analogue for shared wins is
explicitly deferred until Tiers proves fun. With the cap configurable (below), a short Tiers
game — 15 turns, standings decide, no draws — is the natural party format.

## 2. Configurable turn cap

Game creation gains a length setting: presets **Short (15)**, **Standard (25)**, **Long (35)**,
or a custom cap in the **10–50** range. Applies to all games regardless of contest.

Rules derive from the cap — `rulesFor(playerCount, turnCap)`:

- **Storm schedule scales proportionally** so the map still burns down to its floor a few turns
  before the cap: `stormFirstWave ≈ 40% of cap` (floor 4), interval tightening on short games.
  Exact values validated with the balance harness (`simulate.ts`) like every other tuned
  constant.
- **Streaks stay absolute** (hegemony 2, decapitation 2, condominium 3). Holding ground for two
  turns means the same thing at any cap, and shrinking streaks to 1 would fire those routes on
  snapshots — the bug the streaks exist to prevent. On short caps streak routes are naturally
  rarer and standings endings more common; that is the honest trade of a short game.
- **Concordat window scales down:** `min(5, ~cap/3)`, so "recent cooperation" never means "a
  third of the game ago".

## 3. Server

- Creation API accepts `contest` and `turnCap`; both validated (enum / 10–50 integer) and
  persisted with the game.
- Lobby readiness requires the turn-0 list in Tiers games.
- `store.ts` persists Tiers inputs alongside orders; inputs are secret until resolution.
- `api-types.ts` extended with the new input/report shapes.

## 4. Web

- **Creation form:** contest toggle (Pact / Tiers) and game-length selector.
- **Order form (Tiers games):** a list editor (six labelled text fields A–F, distinctness
  enforced with normalized comparison client-side) and a guess panel — pick up to two rivals,
  drag each rival's shuffled items into tiers.
- **Turn report:** topic, revealed orderings, per-guess scores, best-read callout.
- **Lobby:** first topic and list editor shown before ready-up.

## 5. Testing

- **Engine:** unit tests for guess scoring (exact/adjacent/far, clamps), input normalization
  (dead/self/dup targets, malformed permutations and lists), determinism (same state+inputs+seed
  → same outcome and replay hash), shuffle determinism, redaction (no ordering leaks in
  redacted state), topic draw without repeats. Full simulated bot games under `tiers` at several
  player counts and caps.
- **Rules scaling:** unit tests for `rulesFor(playerCount, turnCap)` bounds and monotonicity;
  balance-harness runs at caps 15/25/35 to confirm games still end decisively.
- **Server:** input validation tests (creation options, list/guess payloads, lobby readiness).
- **Web:** `useGame` tests for the new input state; manual browser pass over lobby → write →
  guess → report golden path.
