/**
 * Every move a guest can make, as one pure function.
 *
 * The prototype had eight HTTP handlers doing their own validation
 * (in the prototype). They collapse to one switch here for two reasons:
 * the server then has a single transaction shape, and every rule becomes
 * testable without an emulator.
 *
 * Nothing throws. A rejected action returns the state it was given plus a
 * reason, which the server hands back as a note — invalid input degrades, and
 * the guest still gets a sentence they can read.
 */

import {
  advanceParty,
  allVoicesSpoken,
  beginRound,
  burnCandle,
  ringBell,
  settleVote,
} from './clock.js';
import {
  canVote,
  guestAt,
  grownUps,
  minGrownUps,
  nominable,
  speakerFor,
  weightOf,
} from './rules.js';
import { cloneParty } from './state.js';
import { dealTale, makeLie } from './tale.js';
import { substream } from '../rng.js';
import type { PartyAction, PartyContext, PartyGuest, PartyResult, PartyState } from './types.js';

const reject = (state: PartyState, why: string): PartyResult => ({
  state,
  changed: false,
  rejected: why,
});

const accept = (state: PartyState): PartyResult => ({ state, changed: true, rejected: null });

/** Whether this seat may act for that guest. A dependent's seat speaks for them. */
const speaksFor = (state: PartyState, slot: number, guest: PartyGuest): boolean =>
  speakerFor(state, guest).slot === slot;

export function applyPartyAction(
  state: PartyState,
  action: PartyAction,
  ctx: PartyContext,
): PartyResult {
  switch (action.kind) {
    case 'deal':
      return applyDeal(state, ctx);
    case 'bell':
      return applyBell(state, ctx);
    case 'meet':
      return applyMeet(state, action.actor, action.target, action.lie, ctx);
    case 'confirm':
    case 'deny':
      return applyAnswer(state, action.kind, action.about, action.claimant, ctx);
    case 'sniff':
      return applySniff(state, action.actor, action.target, ctx);
    case 'nominate':
      return applyNominate(state, action.actor, action.suspect, ctx);
    case 'vote':
      return applyVote(state, action.actor, action.yes, ctx);
  }
}

function applyDeal(state: PartyState, ctx: PartyContext): PartyResult {
  if (!ctx.isHost) return reject(state, 'only the host deals');
  if (state.phase !== 'lobby') return reject(state, 'the roles are already dealt');
  const needed = minGrownUps(state.mode);
  if (grownUps(state).length < needed) {
    return reject(
      state,
      state.mode === 'together'
        ? 'somebody has to come to the party'
        : `a hunt needs at least ${needed} grown-ups — with two, the innocent one can never carry a vote`,
    );
  }
  return accept(dealTale(state, ctx.seed));
}

/**
 * The host's bell does two jobs: on the night it starts the party, and during a
 * round it closes mingling early rather than waiting the clock out.
 */
function applyBell(state: PartyState, ctx: PartyContext): PartyResult {
  if (!ctx.isHost) return reject(state, 'only the host rings the bell');
  const next = cloneParty(state);
  if (next.phase === 'invited') {
    beginRound(next, ctx.nowMs);
    return accept(next);
  }
  if (next.phase === 'mingle') {
    ringBell(next, ctx.nowMs);
    return accept(next);
  }
  if (next.phase === 'lobby') return reject(state, 'nothing is dealt yet');
  return reject(state, 'the bell has already rung');
}

function applyMeet(
  state: PartyState,
  actorId: number,
  targetId: number,
  wantsLie: boolean,
  ctx: PartyContext,
): PartyResult {
  if (state.phase !== 'mingle') {
    return reject(
      state,
      state.phase === 'vote' ? 'the bell has rung — the hall is voting' : 'nobody is mingling yet',
    );
  }
  const actor = guestAt(state, actorId);
  const target = guestAt(state, targetId);
  if (actor === null || target === null) return reject(state, 'nobody here by that name');
  if (!speaksFor(state, ctx.slot, actor)) return reject(state, 'that is not your guest to move');
  if (target.absent) return reject(state, `${target.name} went home before you arrived`);
  if (actor.id === target.id) return reject(state, 'you cannot meet yourself');
  if (target.broughtBy === actor.id) {
    return reject(state, 'they came with you — you are already a team');
  }
  if (actor.met.includes(target.id)) return reject(state, `you have already met ${target.name}`);
  if (target.claims.some((c) => c.from === actor.id)) {
    return reject(state, 'already waiting on them');
  }

  const next = cloneParty(state);
  const me = guestAt(next, actorId);
  const them = guestAt(next, targetId);
  if (me === null || them === null) return reject(state, 'nobody here by that name');

  let lie: string | null = null;
  if (wantsLie) {
    if (me.lies <= 0) return reject(state, 'you have no falsehoods left');
    lie = makeLie(next, ctx.seed);
    if (lie === null) return reject(state, 'there is nothing to lie about');
    me.lies -= 1;
  }
  them.claims.push({ from: me.id, lie });
  return accept(next);
}

/**
 * A guest says they met you; you say whether they did. A dependent never
 * answers for themselves — the guest who brought them vouches, which is what
 * makes a favour worth performing.
 */
function applyAnswer(
  state: PartyState,
  kind: 'confirm' | 'deny',
  aboutId: number,
  claimantId: number,
  ctx: PartyContext,
): PartyResult {
  const about = guestAt(state, aboutId);
  if (about === null) return reject(state, 'nobody here by that name');
  const speaker = speakerFor(state, about);
  if (speaker.slot !== ctx.slot) {
    return reject(state, `only ${speaker.name} can answer for ${about.name}`);
  }
  if (!about.claims.some((c) => c.from === claimantId)) return reject(state, 'no such claim');

  const next = cloneParty(state);
  const them = guestAt(next, aboutId);
  const claimant = guestAt(next, claimantId);
  if (them === null || claimant === null) return reject(state, 'no such claim');

  const claim = them.claims.find((c) => c.from === claimantId);
  them.claims = them.claims.filter((c) => c.from !== claimantId);
  if (kind === 'deny' || claim === undefined) return accept(next);

  if (!them.met.includes(claimant.id)) them.met.push(claimant.id);
  if (!claimant.met.includes(them.id)) claimant.met.push(them.id);
  // The encounter pays both sides a piece. The claimant's is always true; the
  // answerer's may be the falsehood the claimant rode in on.
  dealPiece(next, claimant, null, ctx.seed);
  dealPiece(next, them, claim.lie, ctx.seed);
  if (them.young && !them.curtsies.includes(claimant.id)) them.curtsies.push(claimant.id);
  return accept(next);
}

/**
 * Deal one piece the receiver does not already hold. Attribution is never
 * recorded — you are told you got something, not who from, which is what makes
 * a liar both possible and catchable.
 *
 * The draw is keyed on how much the guest already holds rather than on a
 * running counter, so a clock advance landing between two encounters cannot
 * shift the stream. A hand only grows, so the key is fresh by construction.
 */
function dealPiece(state: PartyState, to: PartyGuest, lie: string | null, seed: string): void {
  let piece;
  if (lie !== null) {
    piece = { text: lie, fake: true };
  } else {
    const held = new Set(to.pieces.map((p) => p.text));
    const fresh = state.deck.filter((p) => !held.has(p.text));
    if (fresh.length === 0) return;
    piece = { ...substream(seed, 'party', 'piece', to.id, to.pieces.length).pick(fresh) };
  }
  to.pieces.push(piece);

  // The Spinner's thread runs both ways: what reaches the child reaches the
  // grown-up. A copy, not a move — the child keeps theirs.
  if (to.duoId !== 'spinner' || !to.young || to.broughtBy === null) return;
  const grown = guestAt(state, to.broughtBy);
  if (grown === null || grown.pieces.some((p) => p.text === piece.text)) return;
  grown.pieces.push({ ...piece });
}

/**
 * The Huntsman's single question of the night, asked through the cub.
 *
 * Gated to a running round, which the prototype did not need to do: there the
 * deal and the first round were one action. Dealing days ahead means the
 * Huntsman could otherwise burn their one question on Tuesday, when no
 * falsehood has been told yet and the answer is permanently "smells nothing".
 */
function applySniff(
  state: PartyState,
  actorId: number,
  targetId: number,
  ctx: PartyContext,
): PartyResult {
  if (state.phase !== 'mingle' && state.phase !== 'vote') {
    return reject(state, 'not tonight — the cub sniffs once the party has started');
  }
  const actor = guestAt(state, actorId);
  const target = guestAt(state, targetId);
  if (actor === null || target === null) return reject(state, 'nobody here by that name');
  if (!speaksFor(state, ctx.slot, actor)) return reject(state, 'that is not your guest to move');
  if (actor.duoId !== 'huntsman' || actor.young) return reject(state, 'that is not your character');
  if (actor.sniff !== null) return reject(state, 'the cub has already sniffed tonight');

  const next = cloneParty(state);
  const me = guestAt(next, actorId);
  if (me === null) return reject(state, 'nobody here by that name');
  // Truthfully: has this guest ever handed over something untrue?
  me.sniff = { target: targetId, lied: targetId === next.culprit && target.lies < next.lieBudget };
  return accept(next);
}

function applyNominate(
  state: PartyState,
  actorId: number,
  suspectId: number,
  ctx: PartyContext,
): PartyResult {
  if (state.phase !== 'vote') return reject(state, 'nobody is naming anyone yet');
  if (state.nomination !== null) return reject(state, 'somebody is already on the floor');
  const actor = guestAt(state, actorId);
  const suspect = guestAt(state, suspectId);
  if (actor === null || suspect === null) return reject(state, 'nobody here by that name');
  if (!speaksFor(state, ctx.slot, actor)) return reject(state, 'that is not your guest to move');
  if (actor.young) return reject(state, 'a grown-up has to say it out loud');
  if (suspect.young) return reject(state, 'no child laid that curse');
  if (!nominable(state).some((g) => g.id === suspect.id)) {
    return reject(
      state,
      suspect.banished
        ? `${suspect.name} is already ruled out`
        : `${suspect.name} was never at the christening`,
    );
  }

  const next = cloneParty(state);
  next.nomination = { suspect: suspectId, by: actorId, votes: [], tally: null };
  next.lastResult = null;
  // Together: everyone is on the same side, so there is nothing to vote on. The
  // grown-ups have already argued it out loud; naming a courtier is the guess.
  if (next.mode === 'together') settleGuess(next, ctx.nowMs);
  return accept(next);
}

/**
 * A together party's accusation, settled on the spot.
 *
 * Right, and the curse breaks. Wrong, and that courtier is struck off the list
 * — which is real progress, not just a penalty — at the price of a candle. With
 * six suspects and three candles, guessing blind loses; reading the clues wins.
 */
function settleGuess(state: PartyState, nowMs: number): void {
  const nom = state.nomination;
  if (nom === null) return;
  const suspect = guestAt(state, nom.suspect);
  state.nomination = null;
  if (suspect === null) return;

  const right = suspect.id === state.culprit;
  state.lastResult = {
    suspect: nom.suspect,
    by: nom.by,
    tally: { yes: 0, total: 0, carried: right },
  };
  if (right) {
    state.phase = 'over';
    state.phaseEndsAt = null;
    state.outcome = 'the curse is broken — you named the one who laid it';
    return;
  }
  suspect.banished = true;
  state.banished.push(suspect.id);
  burnCandle(state, `${suspect.name} was not the one — a candle for the guess`);
  if (state.phase !== 'over') beginRound(state, nowMs);
}

function applyVote(
  state: PartyState,
  actorId: number,
  yes: boolean,
  ctx: PartyContext,
): PartyResult {
  if (state.mode === 'together') {
    return reject(state, 'nobody here laid the curse — naming a courtier is the guess');
  }
  if (state.phase !== 'vote' || state.nomination === null) {
    return reject(state, 'nothing on the floor');
  }
  const actor = guestAt(state, actorId);
  if (actor === null) return reject(state, 'nobody here by that name');
  if (!speaksFor(state, ctx.slot, actor)) return reject(state, 'that is not your guest to move');
  if (!canVote(actor)) {
    return reject(
      state,
      actor.young ? 'your grown-up carries your voice' : 'you have spent your last voice',
    );
  }
  if (state.nomination.votes.some((v) => v.guest === actorId)) {
    return reject(state, 'you have already spoken');
  }

  const next = cloneParty(state);
  if (next.nomination === null) return reject(state, 'nothing on the floor');
  next.nomination.votes.push({ guest: actorId, yes, weight: weightOf(actor) });
  if (allVoicesSpoken(next)) settleVote(next, ctx.nowMs);
  return accept(next);
}

export { advanceParty };
