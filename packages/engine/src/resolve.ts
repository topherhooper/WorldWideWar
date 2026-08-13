/**
 * Turn resolution.
 *
 * `resolveTurn` is a pure function of (state, orders, context): no clock, no
 * I/O, no ambient randomness. That is what makes replays exact, lets a crashed
 * resolution simply be re-run to bit-identical output, and allows the browser to
 * run this same code to preview orders.
 *
 * Simultaneity is mechanical rather than a matter of care: the side-building and
 * battle phases read *only* the frozen pre-turn snapshot, and nothing is written
 * until every battle has been decided. Shuffling the input orders array must
 * therefore produce byte-identical output — the property test that asserts this
 * is the most important one in the repository.
 *
 * The other structural decision is that **a move does not require its
 * destination to be vacated**. That single rule removes Diplomacy-style
 * dependency chains entirely: move chains slide forward naturally, cycles rotate
 * cleanly, and there is no cycle-detection code anywhere in this file. Exactly
 * one case is genuinely non-local — two stacks swapping territories — and it
 * gets its own pass before the per-territory battles, which are then fully
 * independent of one another.
 */

import { CAPITAL_DEFENCE_BONUS } from './constants.js';
import { applyPactRecord, resolvePacts } from './contest/pact.js';
import { applyTiersRecord, resolveTiers } from './contest/tiers.js';
import { topicForTurn } from './contest/topics.js';
import { computePower, retreatSurvivors, splitProportionally, winnerCasualties } from './combat.js';
import {
  applyEventEffects,
  attackerPenalty,
  drawEvent,
  mobilizationBonus,
  type GlobalEventId,
} from './events.js';
import { recomputeIncome } from './income.js';
import { buildAttackMatrix, normalizeOrders, type NormalizedOrders } from './orders.js';
import { substream } from './rng.js';
import { cloneState } from './setup.js';
import { relocateCapital, recomputeSupply } from './supply.js';
import { applyStorm, warnedTerritories } from './storm.js';
import type {
  BattleReport,
  BattleSideReport,
  ClashReport,
  GameState,
  GeneratedMap,
  OrderSet,
  PactResult,
  PlunderReport,
  ResolveContext,
  RuleConfig,
  Slot,
  TerritoryId,
  TiersResult,
  TurnReport,
  WorldEvent,
} from './types.js';
import { checkVictory, processEliminations, updateVictoryStreaks } from './victory.js';

export interface ResolveResult {
  next: GameState;
  report: TurnReport;
}

interface Side {
  slot: Slot | null;
  armies: number;
  stationary: number;
  incoming: { from: TerritoryId; count: number }[];
  isDefender: boolean;
  effective: number;
  multiplier: number;
  roll: number;
  power: number;
}

interface Returning {
  src: TerritoryId;
  player: Slot;
  count: number;
}

export function resolveTurn(
  state: GameState,
  submissions: readonly (OrderSet | null)[],
  context: ResolveContext,
): ResolveResult {
  const { map, rules, seed } = context;
  const rngCombat = substream(seed, state.turn, 'combat');
  const rngTie = substream(seed, state.turn, 'tiebreak');
  const rngEvents = substream(seed, state.turn, 'events');

  const world: WorldEvent[] = [];

  // ── Phase 1 — normalise and validate, per player, independently ───────────
  const orders: NormalizedOrders[] = [];
  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] !== 'active') {
      orders.push({ slot, pledge: null, deploys: [], moves: [], supports: [], tiers: null });
      continue;
    }
    orders.push(normalizeOrders(state, map, slot, submissions[slot] ?? null, world));
  }

  // ── Phase 2 — deployments ────────────────────────────────────────────────
  const garrison = state.armies.slice();
  for (const set of orders) {
    for (const deploy of set.deploys) garrison[deploy.to] += deploy.count;
  }

  // ── Phase 3 — clamp move counts against post-deploy garrisons ────────────
  // Clamping happens before the pact is scored so that a move which turns out
  // to be impossible cannot register as a betrayal the player never made.
  for (const set of orders) {
    const surviving: typeof set.moves = [];
    for (const move of set.moves) {
      const available = garrison[move.from];
      if (available <= 0) continue;
      move.count = Math.min(move.count, available);
      if (move.count > 0) surviving.push(move);
    }
    set.moves = surviving;
  }

  // ── Phase 4 — the social contest ─────────────────────────────────────────
  const attacked = buildAttackMatrix(state, orders);
  const aliveSlots: Slot[] = [];
  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] === 'active') aliveSlots.push(slot);
  }
  const contestContext = { attacked, aliveSlots };
  const tiersInputs = orders.map((set) => set.tiers);
  const pact =
    rules.contest === 'tiers'
      ? null
      : resolvePacts(
          state,
          orders.map((set) => set.pledge),
          contestContext,
        );
  const tiers = rules.contest === 'tiers' ? resolveTiers(state, tiersInputs, contestContext) : null;
  // Whichever contest ran, this is the multiplier/bonus surface the battles use.
  const contest = (pact ?? tiers)!;

  // ── Phase 5 — support cuts ───────────────────────────────────────────────
  const hostileSources = new Map<TerritoryId, TerritoryId[]>();
  for (const set of orders) {
    for (const move of set.moves) {
      if (!move.hostile) continue;
      const list = hostileSources.get(move.to);
      if (list) list.push(move.from);
      else hostileSources.set(move.to, [move.from]);
    }
  }

  for (const set of orders) {
    for (const support of set.supports) {
      // A support is severed by any hostile move onto the supporting territory
      // — except one coming from the very territory being supported into, the
      // classic exception that stops a defender cutting its own attacker's aid.
      const cutters = (hostileSources.get(support.from) ?? []).filter(
        (src) => src !== support.target,
      );
      if (cutters.length > 0) support.cut = true;
    }
  }

  // ── Phase 6 — build sides (reads the frozen snapshot only) ───────────────
  const outgoing = new Map<TerritoryId, { count: number }>();
  const supportOrderAt = new Set<TerritoryId>();
  for (const set of orders) {
    for (const move of set.moves) outgoing.set(move.from, { count: move.count });
    for (const support of set.supports) supportOrderAt.add(support.from);
  }

  const sides = new Map<TerritoryId, Map<Slot | null, Side>>();
  const ensureSide = (territory: TerritoryId, slot: Slot | null): Side => {
    let table = sides.get(territory);
    if (!table) {
      table = new Map();
      sides.set(territory, table);
    }
    let side = table.get(slot);
    if (!side) {
      side = {
        slot,
        armies: 0,
        stationary: 0,
        incoming: [],
        isDefender: false,
        effective: 0,
        multiplier: 100,
        roll: 0,
        power: 0,
      };
      table.set(slot, side);
    }
    return side;
  };

  for (let id = 0; id < state.owner.length; id++) {
    if (state.collapsed[id]) continue;
    const owner = state.owner[id];
    const left = outgoing.get(id)?.count ?? 0;
    const stationary = garrison[id] - left;
    if (owner === null && stationary <= 0) continue;
    if (stationary <= 0 && owner !== null) {
      // Fully evacuated: the owner keeps the land but has nothing standing on
      // it. This is the single best chaos generator in the game — evacuate a
      // province a moment before it is attacked and it changes hands for free.
      continue;
    }
    const side = ensureSide(id, owner);
    side.armies += stationary;
    side.stationary += stationary;
    side.isDefender = true;
  }

  for (const set of orders) {
    for (const move of set.moves) {
      const side = ensureSide(move.to, move.player);
      side.armies += move.count;
      side.incoming.push({ from: move.from, count: move.count });
    }
  }

  // ── Phase 7 — head-on clashes: the only non-local case ───────────────────
  const returning: Returning[] = [];
  const clashes: ClashReport[] = [];
  const moveByFrom = new Map<TerritoryId, { player: Slot; to: TerritoryId; count: number }>();
  for (const set of orders) {
    for (const move of set.moves) {
      moveByFrom.set(move.from, { player: move.player, to: move.to, count: move.count });
    }
  }

  const clashed = new Set<TerritoryId>();
  const clashPairs: [TerritoryId, TerritoryId][] = [];
  for (const [from, move] of [...moveByFrom.entries()].sort((a, b) => a[0] - b[0])) {
    if (clashed.has(from)) continue;
    const counter = moveByFrom.get(move.to);
    if (!counter || counter.to !== from) continue;
    if (counter.player === move.player) continue;
    clashed.add(from);
    clashed.add(move.to);
    clashPairs.push([from, move.to]);
  }

  for (const [a, b] of clashPairs) {
    const moveA = moveByFrom.get(a)!;
    const moveB = moveByFrom.get(b)!;

    const effA = moveA.count + supportStrength(orders, b, moveA.player, garrison);
    const effB = moveB.count + supportStrength(orders, a, moveB.player, garrison);
    const rollA = rngCombat.d6();
    const rollB = rngCombat.d6();
    const powerA = computePower(effA, contest.multiplier[moveA.player], rollA);
    const powerB = computePower(effB, contest.multiplier[moveB.player], rollB);

    const aWins = powerA !== powerB ? powerA > powerB : rngTie.bool();
    const winner = aWins ? moveA : moveB;
    const loser = aWins ? moveB : moveA;
    const winnerFrom = aWins ? a : b;
    const loserFrom = aWins ? b : a;
    const loserEffective = aWins ? effB : effA;

    // Both stacks bounce home; no territory changes hands in a field clash.
    returning.push({
      src: winnerFrom,
      player: winner.player,
      count: winner.count - winnerCasualties(winner.count, loserEffective),
    });
    returning.push({
      src: loserFrom,
      player: loser.player,
      count: retreatSurvivors(loser.count),
    });

    removeIncoming(sides, moveA.to, moveA.player, a);
    removeIncoming(sides, moveB.to, moveB.player, b);

    clashes.push({
      a,
      b,
      slotA: moveA.player,
      slotB: moveB.player,
      powerA,
      powerB,
      winner: winner.player,
      salience: (effA + effB) * 2,
    });
  }

  // ── Phase 8 — effective strengths, then independent battles ──────────────
  for (const [territory, table] of sides) {
    for (const side of table.values()) {
      let effective = side.armies;

      if (side.isDefender && side.slot !== null) {
        if (state.capital[side.slot] === territory && side.stationary >= 1) {
          effective += CAPITAL_DEFENCE_BONUS;
        }
        // A territory that issued a support has its garrison facing outward, so
        // it defends at half. Support is a real trade, not a free bonus.
        if (supportOrderAt.has(territory)) effective = Math.ceil(effective / 2);
      }

      if (side.slot !== null) {
        effective += supportStrength(orders, territory, side.slot, garrison);
      }

      side.effective = Math.max(0, effective);
      side.multiplier =
        side.slot === null
          ? 100
          : Math.max(1, contest.multiplier[side.slot] - attackerPenalty(state, side.isDefender));
    }
  }

  const outcome = new Map<TerritoryId, { owner: Slot | null; armies: number }>();
  const battles: BattleReport[] = [];
  let quietMoves = 0;

  for (let id = 0; id < state.owner.length; id++) {
    if (state.collapsed[id]) continue;
    const table = sides.get(id);

    if (!table || table.size === 0) {
      outcome.set(id, { owner: state.owner[id], armies: 0 });
      continue;
    }

    const contenders = [...table.values()]
      .filter((side) => side.armies > 0)
      .sort((x, y) => slotOrder(x.slot) - slotOrder(y.slot));

    if (contenders.length === 0) {
      outcome.set(id, { owner: state.owner[id], armies: 0 });
      continue;
    }

    if (contenders.length === 1) {
      const only = contenders[0];
      outcome.set(id, { owner: only.slot, armies: only.armies });
      if (only.slot !== state.owner[id]) {
        battles.push(bloodlessCapture(id, state.owner[id], only));
      } else if (only.incoming.length > 0) {
        quietMoves += only.incoming.length;
      }
      continue;
    }

    for (const side of contenders) {
      side.roll = rngCombat.d6();
      side.power = computePower(side.effective, side.multiplier, side.roll);
    }

    let best = -1;
    let tied: Side[] = [];
    for (const side of contenders) {
      if (side.power > best) {
        best = side.power;
        tied = [side];
      } else if (side.power === best) {
        tied.push(side);
      }
    }

    // Ties go to the defender; failing that, a seeded flip.
    const winner = tied.find((side) => side.isDefender) ?? tied[rngTie.int(tied.length)];
    const losers = contenders.filter((side) => side !== winner);
    const losingEffective = losers.reduce((sum, side) => sum + side.effective, 0);
    const casualties = winnerCasualties(winner.armies, losingEffective);

    for (const loser of losers) {
      // Stationary defenders are wiped along with the territory; only stacks
      // that were moving have anywhere to fall back to.
      const committed = loser.incoming.reduce((sum, part) => sum + part.count, 0);
      const survivors = retreatSurvivors(committed);
      if (survivors <= 0 || loser.slot === null) continue;
      const split = splitProportionally(
        survivors,
        loser.incoming.map((part) => part.count),
      );
      loser.incoming.forEach((part, index) => {
        if (split[index] > 0) {
          returning.push({ src: part.from, player: loser.slot as Slot, count: split[index] });
        }
      });
    }

    outcome.set(id, { owner: winner.slot, armies: winner.armies - casualties });
    battles.push({
      territory: id,
      sides: contenders.map(toSideReport),
      winner: winner.slot,
      casualties,
      previousOwner: state.owner[id],
      captured: winner.slot !== state.owner[id],
      salience: salienceOf(state, id, contenders, winner.slot !== state.owner[id]),
    });
  }

  // ── Phase 9 — apply, then land returning stacks ──────────────────────────
  const next = cloneState(state);
  for (const [id, result] of outcome) {
    next.owner[id] = result.owner;
    next.armies[id] = Math.max(0, result.armies);
  }

  for (const item of [...returning].sort((x, y) => x.src - y.src || x.player - y.player)) {
    if (item.count <= 0) continue;
    if (next.owner[item.src] === item.player && !next.collapsed[item.src]) {
      next.armies[item.src] += item.count;
    } else {
      // Cut off with nowhere to fall back to. Brutal, but it is what makes
      // overextension cost something and keeps games short.
      world.push({ kind: 'routed', slot: item.player, at: item.src, lost: item.count });
    }
  }

  if (pact !== null) applyPactRecord(next, pact.results);
  if (tiers !== null) applyTiersRecord(next, tiersInputs, seed, state.turn);
  for (let slot = 0; slot < next.playerCount; slot++) {
    next.pendingBonusIncome[slot] += contest.bonusIncome[slot];
  }

  // Expansion pays immediately: each captured territory converts to income,
  // up to the per-turn cap. Counted before the storm so armies spent on a
  // province the storm then eats were still not spent for nothing.
  const plunder: PlunderReport[] = [];
  if (rules.plunderIncome > 0) {
    const captures = new Array<number>(state.playerCount).fill(0);
    for (let id = 0; id < next.owner.length; id++) {
      const owner = next.owner[id];
      if (owner !== null && owner !== state.owner[id]) captures[owner]++;
    }
    for (let slot = 0; slot < state.playerCount; slot++) {
      if (captures[slot] === 0) continue;
      const income = Math.min(captures[slot], rules.plunderCap) * rules.plunderIncome;
      next.pendingBonusIncome[slot] += income;
      plunder.push({ slot, captures: captures[slot], income });
    }
  }

  // ── Phase 10 — world tick ────────────────────────────────────────────────
  next.turn = state.turn + 1;

  applyStorm(next, map, rules, world);
  relocateFallenCapitals(next, map, world);
  recomputeSupply(next, map);
  growNeutrals(next, rules);
  processEliminations(next, world);

  // The event for the coming turn was announced last tick; draw the one after
  // so players always write orders knowing what is in force next.
  next.activeEvent = next.pendingEvent;
  next.pendingEvent = null;
  if ((next.turn + 1) % rules.eventInterval === 0) {
    const drawn = drawEvent(next, rngEvents);
    if (drawn) {
      next.pendingEvent = drawn;
      next.usedEvents.push(drawn);
      world.push({ kind: 'event_announced', id: drawn });
    }
  }
  applyEventEffects(next, map, next.activeEvent as GlobalEventId | null, rngEvents, world);

  for (let slot = 0; slot < next.playerCount; slot++) {
    next.pendingBonusIncome[slot] += mobilizationBonus(next);
  }
  recomputeIncome(next, map, rules);

  const warned = warnedTerritories(map, next.turn, rules);
  if (warned.length > 0) {
    world.push({
      kind: 'storm_warning',
      wave: next.wavesCollapsed,
      territories: [...warned],
    });
  }

  // Streaks must reflect the board as it now stands, before victory is judged.
  updateVictoryStreaks(next, map, rules);

  const result = checkVictory(next, map, rules);
  if (result) {
    next.result = result;
    world.push({ kind: 'game_over', result });
  }

  const report: TurnReport = {
    turn: state.turn,
    headline: buildHeadline(
      state.turn,
      pact?.results ?? [],
      tiers?.results ?? [],
      battles,
      clashes,
      world,
    ),
    pacts: pact?.results ?? [],
    tiers: tiers?.results ?? [],
    revealedTopic: tiers === null ? null : topicForTurn(seed, state.turn - 1).title,
    clashes: clashes.sort((x, y) => y.salience - x.salience),
    battles: battles.sort((x, y) => y.salience - x.salience || x.territory - y.territory),
    plunder,
    quietMoves,
    world,
    result,
  };

  return { next, report };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slotOrder(slot: Slot | null): number {
  return slot === null ? -1 : slot;
}

function supportStrength(
  orders: readonly NormalizedOrders[],
  territory: TerritoryId,
  forPlayer: Slot,
  garrison: readonly number[],
): number {
  let total = 0;
  for (const set of orders) {
    for (const support of set.supports) {
      if (support.target !== territory) continue;
      if (support.forPlayer !== forPlayer) continue;
      if (support.cut || support.discarded) continue;
      // Supporting armies contribute half and take no casualties — the cost was
      // already paid by defending at half back home.
      total += Math.ceil(garrison[support.from] / 2);
    }
  }
  return total;
}

function removeIncoming(
  sides: Map<TerritoryId, Map<Slot | null, Side>>,
  territory: TerritoryId,
  player: Slot,
  from: TerritoryId,
): void {
  const side = sides.get(territory)?.get(player);
  if (!side) return;
  const index = side.incoming.findIndex((part) => part.from === from);
  if (index === -1) return;
  side.armies -= side.incoming[index].count;
  side.incoming.splice(index, 1);
  if (side.armies <= 0 && side.stationary <= 0) sides.get(territory)!.delete(player);
}

function toSideReport(side: Side): BattleSideReport {
  return {
    slot: side.slot,
    armies: side.armies,
    effective: side.effective,
    multiplier: side.multiplier,
    roll: side.roll,
    power: side.power,
    isDefender: side.isDefender,
  };
}

function bloodlessCapture(
  territory: TerritoryId,
  previousOwner: Slot | null,
  side: Side,
): BattleReport {
  return {
    territory,
    sides: [toSideReport(side)],
    winner: side.slot,
    casualties: 0,
    previousOwner,
    captured: true,
    salience: 20 + side.armies,
  };
}

function salienceOf(
  state: GameState,
  territory: TerritoryId,
  sides: readonly Side[],
  captured: boolean,
): number {
  const armies = sides.reduce((sum, side) => sum + side.armies, 0);
  let score = armies * 2 + sides.length * 3;
  if (captured) score += 25;
  if (state.capital.includes(territory)) score += 40;
  return score;
}

function relocateFallenCapitals(state: GameState, map: GeneratedMap, world: WorldEvent[]): void {
  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] !== 'active') continue;
    const capital = state.capital[slot];
    if (capital !== null && state.owner[capital] === slot && !state.collapsed[capital]) continue;

    const replacement = relocateCapital(state, map, slot);
    state.capital[slot] = replacement;
    if (capital !== null) {
      world.push({ kind: 'capital_fell', slot, from: capital, to: replacement });
    }
  }
}

/** Unclaimed land does not stay cheap: neutral garrisons grow on a schedule. */
function growNeutrals(state: GameState, rules: RuleConfig): void {
  if (rules.neutralGrowthInterval <= 0) return;
  if (state.turn % rules.neutralGrowthInterval !== 0) return;
  for (let id = 0; id < state.owner.length; id++) {
    if (state.collapsed[id] || state.owner[id] !== null) continue;
    state.armies[id]++;
  }
}

function buildHeadline(
  turn: number,
  pacts: readonly PactResult[],
  tiersResults: readonly TiersResult[],
  battles: readonly BattleReport[],
  clashes: readonly ClashReport[],
  world: readonly WorldEvent[],
): string {
  const over = world.find((event) => event.kind === 'game_over');
  if (over && over.kind === 'game_over') {
    const { winners, detail } = over.result;
    const because = detail ? ` — ${detail}` : '';
    if (winners.length === 0) return `Turn ${turn} — the world burns with nobody left to hold it`;
    if (winners.length === 1)
      return `Turn ${turn} — player ${winners[0]} takes the world${because}`;
    const names =
      winners.length === 2
        ? `players ${winners[0]} and ${winners[1]}`
        : `players ${winners.slice(0, -1).join(', ')} and ${winners[winners.length - 1]}`;
    return `Turn ${turn} — ${names} divide the world${because}`;
  }

  // Betrayals always lead: they are the emotional peak of the turn and they
  // explain every multiplier the battles just used.
  const betrayal = pacts.find((pact) => pact.outcome === 'betrayal');
  if (betrayal && betrayal.pledged !== null) {
    return `Turn ${turn} — player ${betrayal.slot} broke faith with player ${betrayal.pledged}`;
  }

  // The best read of the turn is the tiers analogue of a betrayal headline.
  const reads = tiersResults
    .flatMap((result) => (result.bestRead === null ? [] : [result.bestRead]))
    .sort((a, b) => b.score - a.score || a.guesser - b.guesser);
  if (reads.length > 0 && reads[0].score >= 10) {
    return `Turn ${turn} — player ${reads[0].guesser} read player ${reads[0].target} like a book`;
  }

  const captured = battles.filter((battle) => battle.captured).length;
  const fights = battles.filter((battle) => battle.sides.length > 1).length + clashes.length;

  if (fights === 0) return `Turn ${turn} — an uneasy quiet`;
  return `Turn ${turn} — ${fights} ${fights === 1 ? 'battle' : 'battles'}, ${captured} ${
    captured === 1 ? 'territory' : 'territories'
  } changed hands`;
}
