import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameView } from '@www/server/api-types';
import type { OrderSet } from '@www/engine';

import { api, ApiError } from './api.js';

const IDLE_MS = 15_000;
const LOCKED_MS = 5_000;

export interface UseGame {
  view: GameView | null;
  error: string | null;
  refresh: () => Promise<GameView | null>;
  /** Persists a draft; returns server warnings. Optimistic UI lives in the caller's draft state. */
  saveOrders: (orders: OrderSet, locked: boolean) => Promise<string[]>;
}

export function useGame(id: string): UseGame {
  const [view, setView] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const viewRef = useRef<GameView | null>(null);
  const viewJsonRef = useRef<string | null>(null);

  // Skips the state update (and the full map re-render) when a poll returns
  // an identical view — the common case for an async game.
  const install = useCallback((fresh: GameView) => {
    const json = JSON.stringify(fresh);
    if (json !== viewJsonRef.current) {
      viewJsonRef.current = json;
      viewRef.current = fresh;
      setView(fresh);
    }
    setError(null);
  }, []);

  const refresh = useCallback(async (): Promise<GameView | null> => {
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
      const wait = v !== null && v.myLocked && v.status === 'active' ? LOCKED_MS : IDLE_MS;
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
