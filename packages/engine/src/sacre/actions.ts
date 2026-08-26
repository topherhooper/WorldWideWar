/**
 * The five options, plus the two answers other seats give.
 *
 * Every function takes a state and returns one. Invalid input degrades: a bad
 * action comes back unchanged with a sentence the player can read, never a
 * throw. That matters more here than in the war game, because a stale tab in a
 * live room will post a card that left the hand two turns ago.
 */

import { cardName, cardValue, isJoker, type Card } from './cards.js';
import { checkRun, cycleAllowed, eligibleFor, extendsScored, scoreForeclosesWin } from './rules.js';
import {
  MIN_HAND,
  findCard,
  maxCycleQuantity,
  removeCards,
  richestSuit,
  worstFirst,
} from './state.js';
import type {
  PendingAdvertise,
  PendingCycle,
  SacreAction,
  SacreContext,
  SacreResultState,
  SacreState,
  Slot,
} from './types.js';

const no = (state: SacreState, message: string): SacreResultState => ({
  state,
  changed: false,
  message,
});

const say = (state: SacreState, line: string): string[] => [...state.log, line].slice(-60);

/** Under 3 cards ends your game -- hand face-up, no more turns. */
function retire(state: SacreState): SacreState {
  return {
    ...state,
    players: state.players.map((p) =>
      !p.out && p.hand.length < MIN_HAND ? { ...p, out: true } : p,
    ),
  };
}

// --- Score --------------------------------------------------------------------

export function score(state: SacreState, slot: Slot, ids: string[]): SacreResultState {
  const player = state.players[slot];
  const cards = ids
    .map((id) => findCard(player.hand, id))
    .filter((c): c is Card => c !== undefined);
  if (cards.length !== ids.length) return no(state, 'Those cards are not all in your hand.');

  const run = checkRun(cards);
  if (!run.ok) return no(state, run.why ?? 'That is not a sequence.');
  if (extendsScored(player, run.suit as never, run.ranks)) {
    return no(state, 'That would extend a sequence you already scored.');
  }
  if (scoreForeclosesWin(state, slot, cards.length, run.points)) {
    return no(state, 'That would end your game without putting you in front.');
  }

  const players = state.players.map((p) =>
    p.slot === slot
      ? {
          ...p,
          hand: removeCards(p.hand, ids),
          score: p.score + run.points,
          scored: [...p.scored, { suit: run.suit as never, ranks: run.ranks, points: run.points }],
        }
      : p,
  );
  const line = `P${slot} scored ${cards.map(cardName).join('-')} for ${run.points}.`;
  return { state: retire({ ...state, players, log: say(state, line) }), changed: true };
}

// --- Advertise ----------------------------------------------------------------

export function advertise(state: SacreState, slot: Slot, id: string): SacreResultState {
  const player = state.players[slot];
  const offered = findCard(player.hand, id);
  if (!offered) return no(state, 'That card is not in your hand.');
  if (isJoker(offered)) return no(state, 'You cannot advertise a Joker.');

  const floor = cardValue(offered);
  const owed = state.players
    .filter((p) => p.slot !== slot && !p.out && p.hand.length > 0)
    .map((p) => p.slot);
  if (owed.length === 0) return no(state, 'There is nobody to trade with.');

  const pending: PendingAdvertise = {
    kind: 'advertise',
    by: slot,
    offered,
    floor,
    responses: [],
    passed: [],
    owed,
  };
  const players = state.players.map((p) =>
    p.slot === slot ? { ...p, hand: removeCards(p.hand, [id]) } : p,
  );
  const line = `P${slot} advertised ${cardName(offered)}. Everyone owes a card worth ${floor} or more.`;
  return {
    state: { ...state, players, pending, turnPhase: 'awaiting', log: say(state, line) },
    changed: true,
  };
}

/** One seat's face-down answer to an Advertise. */
export function respond(state: SacreState, slot: Slot, id: string): SacreResultState {
  const pending = state.pending;
  if (pending?.kind !== 'advertise') return no(state, 'Nobody is advertising.');
  if (!pending.owed.includes(slot)) return no(state, 'You do not owe a card.');

  const player = state.players[slot];
  const card = findCard(player.hand, id);
  if (!card) return no(state, 'That card is not in your hand.');
  if (isJoker(card)) return no(state, 'A Joker cannot answer an advertisement.');
  if (cardValue(card) < pending.floor) {
    return no(state, `That card is worth less than ${pending.floor}.`);
  }

  return {
    state: {
      ...state,
      pending: {
        ...pending,
        responses: [...pending.responses, { slot, card }],
        owed: pending.owed.filter((s) => s !== slot),
      },
    },
    changed: true,
  };
}

/**
 * A seat with nothing eligible proves it instead of answering.
 *
 * The rules have them reveal their hand privately to the advertiser. That is a
 * genuine one-to-one disclosure, and it is why `redactSacre` takes a viewer.
 */
export function proveEmpty(state: SacreState, slot: Slot): SacreResultState {
  const pending = state.pending;
  if (pending?.kind !== 'advertise') return no(state, 'Nobody is advertising.');
  if (!pending.owed.includes(slot)) return no(state, 'You do not owe a card.');
  if (eligibleFor(state.players[slot].hand, pending.floor).length > 0) {
    return no(state, 'You do have a card that answers.');
  }
  return {
    state: {
      ...state,
      pending: {
        ...pending,
        passed: [...pending.passed, slot],
        owed: pending.owed.filter((s) => s !== slot),
      },
    },
    changed: true,
  };
}

/** The advertiser picks a partner, or the clock picks for them. */
export function settleAdvertise(state: SacreState, choice: Slot | null): SacreState {
  const pending = state.pending;
  if (pending?.kind !== 'advertise') return state;

  if (pending.responses.length === 0) {
    // Nobody could answer: the offered card simply comes home.
    const players = state.players.map((p) =>
      p.slot === pending.by ? { ...p, hand: [...p.hand, pending.offered] } : p,
    );
    const line = `Nobody could answer P${pending.by}.`;
    return { ...state, players, pending: null, log: say(state, line) };
  }

  const picked =
    pending.responses.find((r) => r.slot === choice) ??
    pending.responses.reduce((a, b) => (cardValue(a.card) >= cardValue(b.card) ? a : b));

  const players = state.players.map((p) => {
    if (p.slot === pending.by) return { ...p, hand: [...p.hand, picked.card] };
    if (p.slot === picked.slot) {
      return { ...p, hand: [...removeCards(p.hand, [picked.card.id]), pending.offered] };
    }
    return p;
  });
  const line = `P${pending.by} swapped ${cardName(pending.offered)} with P${picked.slot} for ${cardName(picked.card)}.`;
  return retire({ ...state, players, pending: null, log: say(state, line) });
}

// --- Cycle --------------------------------------------------------------------

export function cycle(
  state: SacreState,
  slot: Slot,
  quantity: number,
  offset: number,
): SacreResultState {
  const allowed = cycleAllowed(state, slot);
  if (!allowed.ok) return no(state, allowed.why as string);

  const max = maxCycleQuantity(state.players.length);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) {
    return no(state, `Cycle moves between 1 and ${max} cards.`);
  }
  const participants = state.players
    .filter((p) => !p.out && p.hand.length >= quantity)
    .map((p) => p.slot);
  if (participants.length < 2) return no(state, 'Not enough players hold that many cards.');

  const span = participants.length;
  if (!Number.isInteger(offset) || offset < 1 || offset >= span) {
    return no(state, `Pick between 1 and ${span - 1} seats to the left.`);
  }

  const pending: PendingCycle = {
    kind: 'cycle',
    by: slot,
    quantity,
    offset,
    participants,
    passes: [],
    owed: participants.slice(),
  };
  const line = `P${slot} called Cycle: ${quantity} card(s), ${offset} seat(s) left.`;
  return {
    state: {
      ...state,
      pending,
      turnPhase: 'awaiting',
      lastCycleSlot: slot,
      log: say(state, line),
    },
    changed: true,
  };
}

export function pass(state: SacreState, slot: Slot, ids: string[]): SacreResultState {
  const pending = state.pending;
  if (pending?.kind !== 'cycle') return no(state, 'Nobody has called a cycle.');
  if (!pending.owed.includes(slot)) return no(state, 'You are not passing.');
  if (ids.length !== pending.quantity) return no(state, `Pass exactly ${pending.quantity}.`);

  const hand = state.players[slot].hand;
  const cards = ids.map((id) => findCard(hand, id)).filter((c): c is Card => c !== undefined);
  if (cards.length !== ids.length) return no(state, 'Those cards are not all in your hand.');

  return {
    state: {
      ...state,
      pending: {
        ...pending,
        passes: [...pending.passes, { slot, cards }],
        owed: pending.owed.filter((s) => s !== slot),
      },
    },
    changed: true,
  };
}

/**
 * Everyone passes at once.
 *
 * Recipients are counted along the ring of participants, not of seats, which is
 * what the rules mean by skipping past a player who is sitting the cycle out.
 */
export function settleCycle(state: SacreState): SacreState {
  const pending = state.pending;
  if (pending?.kind !== 'cycle') return state;

  const given = new Map<Slot, Card[]>();
  for (const slot of pending.participants) {
    const found = pending.passes.find((p) => p.slot === slot);
    given.set(slot, found ? found.cards : []);
  }

  const hands = new Map(state.players.map((p) => [p.slot, p.hand.slice()]));
  for (const [slot, cards] of given) {
    hands.set(
      slot,
      removeCards(
        hands.get(slot) as Card[],
        cards.map((c) => c.id),
      ),
    );
  }
  pending.participants.forEach((slot, i) => {
    const from = pending.participants[(i - pending.offset + span(pending)) % span(pending)];
    hands.set(slot, [...(hands.get(slot) as Card[]), ...(given.get(from) as Card[])]);
  });

  const players = state.players.map((p) => ({ ...p, hand: hands.get(p.slot) as Card[] }));
  const line = `${pending.participants.length} players passed ${pending.quantity} card(s).`;
  return retire({ ...state, players, pending: null, log: say(state, line) });
}

const span = (pending: PendingCycle): number => pending.participants.length;

// --- Return -------------------------------------------------------------------

export function returnCards(
  state: SacreState,
  slot: Slot,
  ids: string[],
  want: string[] = [],
): SacreResultState {
  const player = state.players[slot];
  if (ids.length === 0) return no(state, 'Choose at least one card to return.');
  const cards = ids
    .map((id) => findCard(player.hand, id))
    .filter((c): c is Card => c !== undefined);
  if (cards.length !== ids.length) return no(state, 'Those cards are not all in your hand.');

  const deck = [...state.deck, ...cards];
  let taken: Card[];

  if (state.round === 8) {
    // Round 8: everything is face-up, so this is a search rather than a draw.
    taken = [];
    for (const id of want.slice(0, ids.length)) {
      const i = deck.findIndex((c) => c.id === id);
      if (i >= 0) taken.push(...deck.splice(i, 1));
    }
    while (taken.length < ids.length && deck.length > 0) taken.push(deck.shift() as Card);
  } else {
    taken = deck.splice(0, ids.length);
  }

  const players = state.players.map((p) =>
    p.slot === slot ? { ...p, hand: [...removeCards(p.hand, ids), ...taken] } : p,
  );
  const verb = state.round === 8 ? 'searched the deck for' : 'drew';
  const line = `P${slot} returned ${ids.length} and ${verb} ${taken.length}.`;
  return { state: retire({ ...state, players, deck, log: say(state, line) }), changed: true };
}

// --- Exchange -----------------------------------------------------------------

export function exchange(
  state: SacreState,
  slot: Slot,
  target: Slot,
  id: string,
): SacreResultState {
  const me = state.players[slot];
  const them = state.players[target];
  if (!them || target === slot || them.out) return no(state, 'Pick another player still in.');

  const give = findCard(me.hand, id);
  if (!give) return no(state, 'That card is not in your hand.');

  // After receiving, a hand of 8 or more sets 3 aside, out of reach.
  const theirHand = [...them.hand, give];
  const aside =
    theirHand.length >= 8 ? worstFirst(theirHand, richestSuit(theirHand)).slice(0, 3) : [];
  const reachable = removeCards(
    theirHand,
    aside.map((c) => c.id),
  );

  const since = state.prevTurnOf[slot];
  const takeable = reachable.filter((c) => (state.revealed[c.id] ?? -1) <= since);
  const pool = takeable.length > 0 ? takeable : reachable;
  if (pool.length === 0) return no(state, 'They have nothing you can take.');

  const suit = richestSuit(me.hand);
  const take = pool.reduce((a, b) =>
    cardValue(a) + (a.suit === suit ? 20 : 0) >= cardValue(b) + (b.suit === suit ? 20 : 0) ? a : b,
  );

  const players = state.players.map((p) => {
    if (p.slot === slot) return { ...p, hand: [...removeCards(p.hand, [id]), take] };
    if (p.slot === target) return { ...p, hand: removeCards(theirHand, [take.id]) };
    return p;
  });
  const line = `P${slot} gave P${target} a card and took ${cardName(take)}.`;
  return {
    state: retire({
      ...state,
      players,
      revealed: { ...state.revealed, [take.id]: state.turn },
      log: say(state, line),
    }),
    changed: true,
  };
}

// --- one door -----------------------------------------------------------------

export function applySacreAction(
  state: SacreState,
  action: SacreAction,
  ctx: SacreContext,
): SacreResultState {
  const slot = ctx.slot;
  if (slot === null) return no(state, 'You are watching, not playing.');
  if (state.phase !== 'playing') return no(state, 'The game is not running.');
  if (state.players[slot]?.out) return no(state, 'You are out of cards.');

  // Answers to a pending come from the seats that owe one, not the active seat.
  if (action.type === 'respond') return respond(state, slot, action.card);
  if (action.type === 'pass') return pass(state, slot, action.cards);

  if (state.turnPhase === 'awaiting') {
    if (state.pending?.kind === 'advertise' && state.pending.by === slot) {
      return no(state, 'Wait for everyone to answer.');
    }
    return no(state, 'Wait for the table.');
  }
  if (state.active !== slot) return no(state, 'It is not your turn.');

  switch (action.type) {
    case 'score':
      return score(state, slot, action.cards);
    case 'advertise':
      return advertise(state, slot, action.card);
    case 'cycle':
      return cycle(state, slot, action.quantity, action.offset);
    case 'return':
      return returnCards(state, slot, action.cards, action.want ?? []);
    case 'exchange':
      return exchange(state, slot, action.target, action.card);
    default:
      return no(state, 'That is not something you can do.');
  }
}
