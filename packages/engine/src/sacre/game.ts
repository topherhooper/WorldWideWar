/**
 * S.A.C.R.E. Bleu! -- eight rounds, five options, played by bots.
 *
 * Prototype. Hardcoded to the shortest path that reaches the goal in
 * ideas/sacre-card-game.md: a full game printed from a seed, reproducibly.
 * Pure: every draw comes from substream(), per the engine invariant.
 */

import { substream, type Rng } from '../rng.js';
import {
  BLACK,
  RED,
  bestRun,
  buildDeck,
  cardName,
  cardValue,
  isJoker,
  type Card,
  type Run,
  type Suit,
} from './cards.js';

/** Cards from pile 3 per player, by player count. Piles 1 and 2 always give 1 each. */
const PILE3_BY_PLAYERS: Record<number, number> = { 2: 13, 3: 10, 4: 8, 5: 7, 6: 6, 7: 5 };

export interface PlayerState {
  readonly seat: number;
  hand: Card[];
  score: number;
  /** Fewer than 3 cards: hand goes face-up and the player skips the rest. */
  out: boolean;
}

export interface SacreState {
  players: PlayerState[];
  /** Index 0 is the top of the deck. */
  deck: Card[];
  round: number;
  /** Seat that chose Cycle most recently, for the no-twice-in-a-row rule. */
  lastCycleSeat: number | null;
  /** Card ids revealed via Exchange, with the global turn index it happened on. */
  revealed: Map<string, number>;
  /** Global turn index, incremented once per taken turn. */
  turn: number;
  /** Per seat, the turn index of that seat's previous turn. */
  prevTurnOf: number[];
}

export function dealSize(players: number): number {
  return 2 + PILE3_BY_PLAYERS[players];
}

/** Split the deck into the four piles, deal, and shuffle the rest back together. */
export function setup(seed: string, players: number): SacreState {
  const rng = substream(seed, 'setup');
  const deck = buildDeck();

  const isHigh = (c: Card): boolean => c.rank !== null && c.rank >= 12;
  const pile1 = rng.shuffle(deck.filter((c) => isHigh(c) && RED.includes(c.suit as Suit)));
  const pile2 = rng.shuffle(deck.filter((c) => isHigh(c) && BLACK.includes(c.suit as Suit)));
  const pile3 = rng.shuffle(deck.filter((c) => c.rank !== null && c.rank <= 10));
  const pile4 = deck.filter((c) => c.rank === 11 || c.rank === null);

  const perPlayer = PILE3_BY_PLAYERS[players];
  const hands: Card[][] = [];
  for (let seat = 0; seat < players; seat++) {
    const hand = [pile1.shift() as Card, pile2.shift() as Card];
    for (let i = 0; i < perPlayer; i++) hand.push(pile3.shift() as Card);
    hands.push(hand);
  }

  return {
    players: hands.map((hand, seat) => ({ seat, hand, score: 0, out: false })),
    deck: rng.shuffle([...pile1, ...pile2, ...pile3, ...pile4]),
    round: 1,
    lastCycleSeat: null,
    revealed: new Map(),
    turn: 0,
    prevTurnOf: hands.map(() => -1),
  };
}

// --- bot taste ---------------------------------------------------------------

/** The suit the bot is collecting: the one its hand already has most value in. */
function targetSuit(hand: readonly Card[]): Suit {
  const totals = new Map<Suit, number>();
  for (const c of hand) {
    if (c.suit === null) continue;
    totals.set(c.suit, (totals.get(c.suit) ?? 0) + cardValue(c));
  }
  let best: Suit = 'C';
  let bestTotal = -1;
  for (const [suit, total] of totals) {
    if (total > bestTotal) {
      best = suit;
      bestTotal = total;
    }
  }
  return best;
}

/** Worst-first: off-suit before on-suit, low value before high, jokers last. */
function worstFirst(hand: readonly Card[], suit: Suit): Card[] {
  return hand.slice().sort((a, b) => {
    if (isJoker(a) !== isJoker(b)) return isJoker(a) ? 1 : -1;
    const onA = a.suit === suit ? 1 : 0;
    const onB = b.suit === suit ? 1 : 0;
    if (onA !== onB) return onA - onB;
    return cardValue(a) - cardValue(b);
  });
}

function leaderScoreExcluding(state: SacreState, seat: number): number {
  let best = 0;
  for (const p of state.players) {
    if (p.seat !== seat && p.score > best) best = p.score;
  }
  return best;
}

/**
 * "Scoring a sequence that precludes winning is not allowed."
 *
 * The cheap reading, not a solver: a Score that leaves you under 3 cards ends
 * your game, so it is only allowed if it also leaves you in front.
 */
export function scoreAllowed(state: SacreState, seat: number, run: Run): boolean {
  const p = state.players[seat];
  if (p.hand.length - run.cards.length >= 3) return true;
  return p.score + run.points > leaderScoreExcluding(state, seat);
}

function remove(hand: Card[], cards: readonly Card[]): void {
  for (const c of cards) {
    const i = hand.findIndex((h) => h.id === c.id);
    if (i >= 0) hand.splice(i, 1);
  }
}

// --- the five options --------------------------------------------------------

function doScore(state: SacreState, seat: number, run: Run): string {
  const p = state.players[seat];
  remove(p.hand, run.cards);
  p.score += run.points;
  return `Score ${run.cards.map(cardName).join('-')} = ${run.points} (total ${p.score})`;
}

function doAdvertise(state: SacreState, seat: number, rng: Rng): string {
  const p = state.players[seat];
  const suit = targetSuit(p.hand);
  const offer = worstFirst(p.hand, suit).find((c) => !isJoker(c));
  if (!offer) return 'Advertise: nothing to offer';

  const floor = cardValue(offer);
  const bids: { seat: number; card: Card }[] = [];
  for (const other of state.players) {
    if (other.seat === seat || other.out) continue;
    const eligible = other.hand.filter((c) => !isJoker(c) && cardValue(c) >= floor);
    if (eligible.length === 0) continue;
    // Everyone answers with their cheapest eligible card.
    const cheapest = eligible.reduce((a, b) => (cardValue(a) <= cardValue(b) ? a : b));
    bids.push({ seat: other.seat, card: cheapest });
  }
  if (bids.length === 0) return `Advertise ${cardName(offer)}: nobody could answer`;

  // The advertiser peeks at every face-down card, so it takes the best on offer.
  const pick = bids.reduce((a, b) => (cardValue(a.card) >= cardValue(b.card) ? a : b));
  const partner = state.players[pick.seat];
  remove(p.hand, [offer]);
  remove(partner.hand, [pick.card]);
  p.hand.push(pick.card);
  partner.hand.push(offer);
  void rng;
  return `Advertise ${cardName(offer)} -> swapped with P${pick.seat} for ${cardName(pick.card)}`;
}

function doCycle(state: SacreState, seat: number, quantity: number, offset: number): string {
  const participants = state.players.filter((p) => !p.out && p.hand.length >= quantity);
  if (participants.length < 2) return `Cycle ${quantity}: too few participants`;

  const passed = participants.map((p) => {
    const give = worstFirst(p.hand, targetSuit(p.hand)).slice(0, quantity);
    remove(p.hand, give);
    return give;
  });
  participants.forEach((p, i) => {
    const from = (i - offset + participants.length * 2) % participants.length;
    p.hand.push(...passed[from]);
  });
  state.lastCycleSeat = seat;
  return `Cycle ${quantity} card(s) ${offset} seat(s) left among ${participants.length} players`;
}

function doReturn(state: SacreState, seat: number, quantity: number): string {
  const p = state.players[seat];
  const give = worstFirst(p.hand, targetSuit(p.hand)).slice(0, quantity);
  remove(p.hand, give);
  state.deck.push(...give);

  if (state.round === 8) {
    // Round 8: search the deck and take whatever you like.
    const wanted: Card[] = [];
    for (let i = 0; i < quantity && state.deck.length > 0; i++) {
      const suit = targetSuit([...p.hand, ...wanted]);
      const scored = state.deck.map((c, idx) => ({
        idx,
        weight: cardValue(c) + (c.suit === suit ? 20 : 0) + (isJoker(c) ? 15 : 0),
      }));
      const best = scored.reduce((a, b) => (a.weight >= b.weight ? a : b));
      wanted.push(state.deck.splice(best.idx, 1)[0]);
    }
    p.hand.push(...wanted);
    return `Return ${quantity}, searched the deck for ${wanted.map(cardName).join(', ')}`;
  }

  const drawn = state.deck.splice(0, quantity);
  p.hand.push(...drawn);
  const short = drawn.length < quantity ? ` (deck only had ${drawn.length})` : '';
  return `Return ${quantity}, drew ${drawn.length}${short}`;
}

function doExchange(state: SacreState, seat: number): string {
  const p = state.players[seat];
  const others = state.players.filter((o) => o.seat !== seat && !o.out && o.hand.length > 0);
  if (others.length === 0) return 'Exchange: nobody to trade with';

  const target = others.reduce((a, b) => (a.hand.length >= b.hand.length ? a : b));
  const suit = targetSuit(p.hand);
  const give = worstFirst(p.hand, suit)[0];
  remove(p.hand, [give]);
  target.hand.push(give);

  // 8 or more after receiving: set 3 aside, out of reach for this Exchange.
  let aside: Card[] = [];
  if (target.hand.length >= 8) {
    aside = worstFirst(target.hand, targetSuit(target.hand)).slice(0, 3);
    remove(target.hand, aside);
  }

  const since = state.prevTurnOf[seat];
  const takeable = target.hand.filter((c) => (state.revealed.get(c.id) ?? -1) <= since);
  const pool = takeable.length > 0 ? takeable : target.hand;
  const take = pool.reduce((a, b) =>
    cardValue(a) + (a.suit === suit ? 20 : 0) >= cardValue(b) + (b.suit === suit ? 20 : 0) ? a : b,
  );
  remove(target.hand, [take]);
  p.hand.push(take);
  state.revealed.set(take.id, state.turn);
  target.hand.push(...aside);

  const blocked =
    takeable.length === 0 && target.hand.length > 0 ? ' (all cards were blocked)' : '';
  return `Exchange: gave ${cardName(give)} to P${target.seat}, took ${cardName(take)}${blocked}`;
}

// --- the bot -----------------------------------------------------------------

function maxCycleQuantity(players: number): number {
  return Math.ceil(dealSize(players) / 2);
}

function takeTurn(state: SacreState, seat: number, rng: Rng): string {
  const p = state.players[seat];
  const run = bestRun(p.hand);
  const canScore = run !== null && scoreAllowed(state, seat, run);
  const round8 = state.round === 8;

  // Round 8: everything is face-up, and Advertise/Return/Exchange earn a free
  // bonus Score afterwards -- so never spend the turn itself on Score.
  if (round8) {
    const line =
      state.deck.length > 0
        ? doReturn(state, seat, Math.min(3, p.hand.length))
        : doExchange(state, seat);
    const bonus = bestRun(p.hand);
    if (bonus && scoreAllowed(state, seat, bonus)) {
      return `${line}; bonus ${doScore(state, seat, bonus)}`;
    }
    return `${line}; no bonus run`;
  }

  // The document's own advice: don't Score in your first two turns.
  if (canScore && state.round >= 3 && run.points >= 24) {
    return doScore(state, seat, run);
  }

  const cycleBlocked =
    state.lastCycleSeat !== null && state.lastCycleSeat === lastActiveSeat(state, seat);
  const weak = run === null || run.points < 20;

  if (weak && state.deck.length > 0 && rng.int(3) > 0) {
    return doReturn(state, seat, Math.min(3, p.hand.length));
  }
  if (weak && !cycleBlocked && state.players.filter((x) => !x.out).length >= 3 && rng.bool()) {
    const quantity = 1 + rng.int(maxCycleQuantity(state.players.length));
    const offset = 1 + rng.int(Math.max(1, state.players.length - 1));
    return doCycle(state, seat, quantity, offset);
  }
  if (rng.bool()) return doAdvertise(state, seat, rng);
  return doExchange(state, seat);
}

/** The previous seat in turn order that still has more than 2 cards. */
function lastActiveSeat(state: SacreState, seat: number): number | null {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const s = (seat - step + n * 2) % n;
    if (state.players[s].hand.length > 2) return s;
  }
  return null;
}

export interface SacreResult {
  readonly lines: string[];
  readonly scores: number[];
  readonly winner: number;
}

export function playSacreGame(seed: string, players = 4): SacreResult {
  const state = setup(seed, players);
  const lines: string[] = [];

  lines.push(`S.A.C.R.E. Bleu! -- ${players} players, seed "${seed}"`);
  lines.push(`Dealt ${dealSize(players)} each; ${state.deck.length} cards left in the deck.`);
  for (const p of state.players) {
    lines.push(`  P${p.seat}: ${p.hand.map(cardName).join(' ')}`);
  }

  for (let round = 1; round <= 8; round++) {
    state.round = round;
    lines.push('');
    lines.push(`-- Round ${round}${round === 8 ? ' (face-up, no Cycle, bonus Score)' : ''} --`);

    for (let seat = 0; seat < players; seat++) {
      const p = state.players[seat];
      if (p.out) continue;

      const rng = substream(seed, 'turn', round, seat);
      const line = takeTurn(state, seat, rng);
      state.prevTurnOf[seat] = state.turn;
      state.turn += 1;

      if (p.hand.length < 3) {
        p.out = true;
        lines.push(`  P${seat}: ${line}  [under 3 cards -- face-up, out]`);
      } else {
        lines.push(`  P${seat}: ${line}`);
      }
    }
  }

  const scores = state.players.map((p) => p.score);
  // Ties go to the player latest in turn order.
  let winner = 0;
  for (let seat = 0; seat < players; seat++) {
    if (scores[seat] >= scores[winner]) winner = seat;
  }

  lines.push('');
  lines.push(`Final: ${scores.map((s, i) => `P${i}=${s}`).join('  ')}`);
  lines.push(`P${winner} wins. Everyone else: "Sacre bleu!"`);

  return { lines, scores, winner };
}
