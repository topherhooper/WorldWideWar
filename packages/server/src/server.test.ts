import { describe, expect, it } from 'vitest';
import { HIDDEN_ARMIES, type GameState, type OrderSet } from '@www/engine';
import { handleApi, type ApiResponse } from './api.js';
import { GameStore } from './store.js';
import { parseOrderSet } from './orders.js';
import type { GameDeps } from './game.js';
import type { GameView, JoinResponse } from './protocol.js';

/**
 * A stopped clock the test moves by hand, and a counter for ids. Between them
 * the entire lifecycle — deadlines included — runs instantly and identically on
 * every machine.
 */
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

function post(store: GameStore, path: string, body: unknown): ApiResponse {
  return handleApi(store, { method: 'POST', path, query: new URLSearchParams(), body });
}

function get(store: GameStore, path: string, token?: string): ApiResponse {
  const query = new URLSearchParams(token ? { token } : {});
  return handleApi(store, { method: 'GET', path, query, body: null });
}

const NEW_GAME = { name: 'Ada', playerCount: 4, humanSeats: 1, turnSeconds: 60, seed: 'test-seed' };

function createSolo(store: GameStore, overrides: Record<string, unknown> = {}): JoinResponse {
  const created = post(store, '/games', { ...NEW_GAME, ...overrides });
  expect(created.status).toBe(201);
  return created.body as JoinResponse;
}

function viewOf(store: GameStore, id: string, token?: string): GameView {
  const response = get(store, `/games/${id}`, token);
  expect(response.status).toBe(200);
  return response.body as GameView;
}

describe('creating and joining', () => {
  it('seats the host and starts a solo game immediately', () => {
    const store = new GameStore(fakeDeps());
    const { gameId, token, slot } = createSolo(store);
    const view = viewOf(store, gameId, token);

    expect(slot).toBe(0);
    expect(view.phase).toBe('active');
    expect(view.you).toEqual({ slot: 0, name: 'Ada', isHost: true });
    expect(view.players).toHaveLength(4);
    expect(view.players.slice(1).every((player) => player.kind === 'bot')).toBe(true);
    expect(view.state).not.toBeNull();
    expect(view.deadline).toBe(store.deps.now() + 60_000);
  });

  it('holds a multi-seat table in the lobby until every seat is claimed', () => {
    const store = new GameStore(fakeDeps());
    const host = createSolo(store, { humanSeats: 3 });

    expect(viewOf(store, host.gameId, host.token).phase).toBe('lobby');
    expect(viewOf(store, host.gameId).state).toBeNull();

    const second = post(store, `/games/${host.code}/join`, { name: 'Grace' }).body as JoinResponse;
    expect(second.slot).toBe(1);
    expect(viewOf(store, host.gameId, host.token).phase).toBe('lobby');

    const third = post(store, `/games/${host.code}/join`, { name: 'Alan' }).body as JoinResponse;
    expect(third.slot).toBe(2);

    const view = viewOf(store, host.gameId, host.token);
    expect(view.phase).toBe('active');
    expect(view.players.map((player) => player.name)).toEqual([
      'Ada',
      'Grace',
      'Alan',
      view.players[3].name,
    ]);
  });

  it('lets the host start early, turning unclaimed seats into bots', () => {
    const store = new GameStore(fakeDeps());
    const host = createSolo(store, { humanSeats: 4 });

    expect(post(store, `/games/${host.gameId}/start`, { token: 'not-the-host' }).status).toBe(403);

    const started = post(store, `/games/${host.gameId}/start`, { token: host.token });
    expect(started.status).toBe(200);
    expect((started.body as GameView).phase).toBe('active');
    expect((started.body as GameView).players.filter((p) => p.kind === 'bot')).toHaveLength(3);

    expect(post(store, `/games/${host.gameId}/join`, { name: 'Late' }).status).toBe(409);
  });

  it('treats rejoining with a held token as idempotent', () => {
    const store = new GameStore(fakeDeps());
    const host = createSolo(store, { humanSeats: 2 });

    const again = post(store, `/games/${host.gameId}/join`, { token: host.token, name: 'Ada' });
    expect(again.status).toBe(200);
    expect((again.body as JoinResponse).slot).toBe(0);
    expect(viewOf(store, host.gameId, host.token).phase).toBe('lobby');
  });

  it('rejects a table it cannot build', () => {
    const store = new GameStore(fakeDeps());
    expect(post(store, '/games', { ...NEW_GAME, playerCount: 99 }).status).toBe(400);
    expect(post(store, '/games', { ...NEW_GAME, humanSeats: 9 }).status).toBe(400);
    expect(post(store, '/games', { ...NEW_GAME, turnSeconds: 1 }).status).toBe(400);
    expect(get(store, '/games/nope').status).toBe(404);
    expect(store.size()).toBe(0);
  });

  it('lists only lobbies that still have room', () => {
    const store = new GameStore(fakeDeps());
    createSolo(store, { humanSeats: 2 });
    createSolo(store);

    const listed = (get(store, '/games').body as { games: { openSeats: number }[] }).games;
    expect(listed).toHaveLength(1);
    expect(listed[0].openSeats).toBe(1);
  });
});

describe('turn resolution', () => {
  it('resolves as soon as every human has locked in', () => {
    const store = new GameStore(fakeDeps());
    const { gameId, token } = createSolo(store);
    const before = viewOf(store, gameId, token);

    const response = post(store, `/games/${gameId}/orders`, {
      token,
      locked: true,
      orders: { pledge: 1, deploys: [], units: [] },
    });

    const after = response.body as GameView;
    expect(after.turn).toBe(before.turn + 1);
    expect(after.report?.turn).toBe(before.turn);
    expect(after.locked).toBe(false);
    expect(after.draft).toBeNull();
    expect(after.report?.pacts.find((pact) => pact.slot === 0)?.pledged).toBe(1);
  });

  it('waits for a second human, then resolves without a deadline', () => {
    const store = new GameStore(fakeDeps());
    const host = createSolo(store, { humanSeats: 2 });
    const guest = post(store, `/games/${host.gameId}/join`, { name: 'Grace' }).body as JoinResponse;

    post(store, `/games/${host.gameId}/orders`, {
      token: host.token,
      locked: true,
      orders: { pledge: null, deploys: [], units: [] },
    });
    expect(viewOf(store, host.gameId, host.token).turn).toBe(1);
    expect(viewOf(store, host.gameId, host.token).locked).toBe(true);

    post(store, `/games/${host.gameId}/orders`, {
      token: guest.token,
      locked: true,
      orders: { pledge: null, deploys: [], units: [] },
    });
    expect(viewOf(store, host.gameId, host.token).turn).toBe(2);
  });

  it('does not resolve on an unlocked draft, and keeps it for the deadline', () => {
    const deps = fakeDeps();
    const store = new GameStore(deps);
    const { gameId, token } = createSolo(store);
    const state = viewOf(store, gameId, token).state as GameState;
    const capital = state.capital[0] as number;

    post(store, `/games/${gameId}/orders`, {
      token,
      locked: false,
      orders: { pledge: 2, deploys: [{ to: capital, count: 1 }], units: [] },
    });

    const drafted = viewOf(store, gameId, token);
    expect(drafted.turn).toBe(1);
    expect(drafted.locked).toBe(false);
    expect(drafted.draft?.deploys).toEqual([{ to: capital, count: 1 }]);

    // Nothing happens until the clock passes the deadline.
    deps.advance(59_000);
    store.tick();
    expect(viewOf(store, gameId, token).turn).toBe(1);

    deps.advance(2_000);
    store.tick();

    const resolved = viewOf(store, gameId, token);
    expect(resolved.turn).toBe(2);
    // The assistant honours the pledge the player had drafted rather than
    // passing the turn.
    expect(resolved.report?.pacts.find((pact) => pact.slot === 0)?.pledged).toBe(2);
  });

  it('fills a missed turn with a competent one rather than a pass', () => {
    const deps = fakeDeps();
    const store = new GameStore(deps);
    const { gameId, token } = createSolo(store);

    deps.advance(61_000);
    store.tick();

    const view = viewOf(store, gameId, token);
    expect(view.turn).toBe(2);
    // Assisted seats deploy their income; an untouched seat would not have.
    const report = view.report;
    expect(report).not.toBeNull();
    expect(view.players[0].territories).toBeGreaterThan(0);
  });

  it('runs bot-only tables on a fast clock once the human resigns', () => {
    const deps = fakeDeps();
    const store = new GameStore(deps);
    const { gameId, token } = createSolo(store);

    const resigned = post(store, `/games/${gameId}/resign`, { token });
    expect(resigned.status).toBe(200);
    expect((resigned.body as GameView).players[0].status).toBe('resigned');

    // Nobody is left to wait on, so the long deadline collapses to the bot pace
    // — but the turn still waits for it rather than resolving on every poll.
    const view = viewOf(store, gameId, token);
    expect(view.turn).toBe(1);
    expect((view.deadline as number) - deps.now()).toBeLessThanOrEqual(1_500);

    for (let i = 0; i < 5; i++) expect(viewOf(store, gameId, token).turn).toBe(1);

    deps.advance(2_000);
    store.tick();
    expect(viewOf(store, gameId, token).turn).toBe(2);
  });

  it('plays a whole game through to a result', () => {
    const deps = fakeDeps();
    const store = new GameStore(deps);
    const { gameId, token } = createSolo(store, { seed: 'full-game', playerCount: 3 });

    for (let guard = 0; guard < 200; guard++) {
      const view = viewOf(store, gameId, token);
      if (view.phase === 'finished') break;
      if (view.players[0].status === 'active') {
        post(store, `/games/${gameId}/orders`, {
          token,
          locked: true,
          orders: { pledge: null, deploys: [], units: [] },
        });
      } else {
        deps.advance(2_000);
        store.tick();
      }
    }

    const final = viewOf(store, gameId, token);
    expect(final.phase).toBe('finished');
    expect(final.result).not.toBeNull();
    expect(final.deadline).toBeNull();

    const history = (get(store, `/games/${gameId}/history`).body as { reports: unknown[] }).reports;
    expect(history.length).toBe(final.turn - 1);

    // A finished game accepts no further orders.
    expect(
      post(store, `/games/${gameId}/orders`, {
        token,
        locked: true,
        orders: { pledge: null, deploys: [], units: [] },
      }).status,
    ).toBe(409);
  });
});

describe('what a player is allowed to see', () => {
  it('never returns another seat’s draft', () => {
    const store = new GameStore(fakeDeps());
    const host = createSolo(store, { humanSeats: 2 });
    const guest = post(store, `/games/${host.gameId}/join`, { name: 'Grace' }).body as JoinResponse;

    post(store, `/games/${host.gameId}/orders`, {
      token: host.token,
      locked: false,
      orders: { pledge: 1, deploys: [], units: [] },
    });

    expect(viewOf(store, host.gameId, host.token).draft?.pledge).toBe(1);
    expect(viewOf(store, host.gameId, guest.token).draft).toBeNull();
    expect(viewOf(store, host.gameId).draft).toBeNull();
    // Readiness is public — it has to be, or nobody knows who the turn waits on.
    expect(viewOf(store, host.gameId, guest.token).players[0].ready).toBe(false);
  });

  it('hides army counts under fog, including in the player summaries', () => {
    const store = new GameStore(fakeDeps());
    const { gameId, token } = createSolo(store, { playerCount: 5 });
    const game = store.require(gameId);

    // Fog is a global event the engine draws; force it on to test the boundary.
    game.state.fogUntilTurn = game.state.turn + 2;

    const mine = viewOf(store, gameId, token);
    const spectator = viewOf(store, gameId);

    const state = mine.state as GameState;
    expect(mine.fog).toBe(true);
    for (let id = 0; id < state.owner.length; id++) {
      if (state.owner[id] === 0) expect(state.armies[id]).toBeGreaterThanOrEqual(0);
      else expect(state.armies[id]).toBe(HIDDEN_ARMIES);
    }

    expect(mine.players[0].armies).toBeGreaterThan(0);
    expect(mine.players[1].armies).toBeNull();
    expect((spectator.state as GameState).armies.every((n) => n === HIDDEN_ARMIES)).toBe(true);
    expect(spectator.players.every((player) => player.armies === null)).toBe(true);
  });

  it('refuses to act on an unknown token', () => {
    const store = new GameStore(fakeDeps());
    const { gameId } = createSolo(store);

    expect(post(store, `/games/${gameId}/orders`, { token: 'nope', orders: {} }).status).toBe(403);
    expect(post(store, `/games/${gameId}/resign`, { token: 'nope' }).status).toBe(403);
    expect(viewOf(store, gameId).you).toBeNull();
  });

  it('serves the map to anyone, since it is public information', () => {
    const store = new GameStore(fakeDeps());
    const { gameId } = createSolo(store);
    const map = get(store, `/games/${gameId}/map`).body as { territories: unknown[] };
    expect(map.territories.length).toBeGreaterThan(0);
  });
});

describe('order parsing', () => {
  const parse = (raw: unknown): OrderSet => parseOrderSet(raw, 0, 4, 20);

  it('keeps well-formed orders', () => {
    expect(
      parse({
        pledge: 2,
        deploys: [{ to: 3, count: 2 }],
        units: [
          { kind: 'HOLD', from: 1 },
          { kind: 'MOVE', from: 2, to: 3, count: 4 },
          { kind: 'SUPPORT', from: 4, target: 5, forPlayer: 1 },
        ],
      }),
    ).toEqual({
      slot: 0,
      pledge: 2,
      deploys: [{ to: 3, count: 2 }],
      units: [
        { kind: 'HOLD', from: 1 },
        { kind: 'MOVE', from: 2, to: 3, count: 4 },
        { kind: 'SUPPORT', from: 4, target: 5, forPlayer: 1 },
      ],
    });
  });

  it('drops anything malformed instead of trusting it', () => {
    const parsed = parse({
      pledge: 0, // pledging yourself
      deploys: [{ to: 999, count: 1 }, { to: 1, count: -3 }, { to: 1, count: 1.5 }, null, 7],
      units: [
        { kind: 'MOVE', from: 1, to: 2 },
        { kind: 'SUPPORT', from: 1, target: 2, forPlayer: 99 },
        { kind: 'TELEPORT', from: 1 },
        { from: 1 },
        'nonsense',
      ],
    });

    expect(parsed).toEqual({ slot: 0, pledge: null, deploys: [], units: [] });
  });

  it('survives junk in place of an order set', () => {
    for (const junk of [null, undefined, 42, 'orders', [], { deploys: 'lots' }]) {
      expect(parse(junk)).toEqual({ slot: 0, pledge: null, deploys: [], units: [] });
    }
  });

  it('bounds how much one submission can be', () => {
    const deploys = Array.from({ length: 5000 }, () => ({ to: 1, count: 1 }));
    expect(parse({ deploys }).deploys.length).toBeLessThanOrEqual(20);
  });
});

describe('the update stream', () => {
  it('notifies subscribers exactly once per change', () => {
    const store = new GameStore(fakeDeps());
    const { gameId, token } = createSolo(store);
    const seen: number[] = [];
    const stop = store.subscribe(gameId, (version) => seen.push(version));

    post(store, `/games/${gameId}/orders`, {
      token,
      locked: true,
      orders: { pledge: null, deploys: [], units: [] },
    });
    expect(seen.length).toBe(1);

    store.tick();
    expect(seen.length).toBe(1);

    stop();
    post(store, `/games/${gameId}/orders`, {
      token,
      locked: true,
      orders: { pledge: null, deploys: [], units: [] },
    });
    expect(seen.length).toBe(1);
  });
});
