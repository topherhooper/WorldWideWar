/** DTOs shared between the server routes and the web client. */

import type { GameState, GeneratedMap, OrderSet, TurnReport, GameResult } from '@www/engine';

export type GameStatus = 'lobby' | 'active' | 'finished';

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
