/**
 * Building a party, and copying one.
 *
 * The clone exists for the same reason `cloneState` does in `setup.ts`: an
 * action that fails half-way must leave the caller holding the state it started
 * with, so re-running it is safe rather than merely careful. It is written out
 * by hand rather than round-tripped through JSON so the compiler complains when
 * a field is added to `PartyState` and forgotten here.
 */

import { CANDLES, ROUND_MINUTES, VOTE_SECONDS } from './constants.js';
import type {
  Claim,
  GuestId,
  Nomination,
  PartyGuest,
  PartyState,
  Piece,
  VoteResult,
} from './types.js';

export interface NewGuest {
  name: string;
  young: boolean;
  slot: number;
  /** The guest who brought them, or null for whoever holds the seat. */
  broughtBy: GuestId | null;
}

export interface PartyOptions {
  roundMinutes?: number;
  voteSeconds?: number;
  candles?: number;
}

/** A party with nobody in it yet. Guests arrive by taking seats. */
export function createPartyState(hostSlot: number, options: PartyOptions = {}): PartyState {
  return {
    formatVersion: 1,
    tale: 'sleeping-beauty',
    phase: 'lobby',
    round: 0,
    phaseEndsAt: null,
    roundMinutes: options.roundMinutes ?? ROUND_MINUTES,
    voteSeconds: options.voteSeconds ?? VOTE_SECONDS,
    candles: options.candles ?? CANDLES,
    snuffed: null,
    outcome: null,
    guests: [],
    hostSlot,
    culprit: null,
    lieBudget: 0,
    deck: [],
    nomination: null,
    lastResult: null,
    banished: [],
  };
}

/** Append a guest. Their id is their index, and never changes afterwards. */
export function addGuest(state: PartyState, guest: NewGuest): PartyGuest {
  const added: PartyGuest = {
    id: state.guests.length,
    name: guest.name,
    young: guest.young,
    slot: guest.slot,
    broughtBy: guest.broughtBy,
    part: null,
    duoId: null,
    costume: null,
    favour: null,
    pieces: [],
    met: [],
    claims: [],
    curtsies: [],
    sniff: null,
    lies: 0,
    banished: false,
    lastVoteSpent: false,
  };
  state.guests.push(added);
  return added;
}

/**
 * Drop a seat's whole party — the guest who booked and everyone they brought.
 *
 * Ids are indices, so this renumbers, which is only safe before the tale is
 * dealt: afterwards half the state points at guests by id. The lobby is the
 * only caller, and it is not optional. A guest who RSVPs and does not come is
 * otherwise dealt a character, holds pieces the room needs to finish the
 * puzzle, and carries a vote nobody can cast.
 */
export function removeSeat(state: PartyState, slot: number): PartyState {
  if (state.phase !== 'lobby') return state;
  const kept = state.guests.filter((g) => g.slot !== slot);
  const renumbered = new Map<GuestId, GuestId>();
  kept.forEach((g, i) => renumbered.set(g.id, i));
  return {
    ...state,
    guests: kept.map((g, i) => ({
      ...g,
      id: i,
      broughtBy: g.broughtBy === null ? null : (renumbered.get(g.broughtBy) ?? null),
    })),
  };
}

const clonePiece = (piece: Piece): Piece => ({ ...piece });
const cloneClaim = (claim: Claim): Claim => ({ from: claim.from, lie: claim.lie });

function cloneGuest(guest: PartyGuest): PartyGuest {
  return {
    ...guest,
    costume: guest.costume === null ? null : { ...guest.costume },
    pieces: guest.pieces.map(clonePiece),
    met: guest.met.slice(),
    claims: guest.claims.map(cloneClaim),
    curtsies: guest.curtsies.slice(),
    sniff: guest.sniff === null ? null : { ...guest.sniff },
  };
}

const cloneNomination = (nom: Nomination): Nomination => ({
  suspect: nom.suspect,
  by: nom.by,
  votes: nom.votes.map((v) => ({ ...v })),
  tally: nom.tally === null ? null : { ...nom.tally },
});

const cloneResult = (result: VoteResult): VoteResult => ({
  suspect: result.suspect,
  by: result.by,
  tally: { ...result.tally },
});

export function cloneParty(state: PartyState): PartyState {
  return {
    ...state,
    guests: state.guests.map(cloneGuest),
    deck: state.deck.map(clonePiece),
    nomination: state.nomination === null ? null : cloneNomination(state.nomination),
    lastResult: state.lastResult === null ? null : cloneResult(state.lastResult),
    banished: state.banished.slice(),
  };
}
