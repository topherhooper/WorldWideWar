/**
 * Talking to the server, and remembering who you are.
 *
 * A seat is a secret token rather than an account, so "logging in" is nothing
 * more than holding the token a join handed you. It lives in localStorage keyed
 * by game code, which is what makes a refresh — or a link opened tomorrow —
 * drop you back into the same seat.
 */

import type { GeneratedMap, OrderSet } from '@www/engine';
import type { CreateGameRequest, GameView, JoinResponse, LobbyEntry } from '@www/server';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Where a seat token travels on a request that has no body to carry it. */
const SEAT_TOKEN_HEADER = 'x-seat-token';

interface Options {
  method?: string;
  body?: unknown;
  /** Sent as a header, never as a query parameter — see `session` below. */
  token?: string | null;
}

async function request<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers[SEAT_TOKEN_HEADER] = options.token;

  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const raw = await response.text();
  const body: unknown = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return body as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body });
}

export const api = {
  lobbies: (): Promise<LobbyEntry[]> =>
    request<{ games: LobbyEntry[] }>('/games').then((body) => body.games),

  create: (options: CreateGameRequest): Promise<JoinResponse> => post('/games', options),

  join: (code: string, name: string, token: string | null): Promise<JoinResponse> =>
    post(`/games/${encodeURIComponent(code)}/join`, { name, token }),

  view: (code: string, token: string | null): Promise<GameView> =>
    request(`/games/${encodeURIComponent(code)}`, { token }),

  map: (code: string): Promise<GeneratedMap> => request(`/games/${encodeURIComponent(code)}/map`),

  start: (code: string, token: string): Promise<GameView> =>
    post(`/games/${encodeURIComponent(code)}/start`, { token }),

  orders: (code: string, token: string, orders: OrderSet, locked: boolean): Promise<GameView> =>
    post(`/games/${encodeURIComponent(code)}/orders`, { token, orders, locked }),

  resign: (code: string, token: string): Promise<GameView> =>
    post(`/games/${encodeURIComponent(code)}/resign`, { token }),
};

// ─── Local identity ──────────────────────────────────────────────────────────

const NAME_KEY = 'www:name';
const SEAT_PREFIX = 'www:seat:';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private browsing, or storage disabled. A seat that cannot be remembered
    // still works for as long as the tab is open.
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Nothing to do: play continues, it just will not survive a refresh.
  }
}

export const session = {
  name: (): string => read(NAME_KEY) ?? '',
  setName: (name: string): void => write(NAME_KEY, name),
  tokenFor: (code: string): string | null => read(SEAT_PREFIX + code.toUpperCase()),
  remember: (code: string, token: string): void => write(SEAT_PREFIX + code.toUpperCase(), token),
  forget: (code: string): void => write(SEAT_PREFIX + code.toUpperCase(), null),
};
