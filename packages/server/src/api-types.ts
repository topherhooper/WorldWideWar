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

export type GameStatus = 'lobby' | 'active' | 'finished';

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
  status: GameStatus;
  playerCount: number;
  seatsFilled: number;
  turn: number;
  deadlineAt: string | null;
  mySlot: number | null;
  myLocked: boolean;
}

export interface GameView {
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

export interface CreateGameRequest {
  playerCount: number;
  turnMinutes: number;
  /** Which social contest runs; defaults to 'pact'. */
  contest?: ContestKind;
  /** Game length in turns; defaults to 25. */
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
