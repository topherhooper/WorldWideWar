import { describe, expect, it } from 'vitest';

import { redact } from '../redact.js';
import { resolveTurn } from '../resolve.js';
import { TEST_RULES, lineMap, orders, scenario } from '../testing.js';
import { topicForTurn } from './topics.js';
import {
  applyTiersRecord,
  makeTiersList,
  normalizeItemText,
  normalizeTiersList,
  resolveTiers,
  scoreGuess,
  tiersWarnings,
} from './tiers.js';
import type { ContestContext } from './types.js';
import type { TiersList, TiersOrders } from '../types.js';

const IDENTITY = [0, 1, 2, 3, 4, 5];

const LIST: TiersList = {
  items: ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'], // true A→F
  shuffle: [3, 0, 5, 1, 4, 2], // public position p shows items[shuffle[p]]
};

function stateWithList() {
  const map = lineMap(4, 2);
  const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3] });
  state.tiersLists[0] = { items: [...LIST.items], shuffle: [...LIST.shuffle] };
  return state;
}

describe('tiers redaction', () => {
  it('authors see their own ordering', () => {
    const view = redact(stateWithList(), 0);
    expect(view.tiersLists[0]).toEqual(LIST);
  });

  it('rivals see items in public order with an identity shuffle', () => {
    const view = redact(stateWithList(), 1);
    expect(view.tiersLists[0]).toEqual({
      items: ['delta', 'alpha', 'foxtrot', 'bravo', 'echo', 'charlie'],
      shuffle: [0, 1, 2, 3, 4, 5],
    });
  });

  it('spectators get the public view too, and the ordering is hidden even without fog', () => {
    const state = stateWithList();
    expect(state.fogUntilTurn).toBe(0); // fog inactive — redaction must still apply
    const view = redact(state, null);
    expect(view.tiersLists[0]?.items[0]).toBe('delta');
    expect(JSON.stringify(view.tiersLists[0])).not.toContain('"shuffle":[3');
  });

  it('redaction never mutates the source state', () => {
    const state = stateWithList();
    redact(state, 1);
    expect(state.tiersLists[0]).toEqual(LIST);
  });
});

function context(state: ReturnType<typeof stateWithList>): ContestContext {
  const aliveSlots = [];
  for (let slot = 0; slot < state.playerCount; slot++) {
    if (state.status[slot] === 'active') aliveSlots.push(slot);
  }
  return {
    attacked: state.status.map(() => state.status.map(() => false)),
    aliveSlots,
    rules: { ...TEST_RULES, contest: 'tiers' },
  };
}

describe('normalizeTiersList', () => {
  it('accepts six distinct entries and preserves display text', () => {
    expect(normalizeTiersList(['A ', ' b', 'C', 'd', 'E', 'f'])).toEqual([
      'A',
      'b',
      'C',
      'd',
      'E',
      'f',
    ]);
  });

  it('rejects wrong length, blanks, oversize and normalized duplicates', () => {
    expect(normalizeTiersList(['a', 'b', 'c', 'd', 'e'])).toBeNull();
    expect(normalizeTiersList(['a', 'b', 'c', 'd', 'e', ' '])).toBeNull();
    expect(normalizeTiersList(['a', 'b', 'c', 'd', 'e', 'x'.repeat(61)])).toBeNull();
    expect(normalizeTiersList(["McDonald's", 'mcdonalds', 'c', 'd', 'e', 'f'])).toBeNull();
    expect(normalizeTiersList(null)).toBeNull();
    expect(normalizeTiersList('nope')).toBeNull();
  });

  it('normalizeItemText folds case, punctuation and spacing', () => {
    expect(normalizeItemText(" McDonald's ")).toBe('mcdonalds');
    expect(normalizeItemText('Café au lait')).toBe('cafeaulait');
  });
});

describe('scoreGuess', () => {
  const list = { items: ['a', 'b', 'c', 'd', 'e', 'f'], shuffle: [3, 0, 5, 1, 4, 2] };

  it('a perfect guess scores 12', () => {
    // Place true tier t: find public position p with shuffle[p] === t.
    const perfect = [1, 3, 5, 0, 4, 2];
    expect(scoreGuess(list, perfect)).toBe(12);
  });

  it('adjacent placements score 1 each', () => {
    // Swap tiers A and B relative to the perfect guess: two items land one off.
    expect(scoreGuess(list, [3, 1, 5, 0, 4, 2])).toBe(10);
  });

  it('an identity guess against an identity shuffle is perfect', () => {
    expect(scoreGuess({ items: list.items, shuffle: IDENTITY }, IDENTITY)).toBe(12);
  });
});

describe('resolveTiers', () => {
  function twoPlayerState() {
    const map = lineMap(4, 2);
    const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3] });
    state.tiersLists[0] = { items: ['a', 'b', 'c', 'd', 'e', 'f'], shuffle: [...IDENTITY] };
    state.tiersLists[1] = { items: ['u', 'v', 'w', 'x', 'y', 'z'], shuffle: [...IDENTITY] };
    return state;
  }

  const input = (guesses: TiersOrders['guesses']): TiersOrders => ({
    list: ['p', 'q', 'r', 's', 't', 'u'],
    guesses,
  });

  it('a perfect guess pays the guesser and the author', () => {
    const state = twoPlayerState();
    const out = resolveTiers(
      state,
      [input([{ target: 1, order: [...IDENTITY] }]), input([])],
      context(state),
    );
    // Guesser: 100 + (12 − 6) × 2 = 112. Author: 100 + max(0, 12 − 6) = 106.
    expect(out.multiplier[0]).toBe(112);
    expect(out.multiplier[1]).toBe(106);
    expect(out.results[0].guesses).toEqual([{ guesser: 0, target: 1, score: 12 }]);
    expect(out.results[1].bestRead).toEqual({ guesser: 0, target: 1, score: 12 });
    expect(out.results[0].revealed).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(out.bonusIncome).toEqual([0, 0]);
  });

  it('a wild guess hurts the guesser and never hurts the author', () => {
    const state = twoPlayerState();
    // Reverse order scores 2 (tiers 2 and 3 land adjacent), so 100 + (2−6)×2 = 92.
    const out = resolveTiers(
      state,
      [input([{ target: 1, order: [5, 4, 3, 2, 1, 0] }]), input([])],
      context(state),
    );
    expect(out.multiplier[0]).toBe(92);
    expect(out.multiplier[1]).toBe(100); // bad read is not the author's problem
  });

  it('abstaining is neutral and clamps hold at [80, 140]', () => {
    const state = twoPlayerState();
    const out = resolveTiers(state, [null, null], context(state));
    expect(out.multiplier[0]).toBe(100);
    const worst = resolveTiers(
      state,
      [
        input([{ target: 1, order: [5, 4, 3, 2, 1, 0] }]),
        input([{ target: 0, order: [5, 4, 3, 2, 1, 0] }]),
      ],
      context(state),
    );
    expect(Math.min(...worst.multiplier)).toBeGreaterThanOrEqual(80);
    expect(Math.max(...worst.multiplier)).toBeLessThanOrEqual(140);
  });

  it('drops invalid guesses: self, dead, listless, duplicate, bad permutation, overflow', () => {
    const map = lineMap(8, 4);
    const state = scenario(map, {
      owner: [0, 1, 2, 3, 0, 1, 2, 3],
      armies: [3, 3, 3, 3, 3, 3, 3, 3],
    });
    state.status[2] = 'eliminated';
    state.tiersLists[0] = { items: ['a', 'b', 'c', 'd', 'e', 'f'], shuffle: [...IDENTITY] };
    state.tiersLists[1] = { items: ['g', 'h', 'i', 'j', 'k', 'l'], shuffle: [...IDENTITY] };
    state.tiersLists[3] = { items: ['m', 'n', 'o', 'p', 'q', 'r'], shuffle: [...IDENTITY] };

    const out = resolveTiers(
      state,
      [
        input([
          { target: 0, order: [...IDENTITY] }, // self
          { target: 2, order: [...IDENTITY] }, // dead
          { target: 1, order: [0, 0, 1, 2, 3, 4] }, // not a permutation
          { target: 3, order: [...IDENTITY] }, // valid
          { target: 3, order: [...IDENTITY] }, // duplicate target
          { target: 1, order: [...IDENTITY] }, // over the 2-guess cap
        ]),
        null,
        null,
        null,
      ],
      context(state),
    );
    expect(out.results[0].guesses).toHaveLength(2); // target 3, then target 1
    expect(out.results[0].guesses.map((g) => g.target)).toEqual([3, 1]);
  });

  it('bestRead tie-breaks to the lowest guesser slot', () => {
    const map = lineMap(6, 3);
    const state = scenario(map, { owner: [0, 1, 2, 0, 1, 2], armies: [3, 3, 3, 3, 3, 3] });
    state.tiersLists[2] = { items: ['a', 'b', 'c', 'd', 'e', 'f'], shuffle: [...IDENTITY] };
    const out = resolveTiers(
      state,
      [
        input([{ target: 2, order: [...IDENTITY] }]),
        input([{ target: 2, order: [...IDENTITY] }]),
        input([]),
      ],
      context(state),
    );
    expect(out.results[2].bestRead?.guesser).toBe(0);
  });
});

describe('applyTiersRecord and makeTiersList', () => {
  it('installs normalized lists with a seeded shuffle, null for invalid or dead', () => {
    const map = lineMap(4, 2);
    const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3] });
    applyTiersRecord(
      state,
      [
        { list: ['a', 'b', 'c', 'd', 'e', 'f'], guesses: [] },
        { list: ['a', 'a', 'c', 'd', 'e', 'f'], guesses: [] }, // duplicate → invalid
      ],
      'seed-x',
      3,
    );
    const installed = state.tiersLists[0];
    expect(installed).not.toBeNull();
    expect([...(installed?.shuffle ?? [])].sort((a, b) => a - b)).toEqual(IDENTITY);
    expect(state.tiersLists[1]).toBeNull();
    // Deterministic given (seed, writeTurn, slot):
    expect(makeTiersList(['a', 'b', 'c', 'd', 'e', 'f'], 'seed-x', 3, 0)).toEqual(installed);
    // A different turn shuffles differently for the same seed and slot:
    expect(makeTiersList(['a', 'b', 'c', 'd', 'e', 'f'], 'seed-x', 4, 0)).not.toEqual(installed);
  });
});

describe('tiersWarnings', () => {
  it('flags a bad list and dropped guesses without throwing', () => {
    const map = lineMap(4, 2);
    const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3] });
    state.tiersLists[1] = { items: ['a', 'b', 'c', 'd', 'e', 'f'], shuffle: [...IDENTITY] };
    expect(tiersWarnings(state, 0, null)).toHaveLength(1);
    expect(
      tiersWarnings(state, 0, {
        list: ['a', 'b', 'c', 'd', 'e', 'f'],
        guesses: [{ target: 0, order: [...IDENTITY] }],
      }),
    ).toHaveLength(1);
    expect(
      tiersWarnings(state, 0, {
        list: ['a', 'b', 'c', 'd', 'e', 'f'],
        guesses: [{ target: 1, order: [...IDENTITY] }],
      }),
    ).toHaveLength(0);
  });
});

describe('resolveTurn under the tiers contest', () => {
  const rules = { ...TEST_RULES, contest: 'tiers' as const };

  function setup() {
    const map = lineMap(4, 2);
    const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3] });
    state.tiersLists[0] = { items: ['a', 'b', 'c', 'd', 'e', 'f'], shuffle: [0, 1, 2, 3, 4, 5] };
    state.tiersLists[1] = { items: ['u', 'v', 'w', 'x', 'y', 'z'], shuffle: [0, 1, 2, 3, 4, 5] };
    return { map, state };
  }

  const submission = (slot: number, target: number) => ({
    ...orders(slot),
    tiers: {
      list: ['1', '2', '3', '4', '5', '6'],
      guesses: [{ target, order: [0, 1, 2, 3, 4, 5] }],
    },
  });

  it('scores guesses, installs new lists, reveals the old ones and skips the pact', () => {
    const { map, state } = setup();
    const { next, report } = resolveTurn(state, [submission(0, 1), submission(1, 0)], {
      seed: 'seed-t',
      map,
      rules,
    });
    expect(report.pacts).toEqual([]);
    expect(report.tiers).toHaveLength(2);
    expect(report.tiers[0].guesses[0].score).toBe(12);
    expect(report.tiers[0].revealed).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(report.revealedTopic).toBe(topicForTurn('seed-t', 0).title);
    expect(next.tiersLists[0]?.items).toEqual(['1', '2', '3', '4', '5', '6']);
    // Pact bookkeeping untouched → pact-based victories can never fire.
    expect(next.pactPartner).toEqual([null, null]);
    expect(next.pactStreak).toEqual([0, 0]);
  });

  it('is deterministic and order-independent', () => {
    const { map, state } = setup();
    const context = { seed: 'seed-t', map, rules };
    const a = resolveTurn(state, [submission(0, 1), submission(1, 0)], context);
    const b = resolveTurn(state, [submission(0, 1), submission(1, 0)], context);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('structurally hostile tiers payloads never throw in resolution', () => {
    // The server stores order docs as the client sent them, so every field can
    // be any JSON shape. A throw here would abort the resolution transaction
    // and brick the game — the regression this test pins down.
    const hostile: unknown[] = [
      { list: ['1', '2', '3', '4', '5', '6'], guesses: 42 },
      { list: ['1', '2', '3', '4', '5', '6'], guesses: {} },
      { list: ['1', '2', '3', '4', '5', '6'], guesses: true },
      { list: 42, guesses: [{ target: 1, order: 42 }] },
      { list: { a: 1 }, guesses: [null, 42, 'x'] },
      42,
      true,
    ];
    for (const tiers of hostile) {
      const { map, state } = setup();
      expect(() =>
        resolveTurn(state, [{ ...orders(0), tiers: tiers as TiersOrders }, orders(1)], {
          seed: 'seed-t',
          map,
          rules,
        }),
      ).not.toThrow();
    }
  });

  it('tiersWarnings tolerates non-array guesses', () => {
    const map = lineMap(4, 2);
    const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3] });
    expect(() =>
      tiersWarnings(state, 0, {
        list: ['a', 'b', 'c', 'd', 'e', 'f'],
        guesses: 42 as unknown as TiersOrders['guesses'],
      }),
    ).not.toThrow();
  });

  it('pact games report an empty tiers array and a null topic', () => {
    const { map, state } = setup();
    const { report } = resolveTurn(state, [orders(0), orders(1)], {
      seed: 'seed-t',
      map,
      rules: TEST_RULES,
    });
    expect(report.tiers).toEqual([]);
    expect(report.revealedTopic).toBeNull();
  });
});

describe('income payout (tiers v2)', () => {
  const PERFECT = [1, 3, 5, 0, 4, 2]; // inverse of LIST.shuffle — scores 12
  const incomeContext = (): ContestContext => ({
    attacked: [
      [false, false],
      [false, false],
    ],
    aliveSlots: [0, 1],
    rules: { ...TEST_RULES, contest: 'tiers', tiersPayout: 'income' },
  });
  const guessInput = (order: number[]): TiersOrders => ({
    list: ['u', 'v', 'w', 'x', 'y', 'z'],
    guesses: [{ target: 0, order }],
  });

  it('a perfect read pays guesser and author in armies, multipliers stay flat', () => {
    const outcome = resolveTiers(stateWithList(), [null, guessInput(PERFECT)], incomeContext());
    expect(outcome.multiplier).toEqual([100, 100]);
    expect(outcome.bonusIncome[1]).toBe(3); // trunc((12 - 6) / 2)
    expect(outcome.bonusIncome[0]).toBe(3); // ceil((12 - 6) / 2) author bonus
    expect(outcome.results.find((r) => r.slot === 1)?.incomeDelta).toBe(3);
    expect(outcome.results.find((r) => r.slot === 0)?.incomeDelta).toBe(3);
  });

  it('a bad wager costs armies and the author earns nothing', () => {
    // Identity order scores 3 against LIST (one exact, one adjacent).
    const outcome = resolveTiers(stateWithList(), [null, guessInput(IDENTITY)], incomeContext());
    expect(outcome.multiplier).toEqual([100, 100]);
    expect(outcome.bonusIncome[1]).toBe(-1); // trunc((3 - 6) / 2)
    expect(outcome.bonusIncome[0]).toBe(0); // below neutral never pays the author
  });

  it('multiplier games report incomeDelta 0 and unchanged multipliers', () => {
    const outcome = resolveTiers(stateWithList(), [null, guessInput(PERFECT)], {
      attacked: [
        [false, false],
        [false, false],
      ],
      aliveSlots: [0, 1],
      rules: { ...TEST_RULES, contest: 'tiers' },
    });
    expect(outcome.multiplier[1]).toBe(112); // 100 + (12-6)*2 guess; nobody read slot 1
    expect(outcome.multiplier[0]).toBe(106); // 100 + author bonus max(0, 12-6)
    expect(outcome.results.every((r) => r.incomeDelta === 0)).toBe(true);
  });
});
