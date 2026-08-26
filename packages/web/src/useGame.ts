import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnyGameView } from '@www/server/api-types';
import type { OrderSet } from '@www/engine';

import { api, ApiError } from './api.js';

const IDLE_MS = 15_000;
const LOCKED_MS = 5_000;
/** A mingle is live: twenty people are confirming encounters in one room. */
const PARTY_LIVE_MS = 2_500;
/** An invitation sits open for days. Polling it every two seconds is the bill. */
const PARTY_IDLE_MS = 60_000;

/**
 * How often to ask again. A war turn moves on a deadline measured in hours; a
 * party round moves whenever somebody in the room presses something.
 */
export function pollIntervalFor(view: AnyGameView | null): number {
  if (view === null) return IDLE_MS;
  if (view.kind === 'party') {
    if (view.status === 'finished') return PARTY_IDLE_MS;
    return view.party.phase === 'mingle' || view.party.phase === 'vote'
      ? PARTY_LIVE_MS
      : PARTY_IDLE_MS;
  }
  // A card table is live while a turn is running: somebody is choosing, or
  // everybody owes an answer, and both want the same 2.5s the party's floor
  // gets. A lobby or a finished game does not.
  if (view.kind === 'cards') {
    return view.game.phase === 'playing' ? PARTY_LIVE_MS : PARTY_IDLE_MS;
  }
  return view.myLocked && view.status === 'active' ? LOCKED_MS : IDLE_MS;
}

export interface UseGame {
  view: AnyGameView | null;
  error: string | null;
  refresh: () => Promise<AnyGameView | null>;
  /** Persists a draft; returns server warnings. Optimistic UI lives in the caller's draft state. */
  saveOrders: (orders: OrderSet, locked: boolean) => Promise<string[]>;
}

export function useGame(id: string): UseGame {
  const [view, setView] = useState<AnyGameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const viewRef = useRef<AnyGameView | null>(null);
  const viewJsonRef = useRef<string | null>(null);

  // Skips the state update (and the full map re-render) when a poll returns
  // an identical view — the common case for an async game.
  const install = useCallback((fresh: AnyGameView) => {
    const json = JSON.stringify(fresh);
    if (json !== viewJsonRef.current) {
      viewJsonRef.current = json;
      viewRef.current = fresh;
      setView(fresh);
    }
    setError(null);
  }, []);

  const refresh = useCallback(async (): Promise<AnyGameView | null> => {
    try {
      install(await api.getGame(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'network error');
    }
    return viewRef.current;
  }, [id, install]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      const v = document.hidden ? viewRef.current : await refresh();
      const wait = pollIntervalFor(v);
      timer = setTimeout(() => void tick(), wait);
    };
    void tick();

    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const saveOrders = useCallback(
    async (orders: OrderSet, locked: boolean): Promise<string[]> => {
      try {
        const res = await api.submitOrders(id, { orders, locked });
        install(res.view);
        return res.warnings;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'network error');
        await refresh();
        return [];
      }
    },
    [id, install, refresh],
  );

  return { view, error, refresh, saveOrders };
}
