import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameState } from '@www/engine';
import { FileArchive, fromSnapshot, toSnapshot } from './archive.js';
import type { GameDeps } from './game.js';
import { handleApi } from './api.js';
import { SEAT_TOKEN_HEADER } from './api.js';
import { GameStore } from './store.js';
import type { GameView, JoinResponse } from './protocol.js';

function fakeDeps(): GameDeps & { advance: (ms: number) => void } {
  let clock = 1_700_000_000_000;
  let counter = 0;
  return {
    now: () => clock,
    uid: () => `id${(counter++).toString(16).padStart(30, '0')}`,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const NEW_GAME = { name: 'Ada', playerCount: 4, humanSeats: 1, turnSeconds: 60, seed: 'archived' };

function post(store: GameStore, path: string, body: unknown) {
  return handleApi(store, { method: 'POST', path, query: new URLSearchParams(), body });
}

function view(store: GameStore, id: string, token?: string): GameView {
  return handleApi(store, {
    method: 'GET',
    path: `/games/${id}`,
    query: new URLSearchParams(),
    body: null,
    ...(token ? { headers: { [SEAT_TOKEN_HEADER]: token } } : {}),
  }).body as GameView;
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'www-archive-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('snapshots', () => {
  it('round-trips a game without storing what the seed can regenerate', () => {
    const store = new GameStore(fakeDeps());
    const { gameId } = post(store, '/games', NEW_GAME).body as JoinResponse;
    const original = store.require(gameId);

    const snapshot = toSnapshot(original);
    const raw = JSON.stringify(snapshot);
    expect(raw).not.toContain('polygon');
    expect(raw).not.toContain('aggression');

    const restored = fromSnapshot(JSON.parse(raw) as typeof snapshot);
    expect(restored.map).toEqual(original.map);
    expect(restored.personalities).toEqual(original.personalities);
    expect(restored.rules).toEqual(original.rules);
    expect(restored.state).toEqual(original.state);
    expect(restored.seats).toEqual(original.seats);
  });

  it('refuses a snapshot format it does not understand', () => {
    const store = new GameStore(fakeDeps());
    const { gameId } = post(store, '/games', NEW_GAME).body as JoinResponse;
    const snapshot = { ...toSnapshot(store.require(gameId)), formatVersion: 99 };

    expect(() => fromSnapshot(snapshot as never)).toThrow(/unreadable snapshot/);
  });
});

describe('surviving a restart', () => {
  it('brings back a game mid-turn, seat and draft intact', async () => {
    const deps = fakeDeps();
    const before = new GameStore(deps, new FileArchive(directory));
    const { gameId, token } = post(before, '/games', NEW_GAME).body as JoinResponse;

    const state = view(before, gameId, token).state as GameState;
    const capital = state.capital[0] as number;
    post(before, `/games/${gameId}/orders`, {
      token,
      locked: false,
      orders: { pledge: 2, deploys: [{ to: capital, count: 1 }], units: [] },
    });
    await before.drain();

    // A brand new process, sharing nothing but the directory.
    const after = new GameStore(deps, new FileArchive(directory));
    expect(await after.restore()).toBe(1);

    const revived = view(after, gameId, token);
    expect(revived.phase).toBe('active');
    expect(revived.turn).toBe(1);
    expect(revived.you?.name).toBe('Ada');
    expect(revived.draft?.pledge).toBe(2);
    expect(revived.draft?.deploys).toEqual([{ to: capital, count: 1 }]);
    // Same seat token, so a player's browser reconnects without noticing.
    expect(view(after, gameId, 'someone-else').you).toBeNull();
  });

  it('keeps the history, and resolves a deadline that passed while it was down', async () => {
    const deps = fakeDeps();
    const before = new GameStore(deps, new FileArchive(directory));
    const { gameId, token } = post(before, '/games', NEW_GAME).body as JoinResponse;

    post(before, `/games/${gameId}/orders`, {
      token,
      locked: true,
      orders: { pledge: null, deploys: [], units: [] },
    });
    expect(view(before, gameId, token).turn).toBe(2);
    await before.drain();

    // The server is down for an hour — well past the turn deadline.
    deps.advance(60 * 60 * 1000);

    const after = new GameStore(deps, new FileArchive(directory));
    await after.restore();

    // Read the record rather than the API: a poll would itself notice the
    // passed deadline, which is the next thing this test wants to prove.
    const revived = after.require(gameId);
    expect(revived.history).toHaveLength(1);
    expect(revived.history[0].turn).toBe(1);
    expect(revived.state.turn).toBe(2);

    // No special case for a missed deadline: the ordinary tick notices it.
    after.tick();
    expect(view(after, gameId, token).turn).toBeGreaterThan(2);
  });

  it('is resilient to a snapshot that cannot be read', async () => {
    const problems: unknown[] = [];
    const store = new GameStore(fakeDeps(), new FileArchive(directory));
    const { gameId } = post(store, '/games', NEW_GAME).body as JoinResponse;
    await store.drain();

    await writeFile(join(directory, 'corrupt.json'), '{ truncated', 'utf8');
    await writeFile(join(directory, 'notes.txt'), 'ignore me', 'utf8');

    const after = new GameStore(
      fakeDeps(),
      new FileArchive(directory, (error) => problems.push(error)),
    );
    expect(await after.restore()).toBe(1);
    expect(after.get(gameId)).not.toBeNull();
    expect(problems).toHaveLength(1);
  });

  it('writes each game once and forgets it when it expires', async () => {
    const deps = fakeDeps();
    const store = new GameStore(deps, new FileArchive(directory));
    const { gameId } = post(store, '/games', NEW_GAME).body as JoinResponse;
    await store.drain();

    expect(await readdir(directory)).toEqual([`${gameId}.json`]);
    const snapshot = JSON.parse(
      await readFile(join(directory, `${gameId}.json`), 'utf8'),
    ) as ReturnType<typeof toSnapshot>;
    expect(snapshot.id).toBe(gameId);

    // Past the TTL, the game is dropped from memory and from disk with it.
    deps.advance(25 * 60 * 60 * 1000);
    store.tick();
    await store.drain();

    expect(store.get(gameId)).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it('leaves no temporary files behind', async () => {
    const store = new GameStore(fakeDeps(), new FileArchive(directory));
    const { gameId, token } = post(store, '/games', NEW_GAME).body as JoinResponse;
    for (let i = 0; i < 5; i++) {
      post(store, `/games/${gameId}/orders`, {
        token,
        locked: false,
        orders: { pledge: i % 3, deploys: [], units: [] },
      });
    }
    await store.drain();

    const files = await readdir(directory);
    expect(files.filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(files).toHaveLength(1);
  });
});
