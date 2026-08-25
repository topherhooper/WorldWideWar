/** Core domain types: the map, game state, orders, and the turn report. */

/** A player's seat, 0..playerCount-1. Also the index of their map wedge. */
export type Slot = number;
export type TerritoryId = number;
export type RegionId = number;

// ─── Map ─────────────────────────────────────────────────────────────────────

export type EdgeKind = 'land' | 'sea';

export interface Territory {
  id: TerritoryId;
  name: string;
  regionId: RegionId;
  /** Integer-quantized, so the frozen map snapshot is exactly reproducible. */
  centroid: [number, number];
  polygon: [number, number][];
  /** Which storm collapse wave removes this territory. -1 = never. */
  wave: number;
}

export interface MapEdge {
  a: TerritoryId;
  b: TerritoryId;
  kind: EdgeKind;
}

export interface Region {
  id: RegionId;
  name: string;
  /** Computed from size and external border count, never hand-authored. */
  bonus: number;
  hue: number;
  territoryIds: TerritoryId[];
}

export interface StartingPosition {
  slot: Slot;
  capital: TerritoryId;
  extra: TerritoryId[];
}

export interface GeneratedMap {
  formatVersion: 1;
  seed: string;
  playerCount: number;
  /** World radius in the same integer units as centroids and polygons. */
  radius: number;
  territories: Territory[];
  edges: MapEdge[];
  regions: Region[];
  starts: StartingPosition[];
  neutralGarrisons: Record<TerritoryId, number>;
  /** Territory ids removed by each successive storm wave, outermost first. */
  collapseWaves: TerritoryId[][];
  /** Adjacency lists, derived from `edges` and cached for the hot loops. */
  adjacency: TerritoryId[][];
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export type UnitOrder =
  | { kind: 'HOLD'; from: TerritoryId }
  | { kind: 'MOVE'; from: TerritoryId; to: TerritoryId; count: number }
  | { kind: 'SUPPORT'; from: TerritoryId; target: TerritoryId; forPlayer: Slot };

export interface Deployment {
  to: TerritoryId;
  count: number;
}

/** One reordering of a rival's published items, submitted blind with orders. */
export interface TiersGuess {
  target: Slot;
  /** order[t] = public position (0–5) of the item placed at tier t (0=A … 5=F). */
  order: number[];
}

export interface TiersOrders {
  /** Six free-text entries in the author's chosen A→F order. */
  list: string[];
  /** Up to two rivals' lists, reordered as the guesser believes they wrote them. */
  guesses: TiersGuess[];
}

export interface OrderSet {
  slot: Slot;
  /** The pact pledge: another living slot, or null to abstain. */
  pledge: Slot | null;
  /** Tiers contest input; absent in pact games. */
  tiers?: TiersOrders;
  deploys: Deployment[];
  units: UnitOrder[];
}

// ─── Pact ────────────────────────────────────────────────────────────────────

export type PactOutcome =
  /** Mutual pledge, neither attacked the other. */
  | 'concord'
  /** Mutual pledge; you attacked them and they did not attack you. */
  | 'betrayal'
  /** Mutual pledge; they attacked you and you did not attack them. */
  | 'betrayed'
  /** Mutual pledge; both attacked. */
  | 'mutual_treachery'
  /** You pledged someone who pledged elsewhere. */
  | 'spurned'
  /** Someone pledged you, but you pledged elsewhere. */
  | 'courted'
  | 'abstain';

export interface PactResult {
  slot: Slot;
  pledged: Slot | null;
  outcome: PactOutcome;
  /** Combat multiplier, stored ×100 to keep resolution in integer math. */
  multiplier: number;
  /** Consecutive turns of unbroken mutual concord with `partner`. */
  streak: number;
  partner: Slot | null;
}

// ─── Tiers ───────────────────────────────────────────────────────────────────

/**
 * A published tier list. `items` holds the six entries in the author's true
 * A→F order and is a secret; what the table sees is the shuffled presentation:
 * `shuffle[p]` is the author index (= true tier) of the item shown at public
 * position `p`. Redaction rewrites rival lists into public order with an
 * identity shuffle, so the true ordering never leaves the server.
 */
export interface TiersList {
  items: string[];
  shuffle: number[];
}

export interface TiersGuessResult {
  guesser: Slot;
  target: Slot;
  /** 0–12: exact tier = 2 per item, one tier off = 1. */
  score: number;
}

export interface TiersResult {
  slot: Slot;
  /** The list this player wrote last turn, revealed in true A→F order. */
  revealed: string[] | null;
  /** Guesses this player made this turn, scored. */
  guesses: TiersGuessResult[];
  /** The best guess made against this player's list. */
  bestRead: TiersGuessResult | null;
  /** Combat multiplier, ×100. */
  multiplier: number;
  /** Armies granted (or forfeited) next turn; 0 in multiplier games. */
  incomeDelta: number;
}

// ─── Game state ──────────────────────────────────────────────────────────────

export type PlayerStatus = 'active' | 'eliminated' | 'resigned';

export type VictoryKind =
  /** Last player standing. */
  | 'conquest'
  /** Holds a decisive share of the surviving map. */
  | 'domination'
  /** Holds a third of surviving regions outright, two turns running. */
  | 'hegemony'
  /** Holds their own founding capital and most of everyone else's. */
  | 'decapitation'
  /** Two players, unbroken mutual concord, jointly dominant. */
  | 'condominium'
  /** Three players bound pairwise by recent concord, none having betrayed. */
  | 'concordat'
  /** Nobody closed it out; standings decide. */
  | 'turn_cap'
  /** Cooperative: the coalition outlasted the storm. Winners are the survivors. */
  | 'survival'
  /** Cooperative: the world took everyone. Nobody wins. */
  | 'extinction';

export interface GameResult {
  kind: VictoryKind;
  /** One slot, or two or three for a shared victory. */
  winners: Slot[];
  /** Final ranking, best first. */
  standings: Slot[];
  /** Human-readable reason, for the report headline. */
  detail?: string;
}

/**
 * The complete game state. Flat, id-indexed arrays throughout: cheap to clone,
 * cheap to hash canonically, and free of iteration-order ambiguity.
 */
export interface GameState {
  turn: number;
  playerCount: number;

  // Per territory
  owner: (Slot | null)[];
  armies: number[];
  /** Removed by the storm. Collapsed territories are out of the game. */
  collapsed: boolean[];
  /** Connected to the owner's capital through their own territory. Derived. */
  supplied: boolean[];

  // Per slot
  status: PlayerStatus[];
  capital: (TerritoryId | null)[];
  /** Reinforcements available to deploy this turn. */
  income: number[];
  eliminatedTurn: (number | null)[];

  // Pact bookkeeping — public, and the basis of the reputation system.
  pactsHonored: number[];
  pactsBroken: number[];
  /** `betrayedBy[victim][betrayer]` — how many times each slot was betrayed. */
  betrayedBy: number[][];
  /** Current mutual-concord partner per slot, or null. */
  pactPartner: (Slot | null)[];
  /** Length of the current unbroken concord streak with `pactPartner`. */
  pactStreak: number[];
  /**
   * `concordAt[a][b]` — the last turn on which a and b were in mutual concord,
   * or -1. A pact streak only tracks your *current* partner, but a three-way
   * concordat needs to know that all three pairs cooperated recently, which
   * cannot be expressed by one partner slot each.
   */
  concordAt: number[][];
  /** Consecutive turns holding enough whole regions to claim hegemony. */
  hegemonyStreak: number[];
  /** Consecutive turns holding enough rival capitals to claim decapitation. */
  decapitationStreak: number[];

  // Tiers bookkeeping — the list each slot wrote last turn, guessable this turn.
  // All null in pact games.
  tiersLists: (TiersList | null)[];

  // World
  /** Event applying this turn, announced at the end of the previous one. */
  activeEvent: string | null;
  /** Event announced now, applying next turn. */
  pendingEvent: string | null;
  /** Events already drawn, so the deck never repeats within a game. */
  usedEvents: string[];
  /** Army counts are hidden from everyone until this turn. */
  fogUntilTurn: number;
  /** Storm waves already collapsed. */
  wavesCollapsed: number;
  /** Bonus income granted next turn, by slot (e.g. from being Courted). */
  pendingBonusIncome: number[];

  result: GameResult | null;
}

// ─── Turn report ─────────────────────────────────────────────────────────────

export interface BattleSideReport {
  slot: Slot | null;
  /** Raw armies committed. */
  armies: number;
  /** After supports, capital bonus and the support-defence penalty. */
  effective: number;
  multiplier: number;
  roll: number;
  power: number;
  isDefender: boolean;
}

export interface BattleReport {
  territory: TerritoryId;
  sides: BattleSideReport[];
  winner: Slot | null;
  /** Casualties taken by the winner. */
  casualties: number;
  previousOwner: Slot | null;
  captured: boolean;
  salience: number;
}

export interface ClashReport {
  a: TerritoryId;
  b: TerritoryId;
  slotA: Slot;
  slotB: Slot;
  powerA: number;
  powerB: number;
  winner: Slot;
  salience: number;
}

export type WorldEvent =
  | { kind: 'storm'; wave: number; territories: TerritoryId[]; armiesLost: number }
  | { kind: 'storm_warning'; wave: number; territories: TerritoryId[] }
  | { kind: 'global_event'; id: string; applied: true }
  | { kind: 'event_announced'; id: string }
  | { kind: 'eliminated'; slot: Slot }
  | { kind: 'capital_fell'; slot: Slot; from: TerritoryId; to: TerritoryId | null }
  | { kind: 'routed'; slot: Slot; at: TerritoryId; lost: number }
  | { kind: 'order_rejected'; slot: Slot; reason: string }
  | { kind: 'game_over'; result: GameResult };

/** Territory captured this turn converted to next-turn income. */
export interface PlunderReport {
  slot: Slot;
  /** Every territory taken, even past the paying cap. */
  captures: number;
  income: number;
}

export interface TurnReport {
  turn: number;
  headline: string;
  /** Pact outcomes lead the report; betrayals are the emotional peak. */
  pacts: PactResult[];
  /** Tiers outcomes; empty in pact games. */
  tiers: TiersResult[];
  /** Topic of the lists revealed this turn; null in pact games. */
  revealedTopic: string | null;
  clashes: ClashReport[];
  battles: BattleReport[];
  /** Uncontested moves, collapsed to a count so the log stays readable. */
  quietMoves: number;
  /** Expansion pays: capture income granted this turn; empty when plunder is off. */
  plunder: PlunderReport[];
  world: WorldEvent[];
  result: GameResult | null;
}

// ─── Resolution context ──────────────────────────────────────────────────────

/** Which social contest drives combat multipliers. */
export type ContestKind = 'pact' | 'tiers';

/**
 * How tiers scores land on the game.
 *
 * `pooled` is the cooperative payout: every read scored this turn — including
 * those made by eliminated players — sums into one coalition pool that is then
 * split among the living. Reading your allies well is how the coalition pays
 * for the war.
 */
export type TiersPayout = 'multiplier' | 'income' | 'pooled';

export interface RuleConfig {
  /** Which social contest drives combat multipliers. */
  contest: ContestKind;
  turnCap: number;
  /** Fraction of surviving territories needed for a solo domination win. */
  dominationShare: number;
  /** Fraction needed for a two-player condominium win. Deliberately higher. */
  condominiumShare: number;
  /** Consecutive concord turns required to qualify for a condominium. */
  condominiumStreak: number;
  /** Share of surviving *regions* held outright for a hegemony win. */
  hegemonyShare: number;
  /** Whole regions required regardless of share, so the bar cannot collapse. */
  hegemonyMinimum: number;
  /** Regions that must still exist for a hegemony claim to be available. */
  hegemonyMinRegionsAlive: number;
  /** Share of surviving territory those whole regions must actually cover. */
  hegemonyTerritoryShare: number;
  /** Consecutive turns that share must be held. */
  hegemonyStreak: number;
  /** Share of rivals' founding capitals needed for a decapitation win. */
  decapitationShare: number;
  /** Consecutive turns those capitals must be held. */
  decapitationStreak: number;
  /** How recently all three pairs must have cooperated for a concordat. */
  concordatWindow: number;
  /** Share of surviving territory a concordat trio must jointly hold. */
  concordatShare: number;
  /** Turn the first storm wave collapses. */
  stormFirstWave: number;
  /** Turns between storm waves. */
  stormInterval: number;
  /** Global events fire every N turns. */
  eventInterval: number;
  /** The war economy ramps: +1 income every N turns, for everyone. */
  warEconomyInterval: number;
  /** Neutral garrisons grow every N turns; 0 disables growth. */
  neutralGrowthInterval: number;
  /** Added to each mapgen neutral garrison at setup, floored at 1. */
  neutralGarrisonDelta: number;
  /** Bonus income next turn per territory captured this turn; 0 disables plunder. */
  plunderIncome: number;
  /** Most captures that pay plunder in one turn. */
  plunderCap: number;
  /** Whether tiers scores set a combat multiplier (v1), pay income (v2), or pool (co-op). */
  tiersPayout: TiersPayout;
  /**
   * Cooperative mode: there are no rivals, only the world. Elimination stops
   * ending a player's participation in the contest, the solo and shared victory
   * routes are switched off, and the game resolves to `survival` or
   * `extinction` when the storm has finished.
   */
  coop: boolean;
  /**
   * Armies the storm drives onto surviving land bordering a fresh collapse.
   * 0 disables raiders, which is what every competitive game gets.
   */
  stormRaiders: number;
}

export interface ResolveContext {
  seed: string;
  map: GeneratedMap;
  rules: RuleConfig;
}
