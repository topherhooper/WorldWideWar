/**
 * The single choke point through which a party reaches a guest.
 *
 * This is `viewFor` from the prototype (`git show b298e05 -- prototypes`),
 * moved into the engine beside `redact.ts` and keyed on a seat rather than an
 * opaque token.
 * The property that matters is the one the prototype's own header claimed and
 * this must not lose: **it assembles, it does not filter.** Anything not
 * addressed to the viewer is never built, rather than built and stripped.
 *
 * Three things are visible to exactly one guest each, and each is an ability
 * rather than a leak: falsehoods show themselves to the Godmother, the hall
 * graph to the Nursemaid, and a falsehood budget to the curser alone.
 */

import {
  canVote,
  cursedSide,
  dependentsOf,
  guestAt,
  guestsOfSeat,
  hasWon,
  nominable,
  speakerFor,
  totalVoices,
  weightOf,
} from './rules.js';
import { duoById, FAVOURS } from './tale.js';
import type {
  Costume,
  DuoId,
  GuestId,
  PartyGuest,
  PartyMode,
  PartyPhase,
  PartyState,
  Tally,
} from './types.js';

export interface DuoCard {
  id: DuoId;
  name: string;
  blurb: string;
}

export interface RosterEntry {
  id: GuestId;
  name: string;
  young: boolean;
  /** A courtier who went home. They can be accused; they cannot be met. */
  absent: boolean;
  part: string | null;
  costume: Costume | null;
  /** How many grown-ups have knelt to this child. Their whole scoreboard. */
  curtsies: number | null;
  banished: boolean;
  /** Voices this guest speaks with; null for a child, who has none. */
  weight: number | null;
}

export interface MeetOption {
  id: GuestId;
  name: string;
  part: string | null;
  young: boolean;
  state: 'open' | 'pending' | 'met';
  /** What meeting them costs. Meeting a grown-up costs nothing but the walk. */
  favour: string | null;
  /** Who has to vouch for the encounter. */
  signer: string;
}

export interface PendingClaim {
  claimant: string;
  claimantId: GuestId;
  about: string;
  aboutId: GuestId;
  isChild: boolean;
  /** The errand the claimant owes this child before you confirm it. */
  favour: string | null;
}

/** A guest's own card. Everything here is addressed to them and nobody else. */
export interface GuestCard {
  id: GuestId;
  name: string;
  young: boolean;
  part: string | null;
  costume: Costume | null;
  duo: DuoCard | null;
  ally: { id: GuestId; name: string; part: string | null } | null;
  /**
   * Held pieces, unattributed. Nothing marks a falsehood — unless you are the
   * Godmother, whose whole character is being able to tell.
   */
  pieces: { text: string; fake: boolean | null }[];
  met: GuestId[];
  /** The Nursemaid watches the whole hall, not only her own evening. */
  hall: { id: GuestId; met: GuestId[] }[] | null;
  sniff: { target: GuestId; lied: boolean } | null;
  canMeet: MeetOption[];
  toConfirm: PendingClaim[];
  /** Only the curser is ever told they may lie, and only about their own budget. */
  lies: number;
  banished: boolean;
  weight: number;
  canVote: boolean;
  voted: boolean | null;
  nominable: GuestId[];
  /** What this guest owes, if they are a child. */
  favour: string | null;
  curtsies: GuestId[];
  /** Only ever set once the night is over. */
  won: boolean | null;
}

export interface NominationView {
  suspect: GuestId;
  by: GuestId;
  cast: number;
  total: number;
  waitingOn: GuestId[];
  tally: Tally | null;
}

export interface PartyView {
  mode: PartyMode;
  phase: PartyPhase;
  round: number;
  candles: number;
  maxCandles: number;
  /** The dials, so the lobby can show and edit what the evening will cost. */
  roundMinutes: number;
  voteSeconds: number;
  /** Epoch ms; the client counts down itself rather than being told a remainder. */
  phaseEndsAt: number | null;
  outcome: string | null;
  snuffed: string | null;
  banished: GuestId[];
  tale: { title: string; prompt: string } | null;
  roster: RosterEntry[];
  nomination: NominationView | null;
  lastResult: { suspect: GuestId; by: GuestId; tally: Tally } | null;
  /** Only once it is over: who the room was hunting, and who was with them. */
  culprit: GuestId | null;
  cursed: GuestId[] | null;
  /** Every guest this seat speaks for, the seat-holder first. Empty for a spectator. */
  cards: GuestCard[];
}

const TALE = {
  title: 'Sleeping Beauty',
  prompt:
    'Someone at this christening cursed the baby. Find out who before the last candle goes out.',
};

const favourText = (guest: PartyGuest, side: 'grown' | 'kid'): string | null =>
  guest.favour === null ? null : (FAVOURS[guest.favour]?.[side] ?? null);

const dealt = (state: PartyState): boolean => state.phase !== 'lobby';

/**
 * @param viewerSlot The seat receiving this view, or null for a spectator —
 *   anyone signed in who opened the link but has not taken a seat.
 */
export function redactParty(state: PartyState, viewerSlot: number | null): PartyView {
  const over = state.phase === 'over';

  const base: Omit<PartyView, 'cards'> = {
    mode: state.mode,
    phase: state.phase,
    round: state.round,
    candles: state.candles,
    maxCandles: Math.max(state.candlesLit, state.candles),
    roundMinutes: state.roundMinutes,
    voteSeconds: state.voteSeconds,
    phaseEndsAt: state.phaseEndsAt,
    outcome: state.outcome,
    snuffed: state.snuffed,
    banished: state.banished.slice(),
    tale: dealt(state) ? { ...TALE } : null,
    // Costumes are public on purpose: the puzzle is the culprit's costume, so
    // the guests have to be readable or there is nothing to deduce.
    roster: state.guests.map((g) => ({
      id: g.id,
      name: g.name,
      young: g.young,
      absent: g.absent,
      part: g.part,
      costume: g.costume,
      curtsies: g.young ? g.curtsies.length : null,
      banished: g.banished,
      weight: g.young ? null : weightOf(g),
    })),
    nomination:
      state.nomination === null
        ? null
        : {
            suspect: state.nomination.suspect,
            by: state.nomination.by,
            cast: state.nomination.votes.length,
            total: totalVoices(state),
            waitingOn: state.guests
              .filter((g) => canVote(g) && !state.nomination!.votes.some((v) => v.guest === g.id))
              .map((g) => g.id),
            tally: state.nomination.tally,
          },
    lastResult: state.lastResult,
    culprit: over ? state.culprit : null,
    cursed: over ? cursedSide(state) : null,
  };

  if (viewerSlot === null) return { ...base, cards: [] };
  return { ...base, cards: guestsOfSeat(state, viewerSlot).map((g) => cardFor(state, g)) };
}

function cardFor(state: PartyState, me: PartyGuest): GuestCard {
  const duo = duoById(me.duoId);
  const ally = me.broughtBy === null ? dependentsOf(state, me.id)[0] : guestAt(state, me.broughtBy);
  const mine = dependentsOf(state, me.id);

  // Everything waiting on this guest's word: encounters claimed against them,
  // plus encounters claimed against anyone they brought.
  const toConfirm: PendingClaim[] = [me, ...mine].flatMap((who) =>
    who.claims.map((claim) => ({
      claimant: guestAt(state, claim.from)?.name ?? 'somebody',
      claimantId: claim.from,
      about: who.name,
      aboutId: who.id,
      isChild: who.young,
      favour: who.young ? favourText(who, 'grown') : null,
    })),
  );

  // Who you may still go and meet: everyone but yourself, anyone you brought,
  // and anyone you have already met or already claimed.
  const canMeet: MeetOption[] =
    state.phase === 'mingle'
      ? state.guests
          .filter((g) => !g.absent && g.id !== me.id && g.broughtBy !== me.id)
          .map((g) => ({
            id: g.id,
            name: g.name,
            part: g.part,
            young: g.young,
            state: me.met.includes(g.id)
              ? ('met' as const)
              : g.claims.some((c) => c.from === me.id)
                ? ('pending' as const)
                : ('open' as const),
            favour: g.young ? favourText(g, 'grown') : null,
            signer: speakerFor(state, g).name,
          }))
      : [];

  return {
    id: me.id,
    name: me.name,
    young: me.young,
    part: me.part,
    costume: me.costume,
    duo:
      duo === null
        ? null
        : { id: duo.id, name: duo.name, blurb: me.young ? duo.kidBlurb : duo.grownBlurb },
    ally:
      ally === undefined || ally === null
        ? null
        : { id: ally.id, name: ally.name, part: ally.part },
    // A child's screen carries no load-bearing text, and never any pieces: the
    // Spinner's thread reaches the grown-up by copying into *their* hand, which
    // is a different mechanism and survives this untouched.
    pieces: me.young
      ? []
      : me.pieces.map((p) => ({ text: p.text, fake: me.duoId === 'godmother' ? p.fake : null })),
    met: me.met.slice(),
    hall:
      me.duoId === 'nursemaid' && !me.young && dealt(state)
        ? state.guests
            .filter((g) => g.met.length > 0)
            .map((g) => ({ id: g.id, met: g.met.slice() }))
        : null,
    sniff: me.sniff,
    canMeet,
    toConfirm,
    lies: me.lies,
    banished: me.banished,
    weight: weightOf(me),
    canVote: canVote(me),
    voted:
      state.nomination === null
        ? null
        : (state.nomination.votes.find((v) => v.guest === me.id)?.yes ?? null),
    nominable: state.phase === 'vote' ? nominable(state).map((g) => g.id) : [],
    favour: me.young ? favourText(me, 'kid') : null,
    curtsies: me.curtsies.slice(),
    won: hasWon(state, me),
  };
}
