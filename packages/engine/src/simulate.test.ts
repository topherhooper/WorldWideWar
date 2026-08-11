import { describe, expect, it } from 'vitest';
import { MIN_CONCORDAT_PLAYERS, MIN_CONDOMINIUM_PLAYERS, rulesFor } from './constants.js';
import { MAX_PLAYERS, MIN_PLAYERS } from './mapgen/generate.js';
import { hashValue } from './hash.js';
import { playBotGame } from './simulate.js';
import { territoryCount } from './supply.js';

const PLAYER_COUNTS = [2, 3, 4, 6, 8, 12];
/** Games per player count. The exhaustive sweep is the balance harness. */
const GAMES = Number(process.env.SIM_GAMES ?? 12);

function games(playerCount: number, prefix = 'suite') {
  return Array.from({ length: GAMES }, (_, i) =>
    playBotGame({ seed: `${prefix}-${playerCount}-${i}`, playerCount }),
  );
}

describe('a whole game, played by bots', () => {
  describe.each(PLAYER_COUNTS)('with %i players', (playerCount) => {
    const played = games(playerCount);

    it('always terminates within the turn cap', () => {
      // The design promise that a stalemate is not geometrically possible. The
      // storm shrinks the map until somebody has to be ahead.
      const cap = rulesFor(playerCount).turnCap;
      for (const summary of played) {
        expect(summary.turns).toBeLessThanOrEqual(cap);
        expect(summary.turns).toBeGreaterThan(0);
      }
    });

    it('always produces a well-formed result with no draws', () => {
      for (const summary of played) {
        expect(summary.result).not.toBeNull();
        expect(summary.result.standings).toHaveLength(playerCount);
        expect(new Set(summary.result.standings).size).toBe(playerCount);
        // Solo, a two-player condominium, or a three-player concordat.
        expect(summary.winners.length).toBeLessThanOrEqual(3);
        // A shared win must always leave somebody out, or it is a draw.
        if (summary.winners.length > 1) {
          const alive = summary.finalState.status.filter((s) => s === 'active').length;
          expect(summary.winners.length).toBeLessThan(Math.max(2, alive));
        }
      }
    });

    it('never shares a win outside the rules that permit one', () => {
      for (const summary of played) {
        if (summary.winners.length < 2) continue;
        const state = summary.finalState;

        if (summary.winners.length === 2) {
          expect(playerCount).toBeGreaterThanOrEqual(MIN_CONDOMINIUM_PLAYERS);
          // A condominium requires a standing mutual concord, read from both
          // sides — a forged one-sided record must never be enough.
          const [a, b] = summary.winners;
          if (summary.kind === 'condominium') {
            expect(state.pactPartner[a]).toBe(b);
            expect(state.pactPartner[b]).toBe(a);
            expect(state.pactStreak[a]).toBeGreaterThanOrEqual(
              rulesFor(playerCount).condominiumStreak,
            );
          }
          continue;
        }

        // A concordat needs a clean slate across the whole triangle.
        expect(playerCount).toBeGreaterThanOrEqual(MIN_CONCORDAT_PLAYERS);
        const [a, b, c] = summary.winners;
        for (const [x, y] of [
          [a, b],
          [b, c],
          [a, c],
        ]) {
          expect(state.betrayedBy[x][y]).toBe(0);
          expect(state.betrayedBy[y][x]).toBe(0);
          expect(state.concordAt[x][y]).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('reaches its ending through a route the rules define', () => {
      const routes = new Set([
        'conquest',
        'domination',
        'hegemony',
        'decapitation',
        'condominium',
        'concordat',
        'turn_cap',
      ]);
      for (const summary of played) expect(routes.has(summary.kind)).toBe(true);
    });

    it('leaves the board in a consistent state', () => {
      for (const summary of played) {
        const state = summary.finalState;
        for (let id = 0; id < state.armies.length; id++) {
          expect(state.armies[id]).toBeGreaterThanOrEqual(0);
          // Collapsed ground holds nothing and belongs to nobody.
          if (state.collapsed[id]) {
            expect(state.armies[id]).toBe(0);
            expect(state.owner[id]).toBeNull();
          }
        }
        for (let slot = 0; slot < playerCount; slot++) {
          if (state.status[slot] === 'active') continue;
          expect(territoryCount(state, slot)).toBe(0);
        }
      }
    });

    it('is exactly reproducible from its seed', () => {
      // The whole replay guarantee in one assertion.
      const summary = played[0];
      const replay = playBotGame({ seed: summary.seed, playerCount });
      expect(hashValue(replay.finalState)).toBe(hashValue(summary.finalState));
      expect(replay.turns).toBe(summary.turns);
      expect(replay.winners).toEqual(summary.winners);
    });

    it('actually fights', () => {
      // A game where nobody ever takes anything is not a strategy game. Guards
      // against the bots quietly turning pacifist after a tuning change.
      const fighting = played.filter((s) => s.territoriesCaptured > 0);
      expect(fighting.length).toBe(played.length);
      const median = played.map((s) => s.firstBloodTurn ?? 99).sort((a, b) => a - b)[
        Math.floor(played.length / 2)
      ];
      expect(median).toBeLessThanOrEqual(4);
    });

    it('forms pacts and sometimes breaks them', () => {
      const totals = played.reduce(
        (acc, s) => {
          acc.mutual +=
            s.pactOutcomes.concord +
            s.pactOutcomes.betrayal +
            s.pactOutcomes.betrayed +
            s.pactOutcomes.mutual_treachery;
          acc.broken += s.pactOutcomes.betrayal + s.pactOutcomes.mutual_treachery;
          return acc;
        },
        { mutual: 0, broken: 0 },
      );

      expect(totals.mutual).toBeGreaterThan(0);
      // Loose bounds here on purpose — the tight band is a balance-harness gate
      // over thousands of games, not something a dozen games can resolve.
      expect(totals.broken).toBeGreaterThan(0);
      expect(totals.broken / totals.mutual).toBeLessThan(0.7);
    });
  });
});

describe('player count support', () => {
  it('covers every advertised table size', () => {
    for (let players = MIN_PLAYERS; players <= MAX_PLAYERS; players++) {
      const summary = playBotGame({ seed: `cover-${players}`, playerCount: players });
      expect(summary.result).not.toBeNull();
      expect(summary.turns).toBeGreaterThan(0);
    }
  });

  it('never permits a shared win in a duel', () => {
    // "We both win" is a draw, and the design promises none.
    for (let i = 0; i < 40; i++) {
      const summary = playBotGame({ seed: `duel-${i}`, playerCount: 2 });
      expect(summary.winners.length).toBeLessThanOrEqual(1);
      expect(summary.kind).not.toBe('condominium');
    }
  });
});

describe('difficulty', () => {
  it('runs at every tier', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const summary = playBotGame({ seed: `diff-${difficulty}`, playerCount: 6, difficulty });
      expect(summary.result).not.toBeNull();
    }
  });
});
