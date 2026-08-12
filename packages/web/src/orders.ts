/**
 * The order draft the player is building.
 *
 * Every rule enforced here is enforced again by the engine on submission — this
 * copy exists so the interface can *refuse* an illegal order instead of
 * accepting it and silently downgrading it to HOLD a minute later, which is the
 * difference between a game that explains itself and one that feels arbitrary.
 */

import type {
  Deployment,
  GameState,
  GeneratedMap,
  OrderSet,
  Slot,
  TerritoryId,
  UnitOrder,
} from '@www/engine';

/** The engine's sentinel for an army count hidden by fog. */
export const HIDDEN = -1;

export class OrderDraft {
  readonly orders: OrderSet;

  constructor(
    private readonly state: GameState,
    private readonly map: GeneratedMap,
    readonly slot: Slot,
    initial: OrderSet | null,
  ) {
    this.orders = {
      slot,
      pledge: initial?.pledge ?? null,
      deploys: initial?.deploys?.map((deploy) => ({ ...deploy })) ?? [],
      units: initial?.units?.map((unit) => ({ ...unit })) ?? [],
    };
  }

  // ── Territory facts ────────────────────────────────────────────────────────

  name(id: TerritoryId): string {
    return this.map.territories[id]?.name ?? `#${id}`;
  }

  owns(id: TerritoryId): boolean {
    return this.state.owner[id] === this.slot && !this.state.collapsed[id];
  }

  supplied(id: TerritoryId): boolean {
    return this.state.supplied[id];
  }

  neighbours(id: TerritoryId): TerritoryId[] {
    return (this.map.adjacency[id] ?? []).filter((next) => !this.state.collapsed[next]);
  }

  /** Armies standing there once this turn's deployments land. */
  garrison(id: TerritoryId): number {
    const base = this.state.armies[id];
    if (base === HIDDEN) return HIDDEN;
    return base + this.deployAt(id);
  }

  // ── The pledge ─────────────────────────────────────────────────────────────

  get pledge(): Slot | null {
    return this.orders.pledge;
  }

  setPledge(slot: Slot | null): void {
    this.orders.pledge = slot === this.slot ? null : slot;
  }

  // ── Deployments ────────────────────────────────────────────────────────────

  canDeployTo(id: TerritoryId): boolean {
    return this.owns(id) && this.supplied(id);
  }

  deployAt(id: TerritoryId): number {
    return this.orders.deploys.find((deploy) => deploy.to === id)?.count ?? 0;
  }

  deployedTotal(): number {
    return this.orders.deploys.reduce((sum, deploy) => sum + deploy.count, 0);
  }

  income(): number {
    return this.state.income[this.slot];
  }

  remaining(): number {
    return Math.max(0, this.income() - this.deployedTotal());
  }

  setDeploy(id: TerritoryId, count: number): void {
    if (!this.canDeployTo(id)) return;
    const others = this.deployedTotal() - this.deployAt(id);
    const capped = Math.max(0, Math.min(count, this.income() - others));

    const deploys: Deployment[] = this.orders.deploys.filter((deploy) => deploy.to !== id);
    if (capped > 0) deploys.push({ to: id, count: capped });
    deploys.sort((a, b) => a.to - b.to);
    this.orders.deploys = deploys;
  }

  adjustDeploy(id: TerritoryId, delta: number): void {
    this.setDeploy(id, this.deployAt(id) + delta);
  }

  // ── Unit orders ────────────────────────────────────────────────────────────

  orderFrom(id: TerritoryId): UnitOrder | null {
    return this.orders.units.find((unit) => unit.from === id) ?? null;
  }

  clearOrder(id: TerritoryId): void {
    this.orders.units = this.orders.units.filter((unit) => unit.from !== id);
  }

  hold(id: TerritoryId): void {
    if (!this.owns(id)) return;
    this.clearOrder(id);
    this.orders.units.push({ kind: 'HOLD', from: id });
  }

  /** Armies available to march out of a territory this turn. */
  maxMove(from: TerritoryId): number {
    const garrison = this.garrison(from);
    return garrison === HIDDEN ? 0 : garrison;
  }

  canMove(from: TerritoryId, to: TerritoryId): boolean {
    return this.owns(from) && this.neighbours(from).includes(to) && this.maxMove(from) > 0;
  }

  move(from: TerritoryId, to: TerritoryId, count?: number): void {
    if (!this.canMove(from, to)) return;
    const most = this.maxMove(from);
    const amount = Math.max(1, Math.min(count ?? most, most));
    this.clearOrder(from);
    this.orders.units.push({ kind: 'MOVE', from, to, count: amount });
  }

  /** Rewrites the count of an existing move, clamped to what is there. */
  setMoveCount(from: TerritoryId, count: number): void {
    const order = this.orderFrom(from);
    if (!order || order.kind !== 'MOVE') return;
    order.count = Math.max(1, Math.min(count, this.maxMove(from)));
  }

  canSupport(from: TerritoryId, target: TerritoryId): boolean {
    return this.owns(from) && this.neighbours(from).includes(target);
  }

  support(from: TerritoryId, target: TerritoryId, forPlayer: Slot): void {
    if (!this.canSupport(from, target)) return;
    this.clearOrder(from);
    this.orders.units.push({ kind: 'SUPPORT', from, target, forPlayer });
  }

  /**
   * Who it makes sense to support at a territory: whoever holds it, plus every
   * living player, since a support can back an attacker who has not moved yet.
   */
  supportCandidates(target: TerritoryId): Slot[] {
    const owner = this.state.owner[target];
    const out: Slot[] = [];
    if (owner !== null && this.state.status[owner] === 'active') out.push(owner);
    for (let slot = 0; slot < this.state.playerCount; slot++) {
      if (this.state.status[slot] !== 'active' || out.includes(slot)) continue;
      out.push(slot);
    }
    return out;
  }

  // ── Bulk helpers ───────────────────────────────────────────────────────────

  clear(): void {
    this.orders.deploys = [];
    this.orders.units = [];
  }

  /** Territories the player holds, in map order. */
  holdings(): TerritoryId[] {
    const out: TerritoryId[] = [];
    for (let id = 0; id < this.state.owner.length; id++) {
      if (this.owns(id)) out.push(id);
    }
    return out;
  }

  describe(order: UnitOrder): string {
    if (order.kind === 'HOLD') return `${this.name(order.from)} holds`;
    if (order.kind === 'MOVE') {
      return `${this.name(order.from)} → ${this.name(order.to)} (${order.count})`;
    }
    return `${this.name(order.from)} supports ${this.name(order.target)}`;
  }
}
