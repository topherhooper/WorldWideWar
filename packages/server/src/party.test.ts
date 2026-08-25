import { beforeEach, describe, expect, it } from 'vitest';

import { TOGETHER_SUSPECTS } from '@www/engine/party';
import type { PartyGameView } from './api-types.js';
import { HttpError, submitOrders, startGame, updateConfig, type AuthedUser } from './games.js';
import { games, type PartyGameDoc } from './store.js';
import { LogMailer } from './mailer.js';
import { clearFirestore, emulatorDb, testDeps } from './testing.js';
import {
  actOnParty,
  createPartyGame,
  dropPartySeat,
  getPartyView,
  takePartySeat,
  updatePartyConfig,
} from './party.js';

const mum: AuthedUser = { uid: 'u-mum', name: 'Mum', email: 'mum@test.dev' };
const dad: AuthedUser = { uid: 'u-dad', name: 'Dad', email: 'dad@test.dev' };
const nan: AuthedUser = { uid: 'u-nan', name: 'Nan', email: null };
const pat: AuthedUser = { uid: 'u-pat', name: 'Pat', email: null };

const guestNamed = (view: PartyGameView, name: string): number =>
  view.party.roster.find((r) => r.name === name)!.id;

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('the dinner party', () => {
  const db = emulatorDb();
  beforeEach(clearFirestore);

  it('creates a party that shares the ordinary invite link', async () => {
    const id = await createPartyGame(db, mum, { kind: 'party', mode: 'together' });
    const view = await getPartyView(db, id, mum);
    expect(view.kind).toBe('party');
    expect(view.status).toBe('lobby');
    expect(view.mySlot).toBe(0);
    expect(view.isHost).toBe(true);
    expect(view.party.mode).toBe('together');
    expect(view.party.phase).toBe('lobby');
    // The seed decides the deal, so it must never reach a guest.
    const seed = (await games(db).doc(id).get()).get('seed') as string;
    expect(JSON.stringify(view)).not.toContain(seed);
  });

  it('seats a guest and the children they brought', async () => {
    const id = await createPartyGame(db, mum, { kind: 'party', mode: 'together' });
    await takePartySeat(db, id, mum, { dependents: [{ name: 'Robin', young: true }] });
    const view = await takePartySeat(db, id, dad, {
      dependents: [{ name: 'Wren', young: true }],
    });
    expect(view.mySlot).toBe(1);
    expect(view.seats).toHaveLength(2);
    expect(view.seats[1].dependents).toEqual([{ name: 'Wren', young: true }]);
    expect(view.party.roster.map((r) => r.name)).toEqual(['Mum', 'Robin', 'Dad', 'Wren']);
  });

  it('lets a guest who forgot their child say so without leaving and rejoining', async () => {
    const id = await createPartyGame(db, mum, { kind: 'party' });
    await takePartySeat(db, id, dad, {});
    const view = await takePartySeat(db, id, dad, {
      dependents: [{ name: 'Wren', young: true }],
    });
    expect(view.seats).toHaveLength(2);
    expect(view.seats[1].dependents).toHaveLength(1);
  });

  it('seats a grown-up with no account of their own as a dependent', async () => {
    // The point of `dependents` rather than `children`: a grandparent whose
    // phone will not finish a Google sign-in is the same problem as a toddler.
    const id = await createPartyGame(db, mum, { kind: 'party' });
    const view = await takePartySeat(db, id, dad, {
      dependents: [{ name: 'Grandad', young: false }],
    });
    const grandad = view.party.roster.find((r) => r.name === 'Grandad')!;
    expect(grandad.young).toBe(false);
    expect(grandad.weight).toBe(1);
  });

  it('makes colliding display names distinct, because the clues name guests', async () => {
    const id = await createPartyGame(db, mum, { kind: 'party' });
    const sam1: AuthedUser = { uid: 'u-s1', name: 'Sam', email: null };
    const sam2: AuthedUser = { uid: 'u-s2', name: 'Sam', email: null };
    await takePartySeat(db, id, sam1, {});
    const view = await takePartySeat(db, id, sam2, {});
    const names = view.party.roster.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Sam (2)');
  });

  it('lets the host drop a no-show, and nobody else', async () => {
    const id = await createPartyGame(db, mum, { kind: 'party' });
    await takePartySeat(db, id, dad, {});
    await takePartySeat(db, id, nan, {});
    await expect(dropPartySeat(db, id, dad, 2)).rejects.toThrow(HttpError);
    await expect(dropPartySeat(db, id, mum, 0)).rejects.toThrow(HttpError);
    const view = await dropPartySeat(db, id, mum, 2);
    expect(view.seats.map((s) => s.name)).toEqual(['Mum', 'Dad']);
    expect(view.party.roster.map((r) => r.name)).toEqual(['Mum', 'Dad']);
  });

  it('sets the dials before the deal and not after', async () => {
    const id = await createPartyGame(db, mum, { kind: 'party', mode: 'together' });
    await takePartySeat(db, id, dad, {});
    const tuned = await updatePartyConfig(db, id, mum, { candles: 3, roundMinutes: 2 });
    expect(tuned.party.candles).toBe(3);
    await expect(updatePartyConfig(db, id, dad, { candles: 9 })).rejects.toThrow(HttpError);
    await expect(updatePartyConfig(db, id, mum, { candles: 99 })).rejects.toThrow(HttpError);

    await actOnParty(db, id, mum, { action: { kind: 'deal' } });
    await expect(updatePartyConfig(db, id, mum, { candles: 5 })).rejects.toThrow(HttpError);
  });

  it('refuses a hunt with two grown-ups, and says why', async () => {
    const id = await createPartyGame(db, mum, { kind: 'party', mode: 'traitor' });
    await takePartySeat(db, id, dad, {});
    const view = await actOnParty(db, id, mum, { action: { kind: 'deal' } });
    expect(view.note).toMatch(/at least 3 grown-ups/);
    expect(view.party.phase).toBe('lobby');
  });

  it('deals only for the host', async () => {
    const id = await createPartyGame(db, mum, { kind: 'party', mode: 'together' });
    await takePartySeat(db, id, dad, {});
    const refused = await actOnParty(db, id, dad, { action: { kind: 'deal' } });
    expect(refused.note).toMatch(/only the host/);
    expect(refused.party.phase).toBe('lobby');
  });

  it('turns away a guest who never took a seat', async () => {
    const id = await createPartyGame(db, mum, { kind: 'party' });
    await expect(actOnParty(db, id, pat, { action: { kind: 'deal' } })).rejects.toThrow(HttpError);
  });

  it('refuses every war endpoint, so a stale bundle gets a sentence not a stack', async () => {
    const id = await createPartyGame(db, mum, { kind: 'party' });
    await expect(startGame(db, id, mum)).rejects.toThrow(HttpError);
    await expect(updateConfig(db, id, mum, { playerCount: 4 })).rejects.toThrow(HttpError);
    await expect(
      submitOrders(testDeps(db, new LogMailer()), id, mum, {
        orders: { slot: 0 },
        locked: true,
      } as never),
    ).rejects.toThrow(HttpError);
  });

  it('plays a whole bedtime party, from the link to the broken curse', async () => {
    // Two parents, a four-year-old and a one-and-a-half-year-old.
    const id = await createPartyGame(db, mum, { kind: 'party', mode: 'together' });
    await takePartySeat(db, id, mum, { dependents: [{ name: 'Robin', young: true }] });
    await takePartySeat(db, id, dad, { dependents: [{ name: 'Wren', young: true }] });
    await updatePartyConfig(db, id, mum, { candles: 3, roundMinutes: 2 });

    // The host deals. The invitation is live and nothing else is.
    const invited = await actOnParty(db, id, mum, { action: { kind: 'deal' } });
    expect(invited.party.phase).toBe('invited');
    expect(invited.phaseEndsAt).toBeNull();
    expect(invited.status).toBe('active');

    // Each parent's card names a different part, and both children have one.
    const mumCards = invited.party.cards;
    const dadCards = (await getPartyView(db, id, dad)).party.cards;
    expect(mumCards.map((c) => c.name)).toEqual(['Mum', 'Robin']);
    expect(dadCards.map((c) => c.name)).toEqual(['Dad', 'Wren']);
    const parts = [...mumCards, ...dadCards].map((c) => c.part);
    expect(new Set(parts).size).toBe(parts.length);
    expect(parts.every((p) => p !== null)).toBe(true);
    // Nobody here laid the curse, so nobody holds a falsehood.
    expect([...mumCards, ...dadCards].every((c) => c.lies === 0)).toBe(true);
    // And the suspects are the courtiers who went home.
    expect(invited.party.roster.filter((r) => r.absent)).toHaveLength(TOGETHER_SUSPECTS);

    // On the night the host rings them in.
    const round1 = await actOnParty(db, id, mum, { action: { kind: 'bell' } });
    expect(round1.party.phase).toBe('mingle');
    expect(round1.party.round).toBe(1);
    expect(round1.phaseEndsAt).not.toBeNull();

    // Mum kneels to Dad's four-year-old and is paid a piece for it.
    const wren = guestNamed(round1, 'Wren');
    const mumId = guestNamed(round1, 'Mum');
    const before = round1.party.cards[0].pieces.length;
    await actOnParty(db, id, mum, {
      action: { kind: 'meet', actor: mumId, target: wren, lie: false },
    });
    const paid = await actOnParty(db, id, dad, {
      action: { kind: 'confirm', about: wren, claimant: mumId },
    });
    const mumAfter = (await getPartyView(db, id, mum)).party.cards[0];
    expect(mumAfter.pieces.length).toBe(before + 1);
    // The child banked a crown; their card carries no clue text at all.
    const wrenCard = paid.party.cards.find((c) => c.name === 'Wren')!;
    expect(wrenCard.curtsies).toContain(mumId);
    expect(wrenCard.pieces).toEqual([]);

    // The bell, then the guess. Read the answer off the state, not the wire —
    // no view has ever been allowed to say who it was.
    await actOnParty(db, id, mum, { action: { kind: 'bell' } });
    const doc = (await games(db).doc(id).get()).data() as PartyGameDoc;
    const culprit = (JSON.parse(doc.partyJson!) as { culprit: number }).culprit;

    const won = await actOnParty(db, id, dad, {
      action: { kind: 'nominate', actor: guestNamed(round1, 'Dad'), suspect: culprit },
    });
    expect(won.party.phase).toBe('over');
    expect(won.party.outcome).toMatch(/the curse is broken/);
    expect(won.status).toBe('finished');
    expect(won.phaseEndsAt).toBeNull();
    expect(won.party.culprit).toBe(culprit);
    // Everybody at the table is on the same side, and they all won.
    expect(won.party.cards.every((c) => c.won === true)).toBe(true);
    expect((await getPartyView(db, id, mum)).party.cards.every((c) => c.won === true)).toBe(true);
  });

  it('never puts the culprit on the wire before the night is over', async () => {
    const id = await createPartyGame(db, mum, { kind: 'party', mode: 'together' });
    await takePartySeat(db, id, dad, { dependents: [{ name: 'Wren', young: true }] });
    await actOnParty(db, id, mum, { action: { kind: 'deal' } });
    await actOnParty(db, id, mum, { action: { kind: 'bell' } });

    for (const who of [mum, dad]) {
      const view = await getPartyView(db, id, who);
      expect(view.party.culprit).toBeNull();
      expect(view.party.cursed).toBeNull();
    }
  });
});
