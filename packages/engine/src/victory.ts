/**
 * Victory conditions.
 *
 * Games always end. Several routes close one out early, the storm shrinks the
 * map until one of them becomes reachable, and a hard turn cap resolves
 * anything still standing into ranked standings with no draws.
 *
 * Three of the routes are solo and pull in genuinely different directions —
 * take the most ground (domination), hold whole regions (hegemony), or take
 * everyone's capital (decapitation). Two are shared: a two-player condominium
 * and a three-player concordat.
 *
 * Two rules keep the shared routes honest:
 *
 * 1. **A solo win always beats a shared one.** Nobody ever settles for sharing
 *    a victory they could have taken outright, so cooperating never reads as
 *    the anticlimactic option.
 * 2. **A shared win must exclude somebody.** If the winners are everyone still
 *    alive, that is a draw wearing a different name, and the design promises
 *    none.
 *
 * The two shared routes also compete with each other, which is the interesting
 * part. A condominium wants one unbroken partnership; a concordat wants three
 * pairs that have each cooperated recently. You may only pledge one player per
 * turn, so closing a triangle means rotating pledges and forfeiting the streak
 * a condominium needs. You have to commit.
 */

import { MIN_CONCORDAT_PLAYERS, MIN_CONDOMINIUM_PLAYERS } from './constants.js';
import { concordPair } from './contest/pact.js';
import { suppliedCount, territoryCount } from './supply.js';
import { survivingTerritories } from './storm.js';
import type {
  GameResult,
  GameState,
  GeneratedMap,
  RuleConfig,
  Slot,
  VictoryKind,
  WorldEvent,
} from './types.js';

interface Claim {
  kind: VictoryKind;
  winners: Slot[];
  detail: string;
  /** How decisively it was met; separates two simultaneous solo claims. */
  margin: number;
}

export function checkVictory(
  state: GameState,
  map: GeneratedMap,
  rules: RuleConfig,
): GameResult | null {
  const alive: Slot[] = [];
  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] === 'active') alive.push(slot);
  }

  const finish = (claim: Claim): GameResult => ({
    kind: claim.kind,
    winners: claim.winners,
    standings: rankPlayers(state, map),
    detail: claim.detail,
  });

  if (alive.length === 0) {
    // Everyone burned or was eliminated in the same tick.
    return {
      kind: 'conquest',
      winners: [],
      standings: rankPlayers(state, map),
      detail: 'the world burned with nobody left to hold it',
    };
  }

  if (alive.length === 1) {
    return finish({
      kind: 'conquest',
      winners: alive,
      detail: 'last power standing',
      margin: Infinity,
    });
  }

  const surviving = survivingTerritories(state);

  // Solo routes first, best margin winning if two land at once.
  const solo = [
    ...dominationClaims(state, rules, alive, surviving),
    ...hegemonyClaims(state, map, rules, alive),
    ...decapitationClaims(state, map, rules, alive),
  ].sort((a, b) => b.margin - a.margin || a.winners[0] - b.winners[0]);

  if (solo.length > 0) return finish(solo[0]);

  const shared = [
    ...condominiumClaims(state, rules, alive, surviving),
    ...concordatClaims(state, rules, alive, surviving),
  ]
    // A shared win must leave somebody out.
    .filter((claim) => claim.winners.length < alive.length)
    .sort((a, b) => b.margin - a.margin || a.winners[0] - b.winners[0]);

  if (shared.length > 0) return finish(shared[0]);

  if (state.turn >= rules.turnCap) {
    const standings = rankPlayers(state, map);
    const [first, second] = standings;

    // At the cap a standing concord can still share first place on a lower
    // territory bar than mid-game — by now the storm has done most of the work
    // of deciding who was ever in contention.
    if (
      first !== undefined &&
      second !== undefined &&
      alive.length > 2 &&
      state.playerCount >= MIN_CONDOMINIUM_PLAYERS &&
      concordPair(state, first, second, rules.condominiumStreak) &&
      surviving > 0 &&
      (territoryCount(state, first) + territoryCount(state, second)) / surviving >= 0.6
    ) {
      return {
        kind: 'turn_cap',
        winners: [first, second],
        standings,
        detail: 'time ran out on an unbroken alliance',
      };
    }

    return {
      kind: 'turn_cap',
      winners: first === undefined ? [] : [first],
      standings,
      detail: 'time ran out',
    };
  }

  return null;
}

// ─── Solo routes ─────────────────────────────────────────────────────────────

function dominationClaims(
  state: GameState,
  rules: RuleConfig,
  alive: readonly Slot[],
  surviving: number,
): Claim[] {
  if (surviving <= 0) return [];
  const out: Claim[] = [];

  for (const slot of alive) {
    const share = territoryCount(state, slot) / surviving;
    if (share >= rules.dominationShare) {
      out.push({
        kind: 'domination',
        winners: [slot],
        detail: `holds ${Math.round(share * 100)}% of the surviving world`,
        margin: share - rules.dominationShare,
      });
    }
  }
  return out;
}

/**
 * Hold a share of the surviving regions outright, for consecutive turns.
 *
 * Rewards a compact defensible empire over sprawl: you can hold more ground
 * than anyone and still fail this, because a region only counts when you hold
 * every last territory in it. The streak requirement means you have to survive
 * a turn of everyone knowing you are one turn from winning.
 */
function hegemonyClaims(
  state: GameState,
  map: GeneratedMap,
  rules: RuleConfig,
  alive: readonly Slot[],
): Claim[] {
  const regionsAlive = map.regions.filter((region) =>
    region.territoryIds.some((id) => !state.collapsed[id]),
  );
  if (regionsAlive.length < rules.hegemonyMinRegionsAlive) return [];

  const needed = hegemonyTarget(regionsAlive.length, rules);
  const out: Claim[] = [];

  for (const slot of alive) {
    const held = fullyHeldRegions(state, map, slot);
    if (held >= needed && state.hegemonyStreak[slot] >= rules.hegemonyStreak) {
      out.push({
        kind: 'hegemony',
        winners: [slot],
        detail: `holds ${held} whole regions of ${regionsAlive.length}`,
        margin: (held - needed) / regionsAlive.length,
      });
    }
  }
  return out;
}

/** Territories inside regions this slot holds outright. */
function hegemonyCoverage(state: GameState, map: GeneratedMap, slot: Slot): number {
  let covered = 0;

  for (const region of map.regions) {
    let live = 0;
    let mine = 0;
    for (const id of region.territoryIds) {
      if (state.collapsed[id]) continue;
      live++;
      if (state.owner[id] === slot) mine++;
    }
    if (live > 0 && mine === live) covered += live;
  }
  return covered;
}

/**
 * Whole regions needed for a hegemony claim.
 *
 * The absolute floor matters as much as the share: without it the requirement
 * shrinks as the storm consumes regions, and the condition ends up trivially
 * satisfiable exactly when the map is smallest.
 */
function hegemonyTarget(regionsAlive: number, rules: RuleConfig): number {
  return Math.max(rules.hegemonyMinimum, Math.ceil(regionsAlive * rules.hegemonyShare));
}

/** Regions where this slot owns every surviving territory. */
export function fullyHeldRegions(state: GameState, map: GeneratedMap, slot: Slot): number {
  let held = 0;

  for (const region of map.regions) {
    let live = 0;
    let mine = 0;
    for (const id of region.territoryIds) {
      if (state.collapsed[id]) continue;
      live++;
      if (state.owner[id] === slot) mine++;
    }
    if (live > 0 && mine === live) held++;
  }
  return held;
}

/**
 * Hold your own founding capital and most of everyone else's.
 *
 * Surgical rather than a land grab — you can win this while holding relatively
 * little ground, provided it is the right ground. It gives raiders a published
 * target list and turns capitals into landmarks worth garrisoning rather than
 * just the tile your supply happens to run from.
 *
 * Founding capitals, not current ones: a relocated capital is a consolation
 * prize, and letting the target move would make the condition unfalsifiable.
 */
function decapitationClaims(
  state: GameState,
  map: GeneratedMap,
  rules: RuleConfig,
  alive: readonly Slot[],
): Claim[] {
  if (map.starts.length < 3) return [];
  const out: Claim[] = [];

  for (const slot of alive) {
    const own = map.starts.find((start) => start.slot === slot);
    if (!own) continue;
    if (state.owner[own.capital] !== slot || state.collapsed[own.capital]) continue;

    const rivals = map.starts.filter((start) => start.slot !== slot);
    const live = rivals.filter((start) => !state.collapsed[start.capital]);
    if (live.length === 0) continue;

    const seized = live.filter((start) => state.owner[start.capital] === slot).length;
    const needed = Math.floor(live.length * rules.decapitationShare) + 1;

    if (seized >= needed && state.decapitationStreak[slot] >= rules.decapitationStreak) {
      out.push({
        kind: 'decapitation',
        winners: [slot],
        detail: `holds ${seized} of ${live.length} rival capitals`,
        margin: (seized - needed) / live.length,
      });
    }
  }
  return out;
}

// ─── Shared routes ───────────────────────────────────────────────────────────

function condominiumClaims(
  state: GameState,
  rules: RuleConfig,
  alive: readonly Slot[],
  surviving: number,
): Claim[] {
  if (surviving <= 0 || state.playerCount < MIN_CONDOMINIUM_PLAYERS) return [];
  const out: Claim[] = [];

  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      if (!concordPair(state, a, b, rules.condominiumStreak)) continue;

      const share = (territoryCount(state, a) + territoryCount(state, b)) / surviving;
      if (share >= rules.condominiumShare) {
        out.push({
          kind: 'condominium',
          winners: [a, b],
          detail: `an unbroken alliance holding ${Math.round(share * 100)}% between them`,
          margin: share - rules.condominiumShare,
        });
      }
    }
  }
  return out;
}

/**
 * Three players, every pair having cooperated recently, none having betrayed
 * any of the others all game.
 *
 * Deliberately awkward to build. One pledge per turn means a triangle takes at
 * least three turns of rotating partners, during which you are repeatedly
 * choosing to spend your pledge on somebody who is not your current ally — and
 * forfeiting the unbroken streak a condominium would have wanted. A single
 * betrayal anywhere in the triangle voids it permanently, so it cannot be
 * assembled opportunistically at the end from people you have already crossed.
 */
function concordatClaims(
  state: GameState,
  rules: RuleConfig,
  alive: readonly Slot[],
  surviving: number,
): Claim[] {
  if (surviving <= 0 || state.playerCount < MIN_CONCORDAT_PLAYERS) return [];
  if (alive.length < 3) return [];

  const out: Claim[] = [];
  const recent = (a: Slot, b: Slot): boolean => {
    const at = state.concordAt[a][b];
    return at >= 0 && state.turn - at <= rules.concordatWindow;
  };
  const clean = (a: Slot, b: Slot): boolean =>
    state.betrayedBy[a][b] === 0 && state.betrayedBy[b][a] === 0;

  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      for (let k = j + 1; k < alive.length; k++) {
        const trio = [alive[i], alive[j], alive[k]] as const;
        const pairs: [Slot, Slot][] = [
          [trio[0], trio[1]],
          [trio[1], trio[2]],
          [trio[0], trio[2]],
        ];

        if (!pairs.every(([a, b]) => recent(a, b) && clean(a, b))) continue;

        const share = trio.reduce((sum, slot) => sum + territoryCount(state, slot), 0) / surviving;
        if (share >= rules.concordatShare) {
          out.push({
            kind: 'concordat',
            winners: [...trio],
            detail: `a three-way concordat holding ${Math.round(share * 100)}% between them`,
            margin: share - rules.concordatShare,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Updates the "hold it" streaks. Called during the world tick, before victory is
 * checked, so both reflect the board as it now stands.
 *
 * Hegemony and decapitation both require their condition to survive a turn of
 * everybody knowing you are one turn from winning. That is what makes them
 * earned rather than a snapshot, and it is what gives the rest of the table a
 * round to do something about it.
 */
export function updateVictoryStreaks(state: GameState, map: GeneratedMap, rules: RuleConfig): void {
  const regionsAlive = map.regions.filter((region) =>
    region.territoryIds.some((id) => !state.collapsed[id]),
  );
  const regionsNeeded = hegemonyTarget(regionsAlive.length, rules);

  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] !== 'active') {
      state.hegemonyStreak[slot] = 0;
      state.decapitationStreak[slot] = 0;
      continue;
    }

    const surviving = state.collapsed.reduce((n, c) => (c ? n : n + 1), 0);
    const meetsRegions =
      regionsAlive.length > 0 && fullyHeldRegions(state, map, slot) >= regionsNeeded;
    const meetsCoverage =
      surviving > 0 &&
      hegemonyCoverage(state, map, slot) / surviving >= rules.hegemonyTerritoryShare;

    state.hegemonyStreak[slot] = meetsRegions && meetsCoverage ? state.hegemonyStreak[slot] + 1 : 0;

    state.decapitationStreak[slot] = holdsDecapitation(state, map, rules, slot)
      ? state.decapitationStreak[slot] + 1
      : 0;
  }
}

/** Does this slot currently meet the decapitation board condition? */
function holdsDecapitation(
  state: GameState,
  map: GeneratedMap,
  rules: RuleConfig,
  slot: Slot,
): boolean {
  if (map.starts.length < 3) return false;

  const own = map.starts.find((start) => start.slot === slot);
  if (!own) return false;
  if (state.owner[own.capital] !== slot || state.collapsed[own.capital]) return false;

  const live = map.starts.filter((start) => start.slot !== slot && !state.collapsed[start.capital]);
  if (live.length === 0) return false;

  const seized = live.filter((start) => state.owner[start.capital] === slot).length;
  return seized >= Math.floor(live.length * rules.decapitationShare) + 1;
}

/**
 * Ranks every player, best first.
 *
 * Surviving territories, then income, then total armies, then whether they
 * still hold their own capital. Eliminated players sort below the living, in
 * reverse elimination order, so surviving longer always ranks better.
 */
export function rankPlayers(state: GameState, map: GeneratedMap): Slot[] {
  const slots = Array.from({ length: state.playerCount }, (_, slot) => slot);

  // Final tie-break is seeded rather than by slot index: at the turn cap a
  // genuine dead heat would otherwise always be awarded to the lowest seat.
  const tiebreak = slots.map((slot) => seatTiebreak(map.seed, slot));

  return slots.sort((a, b) => {
    const aliveA = state.status[a] === 'active';
    const aliveB = state.status[b] === 'active';
    if (aliveA !== aliveB) return aliveA ? -1 : 1;

    if (!aliveA && !aliveB) {
      const ta = state.eliminatedTurn[a] ?? 0;
      const tb = state.eliminatedTurn[b] ?? 0;
      if (ta !== tb) return tb - ta;
      return a - b;
    }

    const territories = territoryCount(state, b) - territoryCount(state, a);
    if (territories !== 0) return territories;

    const supplied = suppliedCount(state, b) - suppliedCount(state, a);
    if (supplied !== 0) return supplied;

    const armies = totalArmies(state, b) - totalArmies(state, a);
    if (armies !== 0) return armies;

    const holdsA = holdsOwnCapital(state, map, a) ? 1 : 0;
    const holdsB = holdsOwnCapital(state, map, b) ? 1 : 0;
    if (holdsA !== holdsB) return holdsB - holdsA;

    return tiebreak[a] - tiebreak[b];
  });
}

function seatTiebreak(seed: string, slot: Slot): number {
  let h = 2166136261 ^ slot;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function totalArmies(state: GameState, slot: Slot): number {
  let total = 0;
  for (let id = 0; id < state.owner.length; id++) {
    if (state.owner[id] === slot && !state.collapsed[id]) total += state.armies[id];
  }
  return total;
}

function holdsOwnCapital(state: GameState, map: GeneratedMap, slot: Slot): boolean {
  const start = map.starts.find((s) => s.slot === slot);
  if (!start) return false;
  return state.owner[start.capital] === slot && !state.collapsed[start.capital];
}

/** Marks players with nothing left as eliminated. */
export function processEliminations(state: GameState, events: WorldEvent[]): void {
  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] !== 'active') continue;
    if (territoryCount(state, slot) > 0) continue;

    state.status[slot] = 'eliminated';
    state.eliminatedTurn[slot] = state.turn;
    state.capital[slot] = null;

    // A dead player's pact obligations die with them, so a surviving partner's
    // streak cannot be propped up by someone no longer on the board.
    state.pactPartner[slot] = null;
    state.pactStreak[slot] = 0;
    // A dead player's list leaves the guessable pool with them.
    state.tiersLists[slot] = null;
    for (let other = 0; other < state.playerCount; other++) {
      if (state.pactPartner[other] === slot) {
        state.pactPartner[other] = null;
        state.pactStreak[other] = 0;
      }
    }

    events.push({ kind: 'eliminated', slot });
  }
}
