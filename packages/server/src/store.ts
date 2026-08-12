/**
 * In-memory table of live games, plus the heartbeat that fires turn deadlines.
 *
 * Deliberately not a database. Everything a game needs to be rebuilt is its
 * seed and its order history, so persistence is a change of storage rather than
 * a change of design — and until there is a reason to keep games across a
 * restart, a Map is the honest implementation.
 */

import { randomUUID } from 'node:crypto';
import { createGame, maybeResolve, type GameDeps, type GameRecord, GameError } from './game.js';
import type { CreateGameRequest } from './protocol.js';

export const defaultDeps: GameDeps = {
  now: () => Date.now(),
  uid: () => randomUUID().replace(/-/g, ''),
};

/** Games untouched for this long are dropped to keep memory bounded. */
export const GAME_TTL_MS = 24 * 60 * 60 * 1000;

type Listener = (version: number) => void;

export class GameStore {
  private readonly games = new Map<string, GameRecord>();
  private readonly byCode = new Map<string, string>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly notified = new Map<string, number>();

  constructor(readonly deps: GameDeps = defaultDeps) {}

  create(request: CreateGameRequest): GameRecord {
    const game = createGame(request, this.deps);
    this.games.set(game.id, game);
    this.byCode.set(game.code, game.id);
    this.notified.set(game.id, game.version);
    return game;
  }

  get(id: string): GameRecord | null {
    return this.games.get(id) ?? null;
  }

  require(id: string): GameRecord {
    const game = this.get(id);
    if (!game) throw new GameError('no such game', 404);
    return game;
  }

  /** Resolves a join code or a game id, so a shared link works either way. */
  find(idOrCode: string): GameRecord | null {
    const direct = this.games.get(idOrCode);
    if (direct) return direct;
    const id = this.byCode.get(idOrCode.toUpperCase());
    return id ? (this.games.get(id) ?? null) : null;
  }

  list(): GameRecord[] {
    return [...this.games.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  size(): number {
    return this.games.size;
  }

  /**
   * Fires every due deadline and pushes any resulting change to subscribers.
   * Called on a timer in production and directly from tests.
   */
  tick(): void {
    for (const game of this.games.values()) {
      maybeResolve(game, this.deps);
    }
    this.prune();
    this.flush();
  }

  /** Publishes pending version changes. Call after any mutation. */
  flush(): void {
    for (const game of this.games.values()) {
      const last = this.notified.get(game.id);
      if (last === game.version) continue;
      this.notified.set(game.id, game.version);
      for (const listener of this.listeners.get(game.id) ?? []) listener(game.version);
    }
  }

  subscribe(gameId: string, listener: Listener): () => void {
    let set = this.listeners.get(gameId);
    if (!set) {
      set = new Set();
      this.listeners.set(gameId, set);
    }
    set.add(listener);

    return () => {
      const current = this.listeners.get(gameId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(gameId);
    };
  }

  private prune(): void {
    const cutoff = this.deps.now() - GAME_TTL_MS;
    for (const game of this.games.values()) {
      const touched = Math.max(game.createdAt, ...game.seats.map((seat) => seat.lastSeen));
      if (touched > cutoff) continue;
      if (this.listeners.has(game.id)) continue;
      this.games.delete(game.id);
      this.byCode.delete(game.code);
      this.notified.delete(game.id);
    }
  }
}
