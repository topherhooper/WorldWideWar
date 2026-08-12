/**
 * The table of live games, plus the heartbeat that fires turn deadlines.
 *
 * Games are held in memory and mirrored to an archive, rather than read back
 * from storage on every request. That is not a shortcut: a turn is resolved by
 * a pure function over a whole game, so the working set is one object and the
 * archive exists to survive a restart, not to be queried.
 *
 * `flush` is the single choke point where a change becomes visible to anyone
 * else — subscribers and disk both — which is why exactly one place has to be
 * right about when a game has moved.
 */

import { randomUUID } from 'node:crypto';
import { nullArchive, type GameArchive } from './archive.js';
import { createGame, maybeResolve, type GameDeps, type GameRecord, GameError } from './game.js';
import type { CreateGameRequest } from './protocol.js';

export const defaultDeps: GameDeps = {
  now: () => Date.now(),
  uid: () => randomUUID().replace(/-/g, ''),
};

/** Games untouched for this long are dropped to keep memory bounded. */
export const GAME_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A ceiling on live games.
 *
 * The TTL bounds memory over hours; this bounds it over seconds. Without it a
 * script can generate maps until the process dies, and a public origin should
 * refuse politely long before that.
 */
export const MAX_GAMES = 500;

type Listener = (version: number) => void;

export class GameStore {
  private readonly games = new Map<string, GameRecord>();
  private readonly byCode = new Map<string, string>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly notified = new Map<string, number>();

  constructor(
    readonly deps: GameDeps = defaultDeps,
    private readonly archive: GameArchive = nullArchive,
    private readonly maxGames: number = MAX_GAMES,
  ) {}

  create(request: CreateGameRequest): GameRecord {
    // Expiring first means a burst that hits the ceiling is turned away only
    // when the games actually in progress fill it, not by yesterday's leftovers.
    this.prune();
    if (this.games.size >= this.maxGames) {
      throw new GameError('the server is full — try again shortly', 503);
    }

    const game = createGame(request, this.deps);
    this.games.set(game.id, game);
    this.byCode.set(game.code, game.id);
    this.notified.set(game.id, game.version);
    this.archive.save(game);
    return game;
  }

  /**
   * Brings back everything that survived the last shutdown.
   *
   * A game whose deadline passed while the server was down is not resolved
   * here: `tick` will notice it like any other overdue turn, so there is one
   * code path for a late turn rather than a separate one for a restart.
   */
  async restore(): Promise<number> {
    for (const game of await this.archive.load()) {
      this.games.set(game.id, game);
      this.byCode.set(game.code, game.id);
      this.notified.set(game.id, game.version);
    }
    return this.games.size;
  }

  /** Waits for every queued write to land. Call before exiting. */
  drain(): Promise<void> {
    return this.archive.drain();
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

  /** Publishes pending version changes, to subscribers and to disk. */
  flush(): void {
    for (const game of this.games.values()) {
      const last = this.notified.get(game.id);
      if (last === game.version) continue;
      this.notified.set(game.id, game.version);
      this.archive.save(game);
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
      this.archive.remove(game.id);
    }
  }
}
