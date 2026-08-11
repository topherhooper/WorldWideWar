/**
 * The bots.
 *
 * Pure functions of (redacted state, slot, seeded rng) — so bot play is
 * deterministic and replayable, and a bot physically cannot see anything a
 * human player could not. They run inside turn resolution, filling seats,
 * enabling solo play, and covering players who miss a deadline.
 *
 * The military layer is deliberately shallow: one-ply scoring, no search. The
 * interesting part is the pact layer, because that is where a bot either feels
 * like an opponent with a memory or like a dice roll with a name.
 */

import { battleOdds } from '../combat.js';
import { MIN_CONDOMINIUM_PLAYERS, PACT_MULTIPLIER } from '../constants.js';
import { articulationPoints } from '../graph.js';
import type { Rng } from '../rng.js';
import { territoryCount } from '../supply.js';
import type {
  Deployment,
  GameState,
  GeneratedMap,
  OrderSet,
  Slot,
  TerritoryId,
  UnitOrder,
} from '../types.js';
import { attackThreshold, type BotPersonality } from './personality.js';

export { makePersonality, attackThreshold } from './personality.js';
export type { BotPersonality, Difficulty } from './personality.js';

/** How far a remembered betrayal moves a trust score. */
const BETRAYAL_TRUST_PENALTY = 4;
/** How far a *reputation* for betraying others moves it. */
const REPUTATION_TRUST_PENALTY = 1.5;
/** Bots avoid strengthening whoever is already winning. */
const LEADER_TRUST_PENALTY = 2.5;
/** A concord is worth most where fighting will actually happen. */
const SHARED_FRONT_TRUST_BONUS = 3.0;
/** Trust below this and the bot would rather abstain than pledge. */
const PLEDGE_TRUST_FLOOR = -1;
/**
 * Scales how often a bot breaks a standing pact.
 *
 * Tuned from the balance harness rather than intuition: the target band is
 * 15-45% of mutual pacts broken. Below that the dilemma is toothless and the
 * pact is merely a bonus for pairing up; above it nobody ever cooperates and
 * the whole social layer reads as noise.
 */
const BETRAYAL_APPETITE = 6.5;
/** How much of the odds bar a bot waives once it has committed to a stab. */
const BETRAYAL_THRESHOLD_RELIEF = 0.2;

export function decideOrders(
  state: GameState,
  map: GeneratedMap,
  slot: Slot,
  rng: Rng,
  personality: BotPersonality,
): OrderSet {
  if (state.status[slot] !== 'active') return { slot, pledge: null, deploys: [], units: [] };

  const pledge = decidePledge(state, map, slot, rng, personality);
  const betraying = decideBetrayal(state, map, slot, rng, personality, pledge);

  const owned = ownedTerritories(state, slot);
  const value = territoryValues(state, map, slot, personality);
  const threat = threatMap(state, map, slot);
  const critical = criticalTerritories(state, map, slot);

  const deploys = decideDeploys(state, map, slot, owned, threat, critical);

  // Deploys land before moves, so the bot plans attacks against the garrison it
  // is about to have rather than the one it has now.
  const garrison = state.armies.slice();
  for (const deploy of deploys) garrison[deploy.to] += deploy.count;

  const units = decideUnits(
    state,
    map,
    slot,
    rng,
    personality,
    owned,
    garrison,
    value,
    threat,
    critical,
    pledge,
    betraying,
  );

  return { slot, pledge, deploys, units };
}

/**
 * Fills the gaps in a partially-submitted order set.
 *
 * Used when a human misses a deadline. A missed turn still has to be a
 * *competent* turn — in a twelve-player free-for-all a passive seat becomes
 * free food and warps the whole game around whoever happens to border it.
 */
export function assistOrders(
  state: GameState,
  map: GeneratedMap,
  slot: Slot,
  rng: Rng,
  personality: BotPersonality,
  draft: OrderSet | null,
): OrderSet {
  const full = decideOrders(state, map, slot, rng, personality);
  if (!draft) return full;

  const claimed = new Set<TerritoryId>(draft.units.map((unit) => unit.from));
  const deployed = new Set<TerritoryId>(draft.deploys.map((deploy) => deploy.to));

  const spent = draft.deploys.reduce((sum, deploy) => sum + deploy.count, 0);
  let remaining = Math.max(0, state.income[slot] - spent);

  const extraDeploys: Deployment[] = [];
  for (const deploy of full.deploys) {
    if (remaining <= 0) break;
    if (deployed.has(deploy.to)) continue;
    const count = Math.min(deploy.count, remaining);
    remaining -= count;
    extraDeploys.push({ to: deploy.to, count });
  }

  return {
    slot,
    // The player's own pledge is honoured if they made one; otherwise the bot
    // pledges on their behalf rather than silently abstaining.
    pledge: draft.pledge ?? full.pledge,
    deploys: [...draft.deploys, ...extraDeploys],
    units: [...draft.units, ...full.units.filter((unit) => !claimed.has(unit.from))],
  };
}

// ─── The pact layer ──────────────────────────────────────────────────────────

/**
 * Trust in each rival, built from the public pact record.
 *
 * A bot that was personally betrayed carries a grudge for the rest of the game;
 * a bot that merely watched someone else get betrayed discounts them more
 * mildly. That asymmetry is what makes reputation feel earned rather than
 * globally broadcast.
 */
export function trustScores(
  state: GameState,
  map: GeneratedMap,
  slot: Slot,
  personality: BotPersonality,
): number[] {
  const scores = new Array<number>(state.playerCount).fill(Number.NEGATIVE_INFINITY);
  const leader = currentLeader(state);
  const neighbours = borderingPlayers(state, map, slot);

  for (let other = 0; other < state.playerCount; other++) {
    if (other === slot || state.status[other] !== 'active') continue;

    let score = personality.loyalty * 2;
    score -= state.betrayedBy[slot][other] * BETRAYAL_TRUST_PENALTY * personality.vengefulness;
    score -= state.pactsBroken[other] * REPUTATION_TRUST_PENALTY;
    score += Math.min(state.pactsHonored[other], 4) * 0.5;

    // Feeding a runaway is how a table loses to one player.
    if (other === leader && territoryCount(state, other) > territoryCount(state, slot)) {
      score -= LEADER_TRUST_PENALTY;
    }
    if (neighbours.has(other)) score += SHARED_FRONT_TRUST_BONUS;

    // Continuing an existing concord is worth something in itself: streaks are
    // what gate a shared victory.
    if (state.pactPartner[slot] === other) score += 1 + state.pactStreak[slot] * 0.5;

    scores[other] = score;
  }

  return scores;
}

/**
 * A tie-break shared by both halves of a pairing.
 *
 * Deterministic and symmetric in (a, b), so two bots weighing each other
 * compute the identical value — which is what lets them agree without
 * communicating.
 *
 * It must also be mixed with the game seed. Keying on (turn, a, b) alone looks
 * harmless but is not: the same pairs are then favoured on the same turn of
 * *every game ever played*, so particular seats reliably draw better partners.
 * That alone produced a 6.8% seat win-rate deviation — four standard errors at
 * 500 games — on a map that is provably symmetric.
 */
function pairJitter(seedHash: number, turn: number, a: Slot, b: Slot): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let h =
    Math.imul(seedHash, 2654435761) ^
    Math.imul(turn, 73856093) ^
    Math.imul(lo, 19349663) ^
    Math.imul(hi, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Cheap stable hash of the map seed, which every player can see. */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * How attractive a pairing is *to both sides at once*, from public information
 * only.
 *
 * Choosing a partner by one's own preference alone is a coordination failure:
 * every bot independently picks the most appealing player, most pledges go
 * unreciprocated, and — because ties broke toward the lowest slot — the early
 * seats collected all the concords while the late seats sat permanently at the
 * spurned multiplier. That produced a 29%-to-8% seat win spread on a map that
 * is provably symmetric.
 *
 * Scoring the *pair* symmetrically fixes both problems at once: two bots
 * evaluating each other reach the same number, so they tend to choose each
 * other, and the jitter tie-break removes any systematic seat preference.
 */
function pairScore(
  state: GameState,
  seedHash: number,
  a: Slot,
  b: Slot,
  neighbours: ReadonlySet<Slot>,
): number {
  let score = 0;

  // A concord is worth most where fighting would otherwise happen.
  if (neighbours.has(b)) score += SHARED_FRONT_TRUST_BONUS;

  // Grudges run both ways and are public.
  score -= (state.betrayedBy[a][b] + state.betrayedBy[b][a]) * BETRAYAL_TRUST_PENALTY;
  score -= (state.pactsBroken[a] + state.pactsBroken[b]) * REPUTATION_TRUST_PENALTY;
  score += Math.min(state.pactsHonored[b], 4) * 0.4;

  // An existing partnership is worth continuing: streaks gate a shared win.
  if (state.pactPartner[a] === b && state.pactPartner[b] === a) {
    score += 1.5 + state.pactStreak[a] * 0.6;
  }

  const leader = currentLeader(state);
  if (leader !== null && leader !== a && territoryCount(state, leader) > territoryCount(state, a)) {
    if (b === leader) score -= LEADER_TRUST_PENALTY;
  }

  return score + pairJitter(seedHash, state.turn, a, b) * 0.9;
}

/**
 * Pairs off the whole table, greedily by pair score.
 *
 * Every input is public, and the algorithm is deterministic, so each bot
 * computes the *same* matching and simply reads off its own partner. That is
 * what turns pledging from an independent guess into genuine coordination —
 * picking a favourite alone leaves roughly half of all pledges unreciprocated,
 * because a bot's first choice frequently prefers someone else.
 *
 * It is not collusion: the matching uses only what any player at the table can
 * see, and a human reading the same board could reach the same conclusion. Bots
 * still defect from it through chaos and betrayal.
 */
export function tableMatching(state: GameState, map: GeneratedMap): (Slot | null)[] {
  const seedHash = hashSeed(map.seed);
  const alive: Slot[] = [];
  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] === 'active') alive.push(slot);
  }

  const neighbours = new Map<Slot, Set<Slot>>();
  for (const slot of alive) neighbours.set(slot, borderingPlayers(state, map, slot));

  const pairs: { a: Slot; b: Slot; score: number }[] = [];
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      // Symmetric by construction: both orderings must produce one number.
      const score =
        (pairScore(state, seedHash, a, b, neighbours.get(a)!) +
          pairScore(state, seedHash, b, a, neighbours.get(b)!)) /
        2;
      pairs.push({ a, b, score });
    }
  }

  pairs.sort((x, y) => y.score - x.score || x.a - y.a || x.b - y.b);

  const partner = new Array<Slot | null>(state.playerCount).fill(null);
  const taken = new Set<Slot>();
  for (const pair of pairs) {
    if (taken.has(pair.a) || taken.has(pair.b)) continue;
    if (pair.score <= PLEDGE_TRUST_FLOOR) continue;
    partner[pair.a] = pair.b;
    partner[pair.b] = pair.a;
    taken.add(pair.a);
    taken.add(pair.b);
  }

  return partner;
}

function decidePledge(
  state: GameState,
  map: GeneratedMap,
  slot: Slot,
  rng: Rng,
  personality: BotPersonality,
): Slot | null {
  const best = tableMatching(state, map)[slot];

  // Easy bots pledge close to at random, which is most of what makes them read
  // as impulsive rather than merely weak.
  if (best !== null && rng.float() < personality.chaos) {
    const candidates: Slot[] = [];
    for (let other = 0; other < state.playerCount; other++) {
      if (other !== slot && state.status[other] === 'active') candidates.push(other);
    }
    if (candidates.length > 0) return rng.pick(candidates);
  }

  return best;
}

/**
 * Decides whether to break the pact being pledged this turn.
 *
 * Betrayal is opportunistic rather than random: a bot defects when the partner
 * is weak enough that the 1.40 multiplier is likely to convert into captured
 * ground, and when its own loyalty does not hold it back.
 */
function decideBetrayal(
  state: GameState,
  map: GeneratedMap,
  slot: Slot,
  rng: Rng,
  personality: BotPersonality,
  pledge: Slot | null,
): boolean {
  if (pledge === null) return false;

  // Honour a pact that is on track to win the game outright — but only where a
  // shared victory actually exists. In a duel the two players always hold ~100%
  // of the map between them, so this guard would fire every single turn and the
  // bots would never break faith at all (measured: 5% betrayal at two players
  // against 20-30% everywhere else).
  if (
    state.playerCount >= MIN_CONDOMINIUM_PLAYERS &&
    state.pactPartner[slot] === pledge &&
    state.pactStreak[slot] >= 2
  ) {
    const share =
      (territoryCount(state, slot) + territoryCount(state, pledge)) /
      Math.max(1, liveTerritories(state));
    if (share > 0.6) return false;
  }

  const mine = territoryCount(state, slot);
  const theirs = territoryCount(state, pledge);
  if (theirs === 0) return false;

  // Only worth it against someone you can actually reach and actually hurt.
  if (!borderingPlayers(state, map, slot).has(pledge)) return false;

  const advantage = mine / (mine + theirs);
  const appetite = (1 - personality.loyalty) * (0.5 + personality.aggression);
  return rng.float() < advantage * appetite * BETRAYAL_APPETITE;
}

// ─── The military layer ──────────────────────────────────────────────────────

function decideDeploys(
  state: GameState,
  map: GeneratedMap,
  slot: Slot,
  owned: TerritoryId[],
  threat: number[],
  critical: Set<TerritoryId>,
): Deployment[] {
  let budget = state.income[slot];
  if (budget <= 0) return [];

  const eligible = owned.filter((id) => state.supplied[id]);
  if (eligible.length === 0) return [];

  const placed = new Map<TerritoryId, number>();
  const strength = state.armies.slice();

  // One army at a time, recomputing after each: a greedy pass that re-scores
  // keeps a bot from dumping its whole income onto one already-safe frontier.
  while (budget > 0) {
    let target = eligible[0];
    let bestScore = -Infinity;

    for (const id of eligible) {
      const deficit = threat[id] - strength[id];
      const score = deficit + (critical.has(id) ? 2 : 0) + (map.adjacency[id].length > 4 ? 0.5 : 0);
      if (score > bestScore) {
        bestScore = score;
        target = id;
      }
    }

    placed.set(target, (placed.get(target) ?? 0) + 1);
    strength[target]++;
    budget--;
  }

  return [...placed.entries()].map(([to, count]) => ({ to, count })).sort((a, b) => a.to - b.to);
}

function decideUnits(
  state: GameState,
  map: GeneratedMap,
  slot: Slot,
  rng: Rng,
  personality: BotPersonality,
  owned: TerritoryId[],
  garrison: number[],
  value: number[],
  threat: number[],
  critical: Set<TerritoryId>,
  pledge: Slot | null,
  betraying: boolean,
): UnitOrder[] {
  const units: UnitOrder[] = [];
  const used = new Set<TerritoryId>();
  const threshold = attackThreshold(personality);

  interface Candidate {
    from: TerritoryId;
    to: TerritoryId;
    count: number;
    odds: number;
    score: number;
    /** Seeded tie-break — see the sort below for why this is not optional. */
    jitter: number;
  }

  const candidates: Candidate[] = [];

  for (const from of owned) {
    const available = garrison[from];
    if (available <= 1) continue;

    for (const to of map.adjacency[from]) {
      if (state.collapsed[to]) continue;
      const defender = state.owner[to];
      if (defender === slot) continue;

      // Respect the pledge unless this is the turn the bot breaks it.
      const stabbing = defender !== null && defender === pledge;
      if (stabbing && !betraying) continue;

      // Hold enough back to cover the threat this territory is under, unless
      // the territory is not actually threatened.
      const reserve = critical.has(from) ? Math.min(available - 1, Math.ceil(threat[from] / 2)) : 0;
      const committed = available - Math.max(1, reserve);
      if (committed < 1) continue;

      // Both multipliers are unknown at commit time — the pact is blind — so
      // the bot plans against a neutral one for itself and its opponent alike.
      // The one exception is a stab it has already committed to: the betrayal
      // band is guaranteed the moment the partner honours the pact.
      const [odds] = battleOdds([
        { effective: committed, multiplier: stabbing ? PACT_MULTIPLIER.betrayal : 100 },
        {
          effective: state.armies[to] + defenceEstimate(state, to, defender),
          multiplier: 100,
          isDefender: true,
        },
      ]);

      // Having decided to break faith, the bot accepts a worse fight to do it —
      // otherwise the intent evaporates whenever no attack clears the normal
      // bar, and betrayals almost never actually happen.
      const bar = stabbing ? threshold - BETRAYAL_THRESHOLD_RELIEF : threshold;
      if (odds < bar && rng.float() > personality.chaos) continue;

      candidates.push({
        from,
        to,
        count: committed,
        odds,
        score: odds * value[to] - (1 - odds) * committed * 0.3,
        jitter: rng.float(),
      });
    }
  }

  // Ties MUST NOT break on territory id. Ids are laid out as
  // `local * playerCount + wedge`, and wedge is the owner's slot — so "lowest
  // id" silently means "lowest-numbered player". Early on, symmetric positions
  // produce tied scores constantly, so every bot piled onto its lower-numbered
  // neighbour and the highest seats went almost unattacked. That compounded
  // into a 12%-to-22% seat win spread on a provably symmetric map.
  candidates.sort((a, b) => b.score - a.score || a.jitter - b.jitter);

  for (const candidate of candidates) {
    if (used.has(candidate.from)) continue;
    used.add(candidate.from);
    units.push({ kind: 'MOVE', from: candidate.from, to: candidate.to, count: candidate.count });
  }

  // Frontier territories with nothing better to do lend weight to a neighbour's
  // fight. Hard bots only — it is a subtle play and an easy bot doing it well
  // reads as inconsistent with the rest of its behaviour.
  if (personality.difficulty === 'hard') {
    for (const from of owned) {
      if (used.has(from) || garrison[from] < 2) continue;
      const target = units.find(
        (unit) => unit.kind === 'MOVE' && map.adjacency[from].includes(unit.to),
      );
      if (target && target.kind === 'MOVE') {
        used.add(from);
        units.push({ kind: 'SUPPORT', from, target: target.to, forPlayer: slot });
      }
    }
  }

  return units.sort((a, b) => a.from - b.from);
}

/** Armies the defender could plausibly add this turn, from income alone. */
function defenceEstimate(state: GameState, _territory: TerritoryId, defender: Slot | null): number {
  if (defender === null) return 0;
  return Math.floor(state.income[defender] / 3);
}

// ─── Board reading ───────────────────────────────────────────────────────────

function ownedTerritories(state: GameState, slot: Slot): TerritoryId[] {
  const out: TerritoryId[] = [];
  for (let id = 0; id < state.owner.length; id++) {
    if (state.owner[id] === slot && !state.collapsed[id]) out.push(id);
  }
  return out;
}

function liveTerritories(state: GameState): number {
  let count = 0;
  for (let id = 0; id < state.collapsed.length; id++) if (!state.collapsed[id]) count++;
  return count;
}

/** Adjacent enemy strength, plus a discounted look one hop further out. */
function threatMap(state: GameState, map: GeneratedMap, slot: Slot): number[] {
  const threat = new Array<number>(state.owner.length).fill(0);

  for (let id = 0; id < state.owner.length; id++) {
    if (state.owner[id] !== slot || state.collapsed[id]) continue;

    for (const near of map.adjacency[id]) {
      if (state.collapsed[near]) continue;
      if (state.owner[near] !== slot && state.owner[near] !== null) {
        threat[id] += state.armies[near];
      }
      for (const far of map.adjacency[near]) {
        if (state.collapsed[far] || far === id) continue;
        if (state.owner[far] !== slot && state.owner[far] !== null) {
          threat[id] += state.armies[far] * 0.4;
        }
      }
    }
  }

  return threat;
}

function territoryValues(
  state: GameState,
  map: GeneratedMap,
  slot: Slot,
  personality: BotPersonality,
): number[] {
  const value = new Array<number>(state.owner.length).fill(1);

  for (const region of map.regions) {
    const live = region.territoryIds.filter((id) => !state.collapsed[id]);
    if (live.length === 0) continue;
    const missing = live.filter((id) => state.owner[id] !== slot);
    // A region one territory from completion is worth far more than its size.
    if (missing.length === 1) value[missing[0]] += region.bonus * (1 + personality.greed);
    else if (missing.length <= 3) {
      for (const id of missing) value[id] += (region.bonus / missing.length) * personality.greed;
    }
  }

  for (let other = 0; other < state.playerCount; other++) {
    if (other === slot) continue;
    const capital = state.capital[other];
    if (capital !== null) value[capital] += 3 * (1 + personality.greed);
  }

  return value;
}

/**
 * Territories whose loss would cut the bot's own supply network — the ones
 * worth garrisoning even when they are not the most obviously threatened.
 */
function criticalTerritories(state: GameState, map: GeneratedMap, slot: Slot): Set<TerritoryId> {
  const owned = ownedTerritories(state, slot);
  const index = new Map<TerritoryId, number>();
  owned.forEach((id, i) => index.set(id, i));

  const adjacency: number[][] = owned.map((id) =>
    map.adjacency[id].filter((n) => index.has(n)).map((n) => index.get(n)!),
  );

  const out = new Set<TerritoryId>();
  for (const [local] of articulationPoints(adjacency)) out.add(owned[local]);

  const capital = state.capital[slot];
  if (capital !== null) out.add(capital);
  return out;
}

function borderingPlayers(state: GameState, map: GeneratedMap, slot: Slot): Set<Slot> {
  const out = new Set<Slot>();
  for (let id = 0; id < state.owner.length; id++) {
    if (state.owner[id] !== slot || state.collapsed[id]) continue;
    for (const near of map.adjacency[id]) {
      const owner = state.owner[near];
      if (owner !== null && owner !== slot && !state.collapsed[near]) out.add(owner);
    }
  }
  return out;
}

export function currentLeader(state: GameState): Slot | null {
  let leader: Slot | null = null;
  let best = -1;
  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] !== 'active') continue;
    const count = territoryCount(state, slot);
    if (count > best) {
      best = count;
      leader = slot;
    }
  }
  return leader;
}
