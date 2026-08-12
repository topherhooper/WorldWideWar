/**
 * The JSON API, expressed as a pure function of (store, request).
 *
 * Nothing in here touches a socket. That keeps the whole surface — routing,
 * authorisation, error mapping — testable by calling a function, and leaves
 * `http.ts` with nothing to get wrong beyond parsing bodies and writing bytes.
 */

import {
  GameError,
  cleanName,
  joinGame,
  maybeResolve,
  openSeats,
  resign,
  seatFor,
  startGame,
  submitOrders,
  type GameRecord,
  type Seat,
} from './game.js';
import { parseOrderSet } from './orders.js';
import type { GameStore } from './store.js';
import { buildView, lobbyEntry } from './views.js';

export interface ApiRequest {
  method: string;
  /** Path with the `/api` prefix already stripped, e.g. `/games/abc/orders`. */
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export function handleApi(store: GameStore, request: ApiRequest): ApiResponse {
  try {
    const response = route(store, request);
    // Any request can be the one that completes a turn, and a subscriber should
    // hear about it before the response goes out.
    store.flush();
    return response;
  } catch (error) {
    if (error instanceof GameError) return { status: error.status, body: { error: error.message } };
    const message = error instanceof Error ? error.message : 'unexpected error';
    return { status: 500, body: { error: message } };
  }
}

function route(store: GameStore, request: ApiRequest): ApiResponse {
  const segments = request.path.split('/').filter(Boolean);
  const method = request.method.toUpperCase();

  if (segments[0] !== 'games') throw new GameError('no such endpoint', 404);

  // /games
  if (segments.length === 1) {
    if (method === 'POST') return createGameRoute(store, request);
    if (method === 'GET') return { status: 200, body: { games: openGames(store) } };
    throw new GameError('method not allowed', 405);
  }

  const game = store.find(segments[1]);
  if (!game) throw new GameError('no such game', 404);

  const token = tokenOf(request);
  const seat = seatFor(game, token);
  const isHost = token !== null && token === game.hostToken;
  const resource = segments[2];

  // /games/:id
  if (segments.length === 2) {
    if (method !== 'GET') throw new GameError('method not allowed', 405);
    return view(store, game, seat, isHost);
  }

  if (segments.length !== 3) throw new GameError('no such endpoint', 404);

  switch (resource) {
    case 'map':
      expect(method, 'GET');
      return { status: 200, body: game.map };

    case 'history':
      expect(method, 'GET');
      return { status: 200, body: { reports: game.history } };

    case 'join': {
      expect(method, 'POST');
      // Rejoining with a token you already hold is idempotent, so a refresh
      // during the lobby does not burn a second seat.
      if (seat) return joined(game, seat);
      const joinedSeat = joinGame(game, nameOf(request), store.deps);
      return joined(game, joinedSeat);
    }

    case 'start': {
      expect(method, 'POST');
      if (!isHost) throw new GameError('only the host can start the game', 403);
      startGame(game, store.deps);
      return view(store, game, seat, isHost);
    }

    case 'orders': {
      expect(method, 'POST');
      if (!seat) throw new GameError('you are not seated in this game', 403);
      const body = asRecord(request.body);
      const orders = parseOrderSet(
        body.orders,
        seat.slot,
        game.playerCount,
        game.map.territories.length,
      );
      submitOrders(game, seat, orders, body.locked === true, store.deps);
      return view(store, game, seat, isHost);
    }

    case 'resign': {
      expect(method, 'POST');
      if (!seat) throw new GameError('you are not seated in this game', 403);
      resign(game, seat, store.deps);
      return view(store, game, seat, isHost);
    }

    default:
      throw new GameError('no such endpoint', 404);
  }
}

function createGameRoute(store: GameStore, request: ApiRequest): ApiResponse {
  const body = asRecord(request.body);
  const game = store.create({
    name: cleanName(body.name) ?? 'Host',
    playerCount: body.playerCount as number,
    humanSeats: body.humanSeats as number,
    turnSeconds: body.turnSeconds as number,
    ...(typeof body.seed === 'string' && body.seed.trim() ? { seed: body.seed.trim() } : {}),
    ...(typeof body.difficulty === 'string'
      ? { difficulty: body.difficulty as 'easy' | 'normal' | 'hard' }
      : {}),
  });

  return { status: 201, body: joinedBody(game, game.seats[0]) };
}

function view(store: GameStore, game: GameRecord, seat: Seat | null, isHost: boolean): ApiResponse {
  const now = store.deps.now();
  if (seat) seat.lastSeen = now;
  // A poll is also the cheapest place to notice that a deadline has passed on a
  // server that was otherwise idle.
  maybeResolve(game, store.deps);
  return { status: 200, body: buildView(game, seat, isHost, store.deps.now()) };
}

function joined(game: GameRecord, seat: Seat): ApiResponse {
  return { status: 200, body: joinedBody(game, seat) };
}

function joinedBody(game: GameRecord, seat: Seat): unknown {
  return { gameId: game.id, code: game.code, token: seat.token, slot: seat.slot };
}

function openGames(store: GameStore): unknown[] {
  return store
    .list()
    .filter((game) => game.phase === 'lobby' && openSeats(game) > 0)
    .map(lobbyEntry);
}

function tokenOf(request: ApiRequest): string | null {
  const fromQuery = request.query.get('token');
  if (fromQuery) return fromQuery;
  const body = request.body;
  if (typeof body === 'object' && body !== null) {
    const token = (body as Record<string, unknown>).token;
    if (typeof token === 'string' && token) return token;
  }
  return null;
}

function nameOf(request: ApiRequest): string {
  const body = asRecord(request.body);
  return cleanName(body.name) ?? 'Player';
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function expect(method: string, allowed: string): void {
  if (method.toUpperCase() !== allowed) throw new GameError('method not allowed', 405);
}
