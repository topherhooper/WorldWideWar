/** Public surface of the game server. */

export * from './protocol.js';
export {
  BOT_TURN_DELAY_MS,
  createGame,
  GameError,
  joinGame,
  lobbyFull,
  maybeResolve,
  MAX_TURN_SECONDS,
  MIN_TURN_SECONDS,
  openSeats,
  pendingSeats,
  resign,
  resolveNow,
  seatFor,
  startGame,
  submitOrders,
  type GameDeps,
  type GameRecord,
  type Seat,
} from './game.js';
export { parseOrderSet } from './orders.js';
export { defaultDeps, GameStore, GAME_TTL_MS } from './store.js';
export { buildView, lobbyEntry } from './views.js';
export { handleApi, type ApiRequest, type ApiResponse } from './api.js';
export { createServer, type RunningServer, type ServerOptions } from './http.js';
