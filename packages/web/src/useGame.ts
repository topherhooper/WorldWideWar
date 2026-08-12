import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameView } from '@www/server/api-types';
import type { OrderSet } from '@www/engine';

import { api, ApiError } from './api.js';

const IDLE_MS = 15_000;
const LOCKED_MS = 5_000;

export interface UseGame {
  view: GameView | null;
  error: string | null;
  refresh: () => Promise<void>;
  /** Optimistic: myOrders update locally at once; returns server warnings. */
  saveOrders: (orders: OrderSet, locked: boolean) => Promise<string[]>;
}

export function useGame(id: string): UseGame {
  const [view, setView] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const refresh = useCallback(async (): Promise<GameView | null> => {
    try {
      const fresh = await api.getGame(id);
      setView(fresh);
      setError(null);
      return fresh;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'network error');
      return viewRef.current;
    }
  }, [id]);

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
      setView((v) => (v === null ? v : { ...v, myOrders: orders, myLocked: locked }));
      try {
        const res = await api.submitOrders(id, { orders, locked });
        setView(res.view);
        setError(null);
        return res.warnings;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'network error');
        await refresh();
        return [];
      }
    },
    [id, refresh],
  );

  return { view, error, refresh, saveOrders };
}
