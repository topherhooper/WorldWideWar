/**
 * Sleeping Beauty, as an assembly puzzle.
 *
 * The truth is a single culprit. Every guest wears a public costume — gown,
 * gift, place at the christening — and the clues constrain the culprit's
 * costume rather than naming anyone. Pin all three attributes and exactly one
 * guest is left, because costumes are dealt distinct. That is what makes it
 * solvable by talking rather than by luck.
 *
 * Ported from `prototypes/dinner-party/tale.mjs`, where every shuffle read
 * `Math.random()`. Here each draws from a named substream, so a party replays
 * exactly and adding a draw to one step cannot silently shift another.
 */

import { substream } from '../rng.js';
import type { Rng } from '../rng.js';
import { cloneParty } from './state.js';
import { children, dependentsOf, grownUps, guestAt } from './rules.js';
import type { Costume, Duo, Favour, PartyGuest, PartyState, Piece } from './types.js';

const GOWNS = ['green', 'gold', 'crimson', 'silver'];
const GIFTS = ['a spindle', 'a white rose', 'a songbird', 'a silver mirror'];
const PLACES = [
  'by the cradle',
  'by the window',
  'at the great door',
  'in the shadow of the throne',
];

/**
 * What a grown-up must do to get a clue out of a child. The child is the lock.
 * Two phrasings, because the same errand has to read right from both mouths.
 */
export const FAVOURS: readonly Favour[] = [
  { grown: 'bow low and call them Your Majesty', kid: 'bow low and call you Your Majesty' },
  {
    grown: 'ask their permission to sit at the feast',
    kid: 'ask your permission to sit at the feast',
  },
  { grown: 'let them knight you with a spoon', kid: 'let you knight them with a spoon' },
  {
    grown: 'tell them their crown is the finest in the kingdom',
    kid: 'say your crown is the finest in the kingdom',
  },
  { grown: 'ask them to teach you the royal wave', kid: 'ask you to teach them the royal wave' },
  { grown: 'promise to slay a dragon for them', kid: 'promise to slay a dragon for you' },
];

/**
 * A grown-up who brought a child is not two guests, they are one character with
 * two halves and an ability neither half has alone. The child's half is always
 * something to *be* and *do*; the grown-up's half is the part that reads.
 *
 * Each ability is built from state the game already tracked, so four distinct
 * characters needed no new machinery.
 */
export const DUOS: readonly Duo[] = [
  {
    id: 'godmother',
    name: 'The Godmother and her Godchild',
    grown: 'The Godmother',
    kid: 'The Godchild',
    grownBlurb: 'Any falsehood that reaches your own hand shows itself to you, and to nobody else.',
    kidBlurb:
      'Every grown-up who kneels to you makes your Godmother stronger when everyone argues.',
  },
  {
    id: 'huntsman',
    name: 'The Huntsman and the Wolf-Cub',
    grown: 'The Huntsman',
    kid: 'The Wolf-Cub',
    grownBlurb:
      'Once tonight, name a guest. The cub can smell whether that guest has ever told a lie.',
    kidBlurb: 'You can smell a fib. Once tonight, you and the Huntsman may sniff somebody out.',
  },
  {
    id: 'nursemaid',
    name: 'The Nursemaid and the Sleeping Princess',
    grown: 'The Nursemaid',
    kid: 'The Sleeping Princess',
    grownBlurb:
      'You watch the whole hall. You see every meeting anyone has had tonight, not only your own.',
    kidBlurb: 'This whole party is for you. Everybody is watching you, so watch them back.',
  },
  {
    id: 'spinner',
    name: 'The Spinner and the Thread-Holder',
    grown: 'The Spinner',
    kid: 'The Thread-Holder',
    grownBlurb: 'The thread runs both ways: a piece your child is given, you are given too.',
    kidBlurb: 'You hold the end of the thread. What you are told, your grown-up is told as well.',
  },
];

export const duoById = (id: string | null): Duo | null =>
  id === null ? null : (DUOS.find((d) => d.id === id) ?? null);

export const KID_PARTS = [
  'Princess Aurora',
  'The Rose Fairy',
  'The Dawn Fairy',
  'The Songbird Fairy',
  'The Royal Puppy',
  'The Littlest Queen',
  'The Keeper of the Cakes',
  'The Fairy of Sparkles',
];

export const GROWN_PARTS = [
  'The Queen',
  'The King',
  'The Chamberlain',
  'The Royal Cook',
  'The Spinner',
  'The Huntsman',
  'The Duchess',
  'The Ambassador',
  'The Court Physician',
  'The Minstrel',
  'The Gardener',
  'The Astronomer',
  'The Captain of the Guard',
  'The Seamstress',
  'The Falconer',
  'The Cellarer',
  'The Master of Horse',
  'The Baroness',
  'The Cartographer',
  'The Keeper of the Keys',
];

/** Enough falsehoods to matter, few enough to be caught. */
export const lieBudget = (guestCount: number): number => (guestCount >= 12 ? 3 : 2);

/** Every distinct costume, in a fixed order the shuffle then permutes. */
function costumeDeck(): Costume[] {
  const all: Costume[] = [];
  for (const gown of GOWNS) {
    for (const gift of GIFTS) {
      for (const place of PLACES) all.push({ gown, gift, place });
    }
  }
  return all;
}

/**
 * The deck every guest draws from. The three clues that pin the culprit's
 * costume are always in it — costumes are distinct, so those three alone name
 * exactly one guest, and the tale is solvable by construction rather than by
 * luck.
 *
 * An earlier version sliced the pool to one clue per player and could slice the
 * pinning clues out, leaving a puzzle with no answer and no way to notice.
 */
function buildDeck(state: PartyState, culprit: PartyGuest, rng: Rng): Piece[] {
  const c = culprit.costume ?? { gown: GOWNS[0], gift: GIFTS[0], place: PLACES[0] };
  const pinning = [
    `The one who cursed her wore ${c.gown}.`,
    `The one who cursed her brought ${c.gift}.`,
    `The one who cursed her stood ${c.place}.`,
  ];
  const chipping: string[] = [];
  for (const gown of GOWNS) {
    if (gown !== c.gown) chipping.push(`Whoever cursed her, it was not the one in ${gown}.`);
  }
  for (const gift of GIFTS) {
    if (gift !== c.gift) chipping.push(`No one who brought ${gift} laid the curse.`);
  }
  for (const place of PLACES) {
    if (place !== c.place) chipping.push(`Nobody standing ${place} could have done it.`);
  }
  for (const guest of rng.shuffle(state.guests.filter((g) => g.id !== culprit.id))) {
    chipping.push(`${guest.name} never left the hall. It was not them.`);
  }
  return [...pinning, ...rng.shuffle(chipping)].map((text) => ({ text, fake: false }));
}

/**
 * A falsehood the curser may hand over. Same grammar as a true clue and
 * pointing at a costume that is not theirs, so it is indistinguishable in form
 * and catchable only by contradicting something else in the room.
 *
 * Keyed on the budget remaining rather than a running counter, so a clock
 * advance interleaved between two encounters cannot shift the stream. The
 * budget only ever falls, so the key is fresh by construction.
 *
 * **The prototype's sixth variant is gone.** `tale.mjs:170` could produce
 * `"<innocent> never left the hall. It was not them."` — which is *true*, and
 * already in the deck for every innocent. Handing it over spent one of the
 * curser's two or three falsehoods, marked them in the lie ledger for the
 * Huntsman, showed itself to the Godmother, and told the recipient nothing they
 * could not have drawn honestly. That is a self-report, not a lie. The five
 * that remain are all costume contradictions, which is what the design
 * describes a falsehood as. Pointing the alibi at the culprit instead would
 * make it a real lie — and a guaranteed self-clearing one, which is a balance
 * change rather than a port, so it is not made here.
 */
export function makeLie(state: PartyState, seed: string): string | null {
  if (state.culprit === null) return null;
  const culprit = guestAt(state, state.culprit);
  if (culprit === null || culprit.costume === null) return null;

  const rng = substream(seed, 'party', 'lie', culprit.id, culprit.lies);
  const c = culprit.costume;
  const wrong = (list: readonly string[], mine: string): string =>
    rng.shuffle(list.filter((x) => x !== mine))[0];

  return rng.shuffle([
    `The one who cursed her wore ${wrong(GOWNS, c.gown)}.`,
    `The one who cursed her brought ${wrong(GIFTS, c.gift)}.`,
    `The one who cursed her stood ${wrong(PLACES, c.place)}.`,
    `Whoever cursed her, it was not the one in ${c.gown}.`,
    `No one who brought ${c.gift} laid the curse.`,
  ])[0];
}

/**
 * Deal the evening: distinct costumes, one culprit among the grown-ups, a duo
 * character per pair, a solvable deck, one opening piece each, and a favour per
 * child. Leaves the party in `invited` — the roles are known, the night has not
 * started.
 *
 * Alibi clues name guests, so it is the caller's job to have made seat names
 * distinct: two guests called Sam make an alibi that reads as two sentences.
 */
export function dealTale(state: PartyState, seed: string): PartyState {
  const next = cloneParty(state);
  const rng = substream(seed, 'party', 'tale');

  // Costumes first: everything else in the tale is stated in terms of one.
  const costumes = rng.shuffle(costumeDeck());
  next.guests.forEach((guest, i) => {
    guest.costume = costumes[i] ?? null;
  });

  const grown = grownUps(next);
  const culprit = rng.shuffle(grown)[0];

  // One duo character per pair. Which pairs draw one is seeded rather than
  // join-order dependent, so arriving early is not an advantage. A grown-up who
  // brought two children is one duo, not two — the pair is built from the
  // grown-up, so it is one by construction rather than by a guard.
  const pairs = rng
    .shuffle(grown.filter((g) => dependentsOf(next, g.id).some((d) => d.young)))
    .slice(0, DUOS.length);
  const duoDeck = rng.shuffle([...DUOS]);
  pairs.forEach((adult, i) => {
    const duo = duoDeck[i];
    const kid = dependentsOf(next, adult.id).find((d) => d.young);
    if (kid === undefined) return;
    adult.duoId = duo.id;
    adult.part = duo.grown;
    kid.duoId = duo.id;
    kid.part = duo.kid;
  });

  // A soloist must not draw a name a duo is already wearing: several duo halves
  // — the Huntsman, the Spinner — also appear in the ordinary cast, and a
  // second Huntsman across the room makes the board unreadable.
  const taken = new Set(next.guests.flatMap((g) => (g.part === null ? [] : [g.part])));
  dealParts(
    grown.filter((g) => g.duoId === null),
    GROWN_PARTS.filter((name) => !taken.has(name)),
    substream(seed, 'party', 'parts', 'grown'),
  );
  dealParts(
    children(next).filter((g) => g.duoId === null),
    KID_PARTS.filter((name) => !taken.has(name)),
    substream(seed, 'party', 'parts', 'kid'),
  );

  next.culprit = culprit.id;
  next.lieBudget = lieBudget(next.guests.length);
  next.deck = buildDeck(next, culprit, rng);

  // Everyone starts holding one piece. A child's is sealed behind a favour.
  const opening = substream(seed, 'party', 'opening').shuffle(next.deck);
  const favourOrder = substream(seed, 'party', 'favours').shuffle(FAVOURS.map((_, i) => i));
  let nthKid = 0;
  next.guests.forEach((guest, i) => {
    guest.pieces = opening[i] === undefined ? [] : [{ ...opening[i] }];
    guest.favour = guest.young ? favourOrder[nthKid++ % favourOrder.length] : null;
    guest.lies = guest.id === culprit.id ? next.lieBudget : 0;
  });

  next.phase = 'invited';
  return next;
}

/**
 * Parts must be distinct — two Queens at one christening makes the board
 * unreadable. Twenty grown-ups can outrun the cast once duos have eaten names
 * from it, so the overflow is numbered rather than left null: a guest with no
 * part cannot be talked about, which is worse than an inelegant one.
 */
function dealParts(guests: PartyGuest[], pool: readonly string[], rng: Rng): void {
  const deck = rng.shuffle(pool);
  guests.forEach((guest, i) => {
    if (deck[i] !== undefined) {
      guest.part = deck[i];
      return;
    }
    const overflow = i - deck.length;
    const base = deck.length === 0 ? 'The Guest' : deck[overflow % deck.length];
    guest.part = `${base} the ${overflow < deck.length ? 'Second' : 'Third'}`;
  });
}
