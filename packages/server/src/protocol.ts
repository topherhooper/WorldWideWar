/**
 * The wire contract between server and browser.
 *
 * The client imports these as types only, so there is exactly one definition of
 * what a player receives and the compiler checks both ends of the socket
 * against it.
 */

import type {
  GameResult,
  GameState,
  OrderSet,
  PlayerStatus,
  RuleConfig,
  Slot,
  TerritoryId,
  TurnReport,
} from '@www/engine';

export type GamePhase = 'lobby' | 'active' | 'finished';
export type SeatKind = 'human' | 'bot';

/** Public per-seat summary. Everything here is knowable by every player. */
export interface PlayerView {
  slot: Slot;
  name: string;
  kind: SeatKind;
  status: PlayerStatus;
  /** Seat has locked orders for the current turn. */
  ready: boolean;
  /** Human seat that has never been claimed — still open to join. */
  open: boolean;
  /** Bot personality tags; empty for humans. */
  tags: string[];
  territories: number;
  /** Total armies, or null when fog hides them from the viewer. */
  armies: number | null;
  income: number;
  pactsHonored: number;
  pactsBroken: number;
  /** Current mutual-concord streak, with `partner`. */
  streak: number;
  partner: Slot | null;
}

export interface SelfView {
  slot: Slot;
  name: string;
  isHost: boolean;
}

export interface GameView {
  id: string;
  code: string;
  phase: GamePhase;
  turn: number;
  playerCount: number;
  seed: string;
  turnSeconds: number;
  /** Epoch ms the turn resolves, or null in the lobby. */
  deadline: number | null;
  /** So a client can render a countdown without trusting its own clock. */
  serverTime: number;
  /** Bumped on every change; the client refetches when it moves. */
  version: number;
  rules: RuleConfig;
  you: SelfView | null;
  players: PlayerView[];
  /** Redacted for the viewer. Null while the game is still in the lobby. */
  state: GameState | null;
  /** The viewer's own working orders, kept server-side between sessions. */
  draft: OrderSet | null;
  /** Whether that draft is locked in. */
  locked: boolean;
  /** Report for the turn that just resolved, or null before the first one. */
  report: TurnReport | null;
  /** Army counts are hidden this turn. */
  fog: boolean;
  /** Territories the storm takes at the end of the next turn. */
  warned: TerritoryId[];
  /**
   * Blurbs for the global events, so the client can name what just happened
   * without keeping its own copy of the engine's prose.
   */
  eventDescriptions: Record<string, string>;
  result: GameResult | null;
}

/** A row in the public lobby list. */
export interface LobbyEntry {
  id: string;
  code: string;
  phase: GamePhase;
  playerCount: number;
  openSeats: number;
  turnSeconds: number;
  turn: number;
  createdAt: number;
}

export interface CreateGameRequest {
  name: string;
  playerCount: number;
  /** Seats reserved for humans; the rest are filled by bots at start. */
  humanSeats: number;
  turnSeconds: number;
  seed?: string;
  difficulty?: 'easy' | 'normal' | 'hard';
}

export interface JoinResponse {
  gameId: string;
  code: string;
  token: string;
  slot: Slot;
}

export interface ApiError {
  error: string;
}
