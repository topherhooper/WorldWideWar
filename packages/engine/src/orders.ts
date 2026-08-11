/**
 * Order normalisation and validation.
 *
 * Runs per player, independently, against the frozen pre-turn snapshot. An
 * illegal order is never an exception — it is silently downgraded to HOLD and
 * recorded as a rejection in the report. A turn must always resolve: throwing
 * because one player submitted nonsense would stall a table of twelve.
 */

import type {
  Deployment,
  GameState,
  GeneratedMap,
  OrderSet,
  Slot,
  TerritoryId,
  WorldEvent,
} from './types.js';

export interface NormalizedMove {
  player: Slot;
  from: TerritoryId;
  to: TerritoryId;
  count: number;
  /** Into a territory this player does not own. */
  hostile: boolean;
}

export interface NormalizedSupport {
  player: Slot;
  from: TerritoryId;
  target: TerritoryId;
  forPlayer: Slot;
  /** Severed by a hostile move onto the supporting territory. */
  cut: boolean;
  /** The named player is not actually a contender at the target. */
  discarded: boolean;
}

export interface NormalizedOrders {
  slot: Slot;
  pledge: Slot | null;
  deploys: Deployment[];
  moves: NormalizedMove[];
  supports: NormalizedSupport[];
}

export function emptyOrders(slot: Slot): OrderSet {
  return { slot, pledge: null, deploys: [], units: [] };
}

export function normalizeOrders(
  state: GameState,
  map: GeneratedMap,
  slot: Slot,
  raw: OrderSet | null,
  events: WorldEvent[],
): NormalizedOrders {
  const reject = (reason: string): void => {
    events.push({ kind: 'order_rejected', slot, reason });
  };

  const normalized: NormalizedOrders = {
    slot,
    pledge: raw?.pledge ?? null,
    deploys: [],
    moves: [],
    supports: [],
  };
  if (!raw) return normalized;

  const owns = (id: TerritoryId): boolean =>
    Number.isInteger(id) &&
    id >= 0 &&
    id < state.owner.length &&
    state.owner[id] === slot &&
    !state.collapsed[id];

  const adjacent = (from: TerritoryId, to: TerritoryId): boolean =>
    map.adjacency[from]?.includes(to) ?? false;

  // ── Deployments ────────────────────────────────────────────────────────────
  // Sorted by territory and truncated to available income, so an over-spend
  // becomes a partial deploy rather than a rejected turn.
  let budget = state.income[slot];
  const deploysByTerritory = new Map<TerritoryId, number>();

  for (const deploy of [...raw.deploys].sort((a, b) => a.to - b.to)) {
    if (!owns(deploy.to)) {
      reject(`cannot deploy to territory ${deploy.to}: not held`);
      continue;
    }
    if (!state.supplied[deploy.to]) {
      reject(`cannot deploy to territory ${deploy.to}: out of supply`);
      continue;
    }
    if (!Number.isInteger(deploy.count) || deploy.count <= 0) {
      reject(`invalid deploy count for territory ${deploy.to}`);
      continue;
    }
    const amount = Math.min(deploy.count, budget);
    if (amount <= 0) {
      reject('deployments exceed available reinforcements');
      continue;
    }
    budget -= amount;
    deploysByTerritory.set(deploy.to, (deploysByTerritory.get(deploy.to) ?? 0) + amount);
  }

  normalized.deploys = [...deploysByTerritory.entries()]
    .map(([to, count]) => ({ to, count }))
    .sort((a, b) => a.to - b.to);

  // ── Unit orders ────────────────────────────────────────────────────────────
  // One order per territory. A second order for the same territory is dropped
  // rather than overriding, so a duplicate cannot depend on submission order.
  const claimed = new Set<TerritoryId>();

  for (const order of [...raw.units].sort(byUnitOrder)) {
    if (!owns(order.from)) {
      reject(`no order possible from territory ${order.from}: not held`);
      continue;
    }
    if (claimed.has(order.from)) {
      reject(`duplicate order for territory ${order.from}`);
      continue;
    }

    if (order.kind === 'HOLD') {
      claimed.add(order.from);
      continue;
    }

    if (order.kind === 'MOVE') {
      if (!adjacent(order.from, order.to)) {
        reject(`cannot move ${order.from} to ${order.to}: not adjacent`);
        continue;
      }
      if (state.collapsed[order.to]) {
        reject(`cannot move into territory ${order.to}: lost to the storm`);
        continue;
      }
      if (!Number.isInteger(order.count) || order.count <= 0) {
        reject(`invalid army count moving from ${order.from}`);
        continue;
      }
      claimed.add(order.from);
      normalized.moves.push({
        player: slot,
        from: order.from,
        to: order.to,
        count: order.count,
        hostile: state.owner[order.to] !== slot,
      });
      continue;
    }

    // SUPPORT
    if (!adjacent(order.from, order.target)) {
      reject(`cannot support ${order.target} from ${order.from}: not adjacent`);
      continue;
    }
    if (state.collapsed[order.target]) {
      reject(`cannot support territory ${order.target}: lost to the storm`);
      continue;
    }
    if (
      !Number.isInteger(order.forPlayer) ||
      order.forPlayer < 0 ||
      order.forPlayer >= state.playerCount
    ) {
      reject(`invalid player named in support from ${order.from}`);
      continue;
    }
    claimed.add(order.from);
    normalized.supports.push({
      player: slot,
      from: order.from,
      target: order.target,
      forPlayer: order.forPlayer,
      cut: false,
      discarded: false,
    });
  }

  // Move counts are clamped against garrisons after deployments land, in the
  // resolution pipeline — a territory's strength is not known until then.
  normalized.moves.sort((a, b) => a.from - b.from);
  normalized.supports.sort((a, b) => a.from - b.from);

  return normalized;
}

function byUnitOrder(a: OrderSet['units'][number], b: OrderSet['units'][number]): number {
  if (a.from !== b.from) return a.from - b.from;
  return orderRank(a.kind) - orderRank(b.kind);
}

function orderRank(kind: 'HOLD' | 'MOVE' | 'SUPPORT'): number {
  return kind === 'MOVE' ? 0 : kind === 'SUPPORT' ? 1 : 2;
}

/** `attacked[a][b]` — did slot a order an attack on slot b? Drives the pact. */
export function buildAttackMatrix(
  state: GameState,
  orders: readonly NormalizedOrders[],
): boolean[][] {
  const matrix = Array.from({ length: state.playerCount }, () =>
    new Array<boolean>(state.playerCount).fill(false),
  );

  for (const set of orders) {
    for (const move of set.moves) {
      const target = state.owner[move.to];
      if (target === null || target === set.slot) continue;
      matrix[set.slot][target] = true;
    }
  }

  return matrix;
}
