// PROTOTYPE. Sleeping Beauty as an assembly puzzle for up to 20 people.
//
// The truth is a single culprit. Every guest wears a public costume -- gown, gift, place
// at the christening -- and the clues constrain the culprit's costume rather than naming
// anyone. Pin all three attributes and exactly one person is left, because costumes are
// dealt distinct. That is what makes it solvable by talking rather than by luck.

const GOWNS = ['green', 'gold', 'crimson', 'silver'];
const GIFTS = ['a spindle', 'a white rose', 'a songbird', 'a silver mirror'];
const PLACES = [
  'by the cradle',
  'by the window',
  'at the great door',
  'in the shadow of the throne',
];

// What a grown-up must do to get a clue out of a child. The child is the lock.
// What a grown-up must do to get a clue out of a child. The child is the lock. Two
// phrasings, because the same errand has to read right from both mouths.
export const FAVOURS = [
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

/** Parts must be distinct -- two Queens at one christening makes the board unreadable. */
function dealParts(list, players) {
  const deck = shuffle(list);
  players.forEach((p, i) => (p.part = deck[i] ?? `${list[i % list.length]} the Second`));
}

function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Distinct costumes, so a fully-pinned costume names exactly one guest. */
function dealCostumes(players) {
  const all = [];
  for (const gown of GOWNS)
    for (const gift of GIFTS) for (const place of PLACES) all.push({ gown, gift, place });
  const deck = shuffle(all);
  players.forEach((p, i) => (p.costume = deck[i]));
}

/**
 * The deck every guest draws from. The three clues that pin the culprit's costume are
 * always in it -- costumes are distinct, so those three alone name exactly one guest,
 * and the tale is solvable by construction rather than by luck.
 */
function buildDeck(players, culprit) {
  const c = culprit.costume;
  const pinning = [
    `The one who cursed her wore ${c.gown}.`,
    `The one who cursed her brought ${c.gift}.`,
    `The one who cursed her stood ${c.place}.`,
  ];
  const chipping = [];
  for (const gown of GOWNS)
    if (gown !== c.gown) chipping.push(`Whoever cursed her, it was not the one in ${gown}.`);
  for (const gift of GIFTS)
    if (gift !== c.gift) chipping.push(`No one who brought ${gift} laid the curse.`);
  for (const place of PLACES)
    if (place !== c.place) chipping.push(`Nobody standing ${place} could have done it.`);
  for (const p of shuffle(players.filter((p) => p !== culprit))) {
    chipping.push(`${p.name} never left the hall. It was not them.`);
  }
  return [...pinning, ...shuffle(chipping)].map((text, id) => ({ id, text, fake: false }));
}

/**
 * A lie the curser can hand over. Same grammar as a true clue and pointing at a costume
 * that is not theirs, so it is indistinguishable in form and catchable only by
 * contradicting something else in the room.
 */
export function makeLie(culprit, players) {
  const c = culprit.costume;
  const wrong = (list, mine) => shuffle(list.filter((x) => x !== mine))[0];
  const innocent = shuffle(players.filter((p) => p !== culprit && !p.young))[0];
  return shuffle(
    [
      `The one who cursed her wore ${wrong(GOWNS, c.gown)}.`,
      `The one who cursed her brought ${wrong(GIFTS, c.gift)}.`,
      `The one who cursed her stood ${wrong(PLACES, c.place)}.`,
      `Whoever cursed her, it was not the one in ${c.gown}.`,
      `No one who brought ${c.gift} laid the curse.`,
      innocent ? `${innocent.name} never left the hall. It was not them.` : null,
    ].filter(Boolean),
  )[0];
}

/** How many falsehoods the curser may plant. Enough to matter, few enough to be caught. */
export const lieBudget = (playerCount) => (playerCount >= 12 ? 3 : 2);

export function buildTale(players) {
  dealCostumes(players);

  const grownups = players.filter((p) => !p.young);
  const kids = players.filter((p) => p.young);
  const culprit = shuffle(grownups)[0];

  dealParts(GROWN_PARTS, grownups);
  dealParts(KID_PARTS, kids);

  const deck = buildDeck(players, culprit);
  // Everyone starts holding one piece. A child's is sealed behind a favour.
  const opening = shuffle(deck);
  const favours = shuffle(FAVOURS);
  let nthKid = 0;
  players.forEach((p, i) => {
    p.pieces = opening[i] ? [{ ...opening[i] }] : [];
    p.favour = p.young ? favours[nthKid++ % favours.length] : null;
  });

  return {
    title: 'Sleeping Beauty',
    prompt:
      'Someone at this christening cursed the baby. Find out who before the last candle goes out.',
    culpritId: culprit.id,
    deck,
    lies: lieBudget(players.length),
  };
}
