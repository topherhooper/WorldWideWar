/**
 * Parsing an order set that arrived over the network.
 *
 * The engine already treats an illegal order as a silent downgrade to HOLD, so
 * nothing here is load-bearing for correctness. What it is load-bearing for is
 * *shape*: this is the boundary where arbitrary JSON stops being arbitrary, and
 * where a submission cannot become a hundred thousand entries the server then
 * keeps in memory until the deadline.
 */

import type { Deployment, OrderSet, Slot, UnitOrder } from '@www/engine';

export function parseOrderSet(
  raw: unknown,
  slot: Slot,
  playerCount: number,
  territoryCount: number,
): OrderSet {
  const source = isRecord(raw) ? raw : {};

  return {
    slot,
    pledge: parsePledge(source.pledge, slot, playerCount),
    deploys: parseDeploys(source.deploys, territoryCount),
    units: parseUnits(source.units, playerCount, territoryCount),
  };
}

function parsePledge(raw: unknown, slot: Slot, playerCount: number): Slot | null {
  if (!Number.isInteger(raw)) return null;
  const pledge = raw as number;
  if (pledge === slot || pledge < 0 || pledge >= playerCount) return null;
  return pledge;
}

function parseDeploys(raw: unknown, territoryCount: number): Deployment[] {
  if (!Array.isArray(raw)) return [];
  const out: Deployment[] = [];

  for (const entry of raw.slice(0, territoryCount)) {
    if (!isRecord(entry)) continue;
    const to = territory(entry.to, territoryCount);
    const count = positiveCount(entry.count);
    if (to === null || count === null) continue;
    out.push({ to, count });
  }

  return out;
}

function parseUnits(raw: unknown, playerCount: number, territoryCount: number): UnitOrder[] {
  if (!Array.isArray(raw)) return [];
  const out: UnitOrder[] = [];

  for (const entry of raw.slice(0, territoryCount)) {
    if (!isRecord(entry)) continue;
    const from = territory(entry.from, territoryCount);
    if (from === null) continue;

    if (entry.kind === 'HOLD') {
      out.push({ kind: 'HOLD', from });
      continue;
    }

    if (entry.kind === 'MOVE') {
      const to = territory(entry.to, territoryCount);
      const count = positiveCount(entry.count);
      if (to === null || count === null) continue;
      out.push({ kind: 'MOVE', from, to, count });
      continue;
    }

    if (entry.kind === 'SUPPORT') {
      const target = territory(entry.target, territoryCount);
      const forPlayer = entry.forPlayer;
      if (target === null) continue;
      if (!Number.isInteger(forPlayer)) continue;
      if ((forPlayer as number) < 0 || (forPlayer as number) >= playerCount) continue;
      out.push({ kind: 'SUPPORT', from, target, forPlayer: forPlayer as Slot });
    }
  }

  return out;
}

function territory(raw: unknown, territoryCount: number): number | null {
  if (!Number.isInteger(raw)) return null;
  const id = raw as number;
  return id >= 0 && id < territoryCount ? id : null;
}

/** Counts are capped well above any legal army stack, purely to bound memory. */
function positiveCount(raw: unknown): number | null {
  if (!Number.isInteger(raw)) return null;
  const count = raw as number;
  return count > 0 && count <= 1_000_000 ? count : null;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null;
}
