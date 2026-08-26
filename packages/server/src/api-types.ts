/** DTOs shared between the server routes and the web client. */

import type {
  ContestKind,
  GameState,
  GeneratedMap,
  OrderSet,
  RuleConfig,
  TurnReport,
  GameResult,
} from '@www/engine';
import type { PartyAction, PartyMode, PartyView } from '@www/engine/party';
import type { SacreAction, SacreView } from '@www/engine/sacre';

import type { Dependent } from './store.js';

export type { Dependent };

export type GameStatus = 'lobby' | 'active' | 'finished';

/**
 * Which game this is. Absent means war, because every document written before
 * the party existed lacks it — and because a stale web bundle sends no kind.
 *
 * The party deliberately does *not* add a fourth `GameStatus`. A dealt-but-not-
 * begun party is `status: 'active'` with `phase: 'invited'` and no deadline: a
 * status is a wire value that a cached bundle would render as "Turn 0", and two
 * enums that can disagree about the same game are worse than one.
 */
export type GameKind = 'war' | 'party' | 'cards';

/** Which emails a player wants. Every kind defaults to on. */
export type NotifyKind = 'turnResolved' | 'gameOver' | 'reminder';

export type NotifyPrefs = Record<NotifyKind, boolean>;

export type UpdatePrefsRequest = Partial<NotifyPrefs>;

export interface SeatView {
  slot: number;
  name: string;
  isBot: boolean;
  taken: boolean;
}

export interface GameSummaryView {
  id: string;
  kind: GameKind;
  status: GameStatus;
  playerCount: number;
  seatsFilled: number;
  turn: number;
  deadlineAt: string | null;
  mySlot: number | null;
  myLocked: boolean;
}

export interface WarGameView {
  kind: 'war';
  id: string;
  status: GameStatus;
  playerCount: number;
  seats: SeatView[];
  turn: number;
  deadlineAt: string | null;
  turnMinutes: number;
  contest: ContestKind;
  turnCap: number;
  /**
   * The rules this game actually resolves with — frozen into the doc at
   * creation. Clients must display these, never recompute via rulesFor(),
   * which drifts as balance tuning changes.
   */
  rules: RuleConfig;
  /** Null on games created before presets existed. */
  presetId: string | null;
  presetName: string;
  /** Topic for the list being written now (lobby list in lobby); null in pact games. */
  tiersTopic: string | null;
  /** Seats that have submitted their lobby list; [] outside a tiers lobby. */
  lobbyListSlots: number[];
  map: GeneratedMap;
  /** Redacted for the viewer; null while in lobby. */
  state: GameState | null;
  mySlot: number | null;
  myOrders: OrderSet | null;
  myLocked: boolean;
  lockedSlots: number[];
  latestReport: TurnReport | null;
  result: GameResult | null;
}

export interface PartySeatView {
  slot: number;
  name: string;
  taken: boolean;
  isHost: boolean;
  /** Guests on this seat with no account of their own. */
  dependents: Dependent[];
}

export interface PartyGameView {
  kind: 'party';
  id: string;
  status: GameStatus;
  tale: 'sleeping-beauty';
  seats: PartySeatView[];
  maxSeats: number;
  mySlot: number | null;
  isHost: boolean;
  /**
   * ISO, mirroring the party state's `phaseEndsAt`. A remaining-milliseconds
   * field would change on every poll and defeat the client's change detection,
   * so the client counts down itself.
   */
  phaseEndsAt: string | null;
  /** Redacted for the viewer. Never null — a lobby has a view too. */
  party: PartyView;
  /** Why the last action was turned away, if it was. */
  note: string | null;
}

export interface SacreSeatView {
  slot: number;
  name: string;
  taken: boolean;
  isHost: boolean;
}

export interface SacreGameView {
  kind: 'cards';
  id: string;
  status: GameStatus;
  seats: SacreSeatView[];
  maxSeats: number;
  mySlot: number | null;
  isHost: boolean;
  /** ISO, mirroring the state's `phaseEndsAt`; the client counts down itself. */
  phaseEndsAt: string | null;
  /** Redacted for the viewer. Never null -- a lobby has a view too. */
  game: SacreView;
  /** Why the last action was turned away, if it was. */
  note: string | null;
}

/** Discriminated on `kind`, so no game can ever be read as another. */
export type AnyGameView = WarGameView | PartyGameView | SacreGameView;

export interface SacreActionRequest {
  action: SacreAction;
}

export interface UpdateSacreConfigRequest {
  turnSeconds?: number;
}

export interface TakePartySeatRequest {
  /** Everyone arriving on this seat without a Google account of their own. */
  dependents?: Dependent[];
}

export interface PartyActionRequest {
  action: PartyAction;
}

export interface UpdatePartyConfigRequest {
  roundMinutes?: number;
  voteSeconds?: number;
  candles?: number;
}

export interface CreateGameRequest {
  /** Absent means war, which is what a web bundle cached across a deploy sends. */
  kind?: GameKind;
  /** Party only. Absent means the hunt; `together` is the family-sized tale. */
  mode?: PartyMode;
  /** One of the engine's PRESETS ids; the preset is immutable after creation. */
  presetId?: string;
  /**
   * Pre-preset clients sent a contest instead. Optional only so a web bundle
   * cached across a deploy can still create a game — new clients send presetId.
   */
  contest?: ContestKind;
  /** Cards only. How many seats the table has; 2-7, defaulting to 4. */
  players?: number;
}

export interface UpdateConfigRequest {
  playerCount?: number;
  turnMinutes?: number;
  turnCap?: number;
}

export interface SubmitLobbyListRequest {
  list: string[];
}

export interface SubmitOrdersRequest {
  orders: OrderSet;
  locked: boolean;
}

export interface SubmitOrdersResponse {
  warnings: string[];
  resolved: boolean;
  view: GameView;
}

/**
 * The war view under its old name, so the many web components that predate the
 * party keep compiling unchanged. New code should say which it means.
 */
export type GameView = WarGameView;
