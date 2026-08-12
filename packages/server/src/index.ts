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
export {
  FileArchive,
  fromSnapshot,
  nullArchive,
  SNAPSHOT_FORMAT,
  toSnapshot,
  type GameArchive,
  type GameSnapshot,
} from './archive.js';
export {
  bucketFor,
  DEFAULT_LIMITS,
  RateLimiter,
  type Bucket,
  type RateLimits,
  type RateRule,
} from './limits.js';
export { defaultDeps, GameStore, GAME_TTL_MS, MAX_GAMES } from './store.js';
export { buildView, lobbyEntry } from './views.js';
export { handleApi, SEAT_TOKEN_HEADER, type ApiRequest, type ApiResponse } from './api.js';
export { createServer, type RunningServer, type ServerOptions } from './http.js';
