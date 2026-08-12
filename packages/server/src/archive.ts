/**
 * Keeping games across a restart.
 *
 * Almost nothing about a game needs to be written down. The map, the rule set
 * and the bot personalities are all pure functions of the seed, so a snapshot
 * stores the seed and regenerates them on load — which means the same engine
 * determinism that makes replays exact also makes persistence small.
 *
 * One file per game, written whole and moved into place, so a process killed
 * mid-write leaves the previous snapshot intact rather than half of the next
 * one. That is the entire durability story, and for a few kilobytes of state
 * accessed one game at a time it is the honest amount of machinery. When games
 * need to be queried across rather than loaded by id, this is the seam where a
 * database goes.
 */

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createInitialState,
  generateMap,
  makePersonality,
  rulesFor,
  substream,
  type Difficulty,
  type GameState,
  type TurnReport,
} from '@www/engine';
import type { GameRecord, Seat } from './game.js';
import type { GamePhase } from './protocol.js';

/** Bumped only when an old snapshot can no longer be read. */
export const SNAPSHOT_FORMAT = 1;

export interface GameSnapshot {
  formatVersion: typeof SNAPSHOT_FORMAT;
  id: string;
  code: string;
  phase: GamePhase;
  seed: string;
  playerCount: number;
  difficulty: Difficulty;
  turnSeconds: number;
  createdAt: number;
  hostToken: string;
  seats: Seat[];
  state: GameState;
  history: TurnReport[];
  deadline: number | null;
  version: number;
}

export interface GameArchive {
  /** Every game that survived the last shutdown. */
  load(): Promise<GameRecord[]>;
  /** Record a change. May return before the bytes have landed. */
  save(game: GameRecord): void;
  remove(id: string): void;
  /** Resolve once every queued write has completed. */
  drain(): Promise<void>;
}

/** Persistence turned off: every game lives and dies with the process. */
export const nullArchive: GameArchive = {
  load: async () => [],
  save: () => undefined,
  remove: () => undefined,
  drain: async () => undefined,
};

export function toSnapshot(game: GameRecord): GameSnapshot {
  return {
    formatVersion: SNAPSHOT_FORMAT,
    id: game.id,
    code: game.code,
    phase: game.phase,
    seed: game.seed,
    playerCount: game.playerCount,
    difficulty: game.difficulty,
    turnSeconds: game.turnSeconds,
    createdAt: game.createdAt,
    hostToken: game.hostToken,
    seats: game.seats,
    state: game.state,
    history: game.history,
    deadline: game.deadline,
    version: game.version,
  };
}

export function fromSnapshot(snapshot: GameSnapshot): GameRecord {
  if (snapshot.formatVersion !== SNAPSHOT_FORMAT) {
    throw new Error(`unreadable snapshot format ${snapshot.formatVersion}`);
  }

  // Regenerated rather than stored: identical inputs, identical output.
  const map = generateMap(snapshot.seed, snapshot.playerCount);
  const rules = rulesFor(snapshot.playerCount);
  const personalities = Array.from({ length: snapshot.playerCount }, (_, slot) =>
    makePersonality(substream(snapshot.seed, 'personality', slot), slot, snapshot.difficulty),
  );

  return {
    id: snapshot.id,
    code: snapshot.code,
    phase: snapshot.phase,
    seed: snapshot.seed,
    playerCount: snapshot.playerCount,
    difficulty: snapshot.difficulty,
    turnSeconds: snapshot.turnSeconds,
    createdAt: snapshot.createdAt,
    hostToken: snapshot.hostToken,
    map,
    rules,
    // A snapshot taken before the first turn resolved still has a full state,
    // but a truncated one would not: fall back rather than serve a broken game.
    state: snapshot.state ?? createInitialState(map, rules),
    seats: snapshot.seats,
    personalities,
    history: snapshot.history ?? [],
    deadline: snapshot.deadline,
    version: snapshot.version,
  };
}

export class FileArchive implements GameArchive {
  /**
   * Writes are serialised through one promise chain. Two saves of the same game
   * can never interleave, and `drain` has a single thing to await.
   */
  private queue: Promise<void> = Promise.resolve();
  private ready: Promise<void> | null = null;

  constructor(
    private readonly directory: string,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  async load(): Promise<GameRecord[]> {
    await this.ensureDirectory();

    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      this.onError(error);
      return [];
    }

    const games: GameRecord[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(this.directory, name), 'utf8');
        games.push(fromSnapshot(JSON.parse(raw) as GameSnapshot));
      } catch (error) {
        // One unreadable game must not stop every other game from coming back.
        this.onError(new Error(`skipping ${name}: ${describe(error)}`));
      }
    }

    return games;
  }

  save(game: GameRecord): void {
    const payload = JSON.stringify(toSnapshot(game));
    const target = this.pathFor(game.id);
    const temporary = `${target}.${game.version}.tmp`;

    this.enqueue(async () => {
      await this.ensureDirectory();
      await writeFile(temporary, payload, 'utf8');
      // Rename is atomic within a filesystem: readers see the old snapshot or
      // the new one, never a half-written one.
      await rename(temporary, target);
    });
  }

  remove(id: string): void {
    this.enqueue(async () => {
      await unlink(this.pathFor(id)).catch(() => undefined);
    });
  }

  drain(): Promise<void> {
    return this.queue;
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.then(work).catch((error: unknown) => {
      // A failed write is reported and dropped; the next change will try again,
      // and a server that cannot write its disk should still finish the turn.
      this.onError(error);
    });
  }

  private ensureDirectory(): Promise<void> {
    this.ready ??= mkdir(this.directory, { recursive: true }).then(() => undefined);
    return this.ready;
  }

  private pathFor(id: string): string {
    // Ids are generated, never user-supplied, but a path is a path.
    return join(this.directory, `${id.replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
