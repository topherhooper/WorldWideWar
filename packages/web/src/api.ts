import type {
  CreateGameRequest,
  GameSummaryView,
  GameView,
  NotifyPrefs,
  SubmitOrdersRequest,
  SubmitOrdersResponse,
  UpdatePrefsRequest,
} from '@www/server/api-types';

import { auth } from './auth.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function apiFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (user === null) throw new ApiError(401, 'not signed in');
  const token = await user.getIdToken();

  const res = await fetch(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  createGame: (req: CreateGameRequest) => apiFetch<{ id: string }>('POST', '/api/games', req),
  listGames: () => apiFetch<GameSummaryView[]>('GET', '/api/games'),
  getGame: (id: string) => apiFetch<GameView>('GET', `/api/games/${id}`),
  join: (id: string) => apiFetch<GameView>('POST', `/api/games/${id}/join`),
  start: (id: string) => apiFetch<GameView>('POST', `/api/games/${id}/start`),
  resolveNow: (id: string) => apiFetch<GameView>('POST', `/api/games/${id}/resolve`),
  submitOrders: (id: string, req: SubmitOrdersRequest) =>
    apiFetch<SubmitOrdersResponse>('PUT', `/api/games/${id}/orders`, req),
  submitLobbyList: (id: string, list: string[]) =>
    apiFetch<GameView>('PUT', `/api/games/${id}/lobby-list`, { list }),
  deleteGame: (id: string) => apiFetch<{ ok: boolean }>('DELETE', `/api/games/${id}`),
  getPrefs: () => apiFetch<NotifyPrefs>('GET', '/api/prefs'),
  updatePrefs: (patch: UpdatePrefsRequest) => apiFetch<NotifyPrefs>('PUT', '/api/prefs', patch),
};
