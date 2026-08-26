/**
 * Cards, and the one genuinely interesting rule: what counts as a scoring run.
 *
 * Prototype code. Shortest path to the goal in ideas/sacre-card-game.md.
 */

export type Suit = 'C' | 'D' | 'H' | 'S';

export const SUITS: readonly Suit[] = ['C', 'D', 'H', 'S'];
export const RED: readonly Suit[] = ['D', 'H'];
export const BLACK: readonly Suit[] = ['C', 'S'];

/** 2..10 are themselves. 11=J, 12=Q, 13=K, 14=A. A joker has rank null. */
export interface Card {
  readonly id: string;
  readonly suit: Suit | null;
  readonly rank: number | null;
}

export function isJoker(c: Card): boolean {
  return c.rank === null;
}

/** Face cards and Aces all score 10; numbers score their number. */
export function value(rank: number): number {
  return rank <= 10 ? rank : 10;
}

/** Scoring value of a card in hand, for "equal or greater potential" comparisons. */
export function cardValue(c: Card): number {
  return c.rank === null ? 0 : value(c.rank);
}

const RANK_NAME: Record<number, string> = {
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

export function cardName(c: Card): string {
  if (c.rank === null) return 'Joker';
  return `${RANK_NAME[c.rank] ?? String(c.rank)}${c.suit}`;
}

/** The Ace loops: ...K, A, 2, 3... */
export function nextRank(r: number): number {
  return r === 14 ? 2 : r + 1;
}

/** 52 cards plus two jokers, in a fixed order. Shuffling is the caller's job. */
export function buildDeck(): Card[] {
  const out: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      out.push({ id: `${rank}${suit}`, suit, rank });
    }
  }
  out.push({ id: 'JOKER1', suit: null, rank: null });
  out.push({ id: 'JOKER2', suit: null, rank: null });
  return out;
}

export interface Run {
  readonly cards: readonly Card[];
  readonly points: number;
  readonly suit: Suit;
  readonly startRank: number;
}

export function runName(run: Run): string {
  return run.cards.map(cardName).join('-');
}

/**
 * The highest-scoring same-suit run of at least 3 in a hand, or null.
 *
 * Brute force over every suit, start rank and length -- 4 x 13 x 11 candidates,
 * which is nothing. Jokers substitute for a missing card at 0 points, so
 * preferring a real card at every position is always at least as good.
 */
export function bestRun(hand: readonly Card[]): Run | null {
  const jokers = hand.filter(isJoker);
  let best: Run | null = null;

  for (const suit of SUITS) {
    const bySuitRank = new Map<number, Card>();
    for (const c of hand) {
      if (c.suit === suit && c.rank !== null) bySuitRank.set(c.rank, c);
    }

    for (let start = 2; start <= 14; start++) {
      const picked: Card[] = [];
      let jokersUsed = 0;
      let points = 0;
      let rank = start;

      for (let len = 1; len <= 13; len++) {
        const real = bySuitRank.get(rank);
        if (real) {
          picked.push(real);
          points += value(rank);
        } else if (jokersUsed < jokers.length) {
          picked.push(jokers[jokersUsed]);
          jokersUsed += 1;
        } else {
          break;
        }
        rank = nextRank(rank);

        if (len >= 3 && (best === null || points > best.points)) {
          best = { cards: picked.slice(), points, suit, startRank: start };
        }
      }
    }
  }

  return best;
}
