import type {
  AnyGameView,
  CreateGameRequest,
  Dependent,
  GameSummaryView,
  GameView,
  NotifyPrefs,
  PartyGameView,
  SacreGameView,
  SubmitOrdersRequest,
  SubmitOrdersResponse,
  UpdateConfigRequest,
  UpdatePartyConfigRequest,
  UpdateSacreConfigRequest,
  UpdatePrefsRequest,
} from '@www/server/api-types';
import type { PartyAction } from '@www/engine/party';
import type { SacreAction } from '@www/engine/sacre';

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
  // One read for both games; the response is discriminated on `kind`.
  getGame: (id: string) => apiFetch<AnyGameView>('GET', `/api/games/${id}`),
  join: (id: string) => apiFetch<GameView>('POST', `/api/games/${id}/join`),
  start: (id: string) => apiFetch<GameView>('POST', `/api/games/${id}/start`),
  updateConfig: (id: string, req: UpdateConfigRequest) =>
    apiFetch<GameView>('POST', `/api/games/${id}/config`, req),
  resolveNow: (id: string) => apiFetch<GameView>('POST', `/api/games/${id}/resolve`),
  submitOrders: (id: string, req: SubmitOrdersRequest) =>
    apiFetch<SubmitOrdersResponse>('PUT', `/api/games/${id}/orders`, req),
  submitLobbyList: (id: string, list: string[]) =>
    apiFetch<GameView>('PUT', `/api/games/${id}/lobby-list`, { list }),
  deleteGame: (id: string) => apiFetch<{ ok: boolean }>('DELETE', `/api/games/${id}`),
  takePartySeat: (id: string, dependents: Dependent[]) =>
    apiFetch<PartyGameView>('POST', `/api/games/${id}/party/seat`, { dependents }),
  dropPartySeat: (id: string, slot: number) =>
    apiFetch<PartyGameView>('DELETE', `/api/games/${id}/party/seat/${slot}`),
  updatePartyConfig: (id: string, req: UpdatePartyConfigRequest) =>
    apiFetch<PartyGameView>('POST', `/api/games/${id}/party/config`, req),
  /** Deal, bell, meet, confirm, deny, sniff, nominate and vote all come here. */
  partyAct: (id: string, action: PartyAction) =>
    apiFetch<PartyGameView>('POST', `/api/games/${id}/party/act`, { action }),
  takeSacreSeat: (id: string) => apiFetch<SacreGameView>('POST', `/api/games/${id}/cards/seat`),
  updateSacreConfig: (id: string, req: UpdateSacreConfigRequest) =>
    apiFetch<SacreGameView>('POST', `/api/games/${id}/cards/config`, req),
  /** Deal, score, advertise, cycle, return, exchange, respond and pass. */
  sacreAct: (id: string, action: SacreAction) =>
    apiFetch<SacreGameView>('POST', `/api/games/${id}/cards/act`, { action }),
  getPrefs: () => apiFetch<NotifyPrefs>('GET', '/api/prefs'),
  updatePrefs: (patch: UpdatePrefsRequest) => apiFetch<NotifyPrefs>('PUT', '/api/prefs', patch),
};
