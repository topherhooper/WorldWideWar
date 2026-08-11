import { describe, expect, it } from 'vitest';
import { HIDDEN_ARMIES, redact } from '../redact.js';
import { substream } from '../rng.js';
import { hold, makeTestMap, move, orders, scenario } from '../testing.js';
import type { GameState, Slot } from '../types.js';
import { assistOrders, decideOrders, tableMatching } from './index.js';
import { makePersonality } from './personality.js';

function arena(playerCount = 4) {
  return makeTestMap({
    playerCount,
    territoryCount: 8,
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 0],
    ],
  });
}

function board(playerCount = 4): { map: ReturnType<typeof arena>; state: GameState } {
  const map = arena(playerCount);
  const state = scenario(map, {
    owner: [0, 0, 1, 1, 2, 2, 3, 3],
    armies: [6, 4, 6, 4, 6, 4, 6, 4],
    income: [4, 4, 4, 4],
  });
  return { map, state };
}

const person = (slot: Slot) => makePersonality(substream('p', slot), slot, 'normal');

describe('decideOrders', () => {
  it('is deterministic for a given seed', () => {
    const { map, state } = board();
    const a = decideOrders(state, map, 0, substream('s', 1, 'bot', 0), person(0));
    const b = decideOrders(state, map, 0, substream('s', 1, 'bot', 0), person(0));
    expect(b).toEqual(a);
  });

  it('never spends more than its income', () => {
    const { map, state } = board();
    for (let slot = 0; slot < 4; slot++) {
      const set = decideOrders(state, map, slot, substream('s', 1, 'bot', slot), person(slot));
      const spent = set.deploys.reduce((sum, d) => sum + d.count, 0);
      expect(spent).toBeLessThanOrEqual(state.income[slot]);
    }
  });

  it('only ever orders from territory it holds, once each', () => {
    const { map, state } = board();
    for (let slot = 0; slot < 4; slot++) {
      const set = decideOrders(state, map, slot, substream('s', 1, 'bot', slot), person(slot));
      const seen = new Set<number>();
      for (const unit of set.units) {
        expect(state.owner[unit.from]).toBe(slot);
        expect(seen.has(unit.from)).toBe(false);
        seen.add(unit.from);
      }
      for (const deploy of set.deploys) expect(state.owner[deploy.to]).toBe(slot);
    }
  });

  it('only moves to adjacent territory', () => {
    const { map, state } = board();
    for (let slot = 0; slot < 4; slot++) {
      const set = decideOrders(state, map, slot, substream('s', 1, 'bot', slot), person(slot));
      for (const unit of set.units) {
        if (unit.kind === 'MOVE') expect(map.adjacency[unit.from]).toContain(unit.to);
        if (unit.kind === 'SUPPORT') expect(map.adjacency[unit.from]).toContain(unit.target);
      }
    }
  });

  it('does no work for an eliminated seat', () => {
    const { map, state } = board();
    state.status[1] = 'eliminated';
    const set = decideOrders(state, map, 1, substream('s', 1, 'bot', 1), person(1));
    expect(set).toEqual({ slot: 1, pledge: null, deploys: [], units: [] });
  });

  it('cannot see through fog', () => {
    // Bots plan from redacted state, so they physically cannot act on strength
    // a human in the same seat would not be shown.
    const { map, state } = board();
    state.fogUntilTurn = state.turn + 2;
    const view = redact(state, 0);

    for (let id = 0; id < view.armies.length; id++) {
      if (view.owner[id] === 0) expect(view.armies[id]).toBe(state.armies[id]);
      else expect(view.armies[id]).toBe(HIDDEN_ARMIES);
    }

    // And it still produces a legal turn from that partial picture.
    const set = decideOrders(view, map, 0, substream('s', 1, 'bot', 0), person(0));
    for (const unit of set.units) expect(view.owner[unit.from]).toBe(0);
  });
});

describe('tableMatching', () => {
  it('pairs players off symmetrically', () => {
    const { map, state } = board();
    const partner = tableMatching(state, map);

    for (let slot = 0; slot < 4; slot++) {
      const other = partner[slot];
      if (other === null) continue;
      // The relationship must read the same from both ends, or the "pact" is
      // two different agreements wearing one name.
      expect(partner[other]).toBe(slot);
    }
  });

  it('is the same computation for every player, which is the point', () => {
    // Every bot derives the whole table's matching from public information, so
    // they agree without communicating. Picking a favourite independently
    // leaves roughly half of all pledges unreciprocated.
    const { map, state } = board(6);
    const first = tableMatching(state, map);
    const second = tableMatching(state, map);
    expect(second).toEqual(first);
  });

  it('does not systematically favour low seats', () => {
    // A tie-break on slot or territory id silently means "prefer the
    // lowest-numbered player", which compounded into a 12%-to-22% seat win
    // spread on a provably symmetric map.
    const counts = new Array<number>(6).fill(0);

    for (let i = 0; i < 200; i++) {
      const map = makeTestMap({
        playerCount: 6,
        territoryCount: 6,
        edges: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [4, 5],
          [5, 0],
        ],
      });
      // Distinct seeds so the seeded jitter differs between tables.
      map.seed = `table-${i}`;
      const state = scenario(map, {
        owner: [0, 1, 2, 3, 4, 5],
        armies: [5, 5, 5, 5, 5, 5],
      });
      const partner = tableMatching(state, map);
      for (let slot = 0; slot < 6; slot++) if (partner[slot] !== null) counts[slot]++;
    }

    // Every seat should find a partner about equally often.
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    expect(max - min).toBeLessThan(60);
  });

  it('varies with the game seed rather than repeating every table', () => {
    // Keying the tie-break on (turn, a, b) alone favours the same pairs in
    // every game ever played, which biases whichever seats it happens to suit.
    const pairings = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const map = arena(6);
      map.seed = `seed-${i}`;
      const state = scenario(map, {
        owner: [0, 0, 1, 1, 2, 2, 3, 3],
        armies: [5, 5, 5, 5, 5, 5, 5, 5],
      });
      pairings.add(tableMatching(state, map).join(','));
    }
    expect(pairings.size).toBeGreaterThan(1);
  });
});

describe('assistOrders', () => {
  it('keeps everything the player already submitted', () => {
    const { map, state } = board();
    const draft = orders(0, [move(0, 1, 2)], 2);
    const assisted = assistOrders(state, map, 0, substream('s', 1, 'bot', 0), person(0), draft);

    expect(assisted.pledge).toBe(2);
    expect(assisted.units).toContainEqual(draft.units[0]);
  });

  it('fills the gaps so a missed turn is still a competent turn', () => {
    // In a twelve-player free-for-all a passive seat becomes free food and
    // warps the whole game around whoever happens to border it.
    const { map, state } = board();
    const draft = orders(0, [hold(0)]);
    const assisted = assistOrders(state, map, 0, substream('s', 1, 'bot', 0), person(0), draft);

    expect(assisted.deploys.length).toBeGreaterThan(0);
    const spent = assisted.deploys.reduce((sum, d) => sum + d.count, 0);
    expect(spent).toBeLessThanOrEqual(state.income[0]);
  });

  it('pledges on the player behalf when they did not', () => {
    const { map, state } = board();
    const assisted = assistOrders(
      state,
      map,
      0,
      substream('s', 1, 'bot', 0),
      person(0),
      orders(0, [hold(0)]),
    );
    expect(assisted.pledge).not.toBeUndefined();
  });

  it('never overrides an order the player gave for a territory', () => {
    const { map, state } = board();
    const draft = orders(0, [move(0, 1, 1), move(1, 2, 1)]);
    const assisted = assistOrders(state, map, 0, substream('s', 1, 'bot', 0), person(0), draft);

    const fromZero = assisted.units.filter((u) => u.from === 0);
    expect(fromZero).toEqual([draft.units[0]]);
  });

  it('falls back to a full bot turn when nothing was submitted', () => {
    const { map, state } = board();
    const assisted = assistOrders(state, map, 0, substream('s', 1, 'bot', 0), person(0), null);
    const full = decideOrders(state, map, 0, substream('s', 1, 'bot', 0), person(0));
    expect(assisted).toEqual(full);
  });
});

describe('personalities', () => {
  it('are seeded and stable', () => {
    expect(makePersonality(substream('x', 3), 3, 'normal')).toEqual(
      makePersonality(substream('x', 3), 3, 'normal'),
    );
  });

  it('carry visible tags so a bot reads as a character', () => {
    for (let slot = 0; slot < 12; slot++) {
      const personality = makePersonality(substream('tags', slot), slot, 'normal');
      expect(personality.tags.length).toBeGreaterThan(0);
      expect(personality.name).toMatch(/\w+ \w+/);
    }
  });

  it('makes easy bots erratic rather than merely weak', () => {
    const easy = makePersonality(substream('e', 1), 1, 'easy');
    const normal = makePersonality(substream('e', 1), 1, 'normal');
    expect(easy.chaos).toBeGreaterThan(normal.chaos);
  });
});
