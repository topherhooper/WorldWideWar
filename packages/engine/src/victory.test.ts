import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, MIN_CONCORDAT_PLAYERS } from './constants.js';
import { makeTestMap, scenario } from './testing.js';
import type { GameState, GeneratedMap, RuleConfig, Slot } from './types.js';
import { checkVictory, fullyHeldRegions, updateVictoryStreaks } from './victory.js';

/** Four separated regions of three, plus starts so capitals exist. */
function board(playerCount = 4): GeneratedMap {
  const territoryCount = 12;
  return makeTestMap({
    playerCount,
    territoryCount,
    edges: [
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 5],
      [6, 7],
      [7, 8],
      [9, 10],
      [10, 11],
      [2, 3],
      [5, 6],
      [8, 9],
    ],
    regions: [
      { bonus: 3, territoryIds: [0, 1, 2] },
      { bonus: 3, territoryIds: [3, 4, 5] },
      { bonus: 3, territoryIds: [6, 7, 8] },
      { bonus: 3, territoryIds: [9, 10, 11] },
    ],
    starts: Array.from({ length: playerCount }, (_, slot) => ({
      slot,
      capital: slot * 3,
      extra: [],
    })),
  });
}

/** Runs the streak update the world tick would, then judges victory. */
function judge(state: GameState, map: GeneratedMap, rules: RuleConfig = DEFAULT_RULES) {
  updateVictoryStreaks(state, map, rules);
  return checkVictory(state, map, rules);
}

function settle(state: GameState, map: GeneratedMap, turns: number, rules = DEFAULT_RULES) {
  let result = null;
  for (let i = 0; i < turns; i++) {
    state.turn++;
    result = judge(state, map, rules);
  }
  return result;
}

describe('conquest', () => {
  it('ends the game for the last player standing', () => {
    const map = board();
    const state = scenario(map, {
      owner: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      armies: new Array(12).fill(2),
    });
    for (const slot of [1, 2, 3]) state.status[slot] = 'eliminated';

    const result = judge(state, map);
    expect(result?.kind).toBe('conquest');
    expect(result?.winners).toEqual([0]);
  });
});

describe('hegemony', () => {
  const rules: RuleConfig = { ...DEFAULT_RULES, hegemonyMinRegionsAlive: 4, hegemonyMinimum: 2 };

  it('counts only regions held in full', () => {
    const map = board();
    // Region 0 (0,1,2) is entirely slot 0. Region 1 (3,4,5) is split between
    // slots 0 and 1, so it counts for neither. Region 2 (6,7,8) is entirely
    // slot 1. Region 3 (9,10,11) is entirely slot 2.
    const state = scenario(map, {
      owner: [0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2],
      armies: new Array(12).fill(2),
    });
    expect(fullyHeldRegions(state, map, 0)).toBe(1);
    expect(fullyHeldRegions(state, map, 1)).toBe(1);
    expect(fullyHeldRegions(state, map, 2)).toBe(1);
    // Holding two of a region's three territories is worth nothing at all.
    expect(fullyHeldRegions(state, map, 0) + fullyHeldRegions(state, map, 1)).toBe(2);
  });

  it('requires the holding to survive a turn before it counts', () => {
    const map = board();
    const state = scenario(map, {
      owner: [0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2],
      armies: new Array(12).fill(2),
    });

    // Two whole regions on the board, but not yet held for long enough.
    expect(fullyHeldRegions(state, map, 0)).toBe(2);
    expect(judge(state, map, rules)).toBeNull();

    // Holding it through another turn closes the game out.
    state.turn++;
    const result = judge(state, map, rules);
    expect(result?.kind).toBe('hegemony');
    expect(result?.winners).toEqual([0]);
  });

  it('switches off once the storm has eaten the map', () => {
    // Otherwise it becomes the default ending on large tables: three whole
    // regions out of the handful that survive is far easier than holding half
    // the territory, so mopping up would beat empire-building.
    const map = board();
    const state = scenario(map, {
      owner: [0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2],
      armies: new Array(12).fill(2),
    });
    for (const id of [9, 10, 11]) {
      state.collapsed[id] = true;
      state.owner[id] = null;
    }

    // Only three regions still exist, below the availability floor.
    const strict: RuleConfig = { ...rules, hegemonyMinRegionsAlive: 4 };
    settle(state, map, 3, strict);
    const result = judge(state, map, strict);
    expect(result?.kind).not.toBe('hegemony');
  });
});

describe('decapitation', () => {
  const rules: RuleConfig = { ...DEFAULT_RULES, decapitationStreak: 2 };

  it('needs your own founding capital as well as your rivals', () => {
    const map = board();
    // Slot 0 holds every rival capital (3, 6, 9) but has lost its own (0).
    const state = scenario(map, {
      owner: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      armies: new Array(12).fill(2),
      capital: [1, 0, null, null],
    });

    settle(state, map, 4, rules);
    expect(judge(state, map, rules)?.kind).not.toBe('decapitation');
  });

  it('fires once enough rival capitals are held through a turn', () => {
    const map = board();
    const state = scenario(map, {
      owner: [0, 0, 0, 0, 1, 1, 0, 2, 2, 3, 3, 3],
      armies: new Array(12).fill(2),
    });

    // Holds own capital 0 plus rival capitals 3 and 6 — two of three.
    expect(judge(state, map, rules)).toBeNull();
    state.turn++;
    const result = judge(state, map, rules);
    expect(result?.kind).toBe('decapitation');
    expect(result?.winners).toEqual([0]);
  });

  it('tracks founding capitals, not relocated ones', () => {
    // A relocated capital is a consolation prize; letting the target move would
    // make the condition unfalsifiable.
    const map = board();
    const state = scenario(map, {
      owner: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3],
      armies: new Array(12).fill(2),
    });
    state.capital[1] = 4;
    settle(state, map, 4, rules);
    expect(judge(state, map, rules)?.kind).not.toBe('decapitation');
  });
});

describe('shared victories', () => {
  function concord(state: GameState, a: Slot, b: Slot, turn: number): void {
    state.concordAt[a][b] = turn;
    state.concordAt[b][a] = turn;
  }

  it('never awards one that includes every living player', () => {
    // "Everybody wins" is a draw, and the design promises none.
    const map = board(3);
    const state = scenario(map, {
      owner: [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2],
      armies: new Array(12).fill(2),
    });
    state.status[2] = 'eliminated';
    state.pactPartner[0] = 1;
    state.pactPartner[1] = 0;
    state.pactStreak[0] = 5;
    state.pactStreak[1] = 5;

    // Slots 0 and 1 are the only players left, so a condominium would be a draw.
    const result = judge(state, map);
    expect(result?.kind).not.toBe('condominium');
  });

  it('lets a solo claim beat a shared one on the same turn', () => {
    // Nobody should ever settle for sharing a win they could take outright.
    const map = board();
    const state = scenario(map, {
      owner: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 3],
      armies: new Array(12).fill(2),
    });
    state.pactPartner[0] = 1;
    state.pactPartner[1] = 0;
    state.pactStreak[0] = 5;
    state.pactStreak[1] = 5;

    settle(state, map, 3);
    const result = judge(state, map);
    expect(result?.winners).toEqual([0]);
    expect(['domination', 'hegemony', 'decapitation']).toContain(result?.kind);
  });

  describe('concordat', () => {
    const rules: RuleConfig = { ...DEFAULT_RULES, concordatShare: 0.6, concordatWindow: 5 };

    function trio(): { map: GeneratedMap; state: GameState } {
      const map = board(5);
      const state = scenario(map, {
        owner: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 4, 4],
        armies: new Array(12).fill(2),
        turn: 6,
      });
      return { map, state };
    }

    it('requires all three pairs to have cooperated recently', () => {
      const { map, state } = trio();
      concord(state, 0, 1, 5);
      concord(state, 1, 2, 5);
      // The third pair never cooperated: the triangle is open.
      expect(checkVictory(state, map, rules)?.kind).not.toBe('concordat');

      concord(state, 0, 2, 5);
      const result = checkVictory(state, map, rules);
      expect(result?.kind).toBe('concordat');
      expect(result?.winners).toEqual([0, 1, 2]);
    });

    it('lets a stale cooperation lapse', () => {
      const { map, state } = trio();
      concord(state, 0, 1, 5);
      concord(state, 1, 2, 5);
      concord(state, 0, 2, 5);
      state.turn = 20; // far outside the window
      expect(checkVictory(state, map, rules)?.kind).not.toBe('concordat');
    });

    it('is voided permanently by a single betrayal inside the triangle', () => {
      // So it cannot be assembled at the end out of people you have crossed.
      const { map, state } = trio();
      concord(state, 0, 1, 5);
      concord(state, 1, 2, 5);
      concord(state, 0, 2, 5);
      state.betrayedBy[2][0] = 1;
      expect(checkVictory(state, map, rules)?.kind).not.toBe('concordat');
    });

    it('needs a table big enough for the trio to exclude somebody', () => {
      const small = board(3);
      const state = scenario(small, {
        owner: [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2],
        armies: new Array(12).fill(2),
        turn: 6,
      });
      concord(state, 0, 1, 5);
      concord(state, 1, 2, 5);
      concord(state, 0, 2, 5);

      expect(small.playerCount).toBeLessThan(MIN_CONCORDAT_PLAYERS);
      expect(checkVictory(state, small, rules)?.kind).not.toBe('concordat');
    });
  });
});

describe('the turn cap', () => {
  it('always produces a result with a full ranking', () => {
    const map = board();
    const rules: RuleConfig = { ...DEFAULT_RULES, turnCap: 5 };
    const state = scenario(map, {
      owner: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3],
      armies: [5, 1, 1, 4, 1, 1, 3, 1, 1, 2, 1, 1],
      turn: 5,
    });

    const result = judge(state, map, rules);
    expect(result?.kind).toBe('turn_cap');
    expect(result?.standings).toHaveLength(4);
    expect(new Set(result?.standings).size).toBe(4);
    expect(result?.winners.length).toBeGreaterThan(0);
  });
});
