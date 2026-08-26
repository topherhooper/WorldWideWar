import { beforeEach, describe, expect, it } from 'vitest';

import type { SacreGameView } from './api-types.js';
import { HttpError, listGames, type AuthedUser } from './games.js';
import { games, type SacreGameDoc } from './store.js';
import { clearFirestore, emulatorDb } from './testing.js';
import { actOnSacre, createSacreGame, getSacreView, takeSacreSeat } from './sacre.js';

const ana: AuthedUser = { uid: 'u-ana', name: 'Ana', email: 'ana@test.dev' };
const bo: AuthedUser = { uid: 'u-bo', name: 'Bo', email: 'bo@test.dev' };
const cy: AuthedUser = { uid: 'u-cy', name: 'Cy', email: null };

/** Seat two players and deal, which is the state most tests want. */
async function dealtTable(db: FirebaseFirestore.Firestore): Promise<string> {
  const id = await createSacreGame(db, ana, { kind: 'cards', players: 2 });
  await takeSacreSeat(db, id, bo);
  await actOnSacre(db, id, ana, { action: { type: 'deal' } });
  return id;
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('the card game', () => {
  const db = emulatorDb();
  beforeEach(clearFirestore);

  it('creates a table that shares the ordinary invite link', async () => {
    const id = await createSacreGame(db, ana, { kind: 'cards', players: 4 });
    const view = await getSacreView(db, id, ana);
    expect(view.kind).toBe('cards');
    expect(view.status).toBe('lobby');
    expect(view.mySlot).toBe(0);
    expect(view.maxSeats).toBe(4);
    // The seed decides the deal, so it must never reach a player.
    const seed = (await games(db).doc(id).get()).get('seed') as string;
    expect(JSON.stringify(view)).not.toContain(seed);
  });

  it('clamps the table to the sizes the rules cover', async () => {
    const tiny = await createSacreGame(db, ana, { kind: 'cards', players: 1 });
    expect((await getSacreView(db, tiny, ana)).maxSeats).toBe(2);
    const huge = await createSacreGame(db, ana, { kind: 'cards', players: 99 });
    expect((await getSacreView(db, huge, ana)).maxSeats).toBe(7);
  });

  it('will not deal for one, and only the host deals', async () => {
    const id = await createSacreGame(db, ana, { kind: 'cards', players: 2 });
    await expect(actOnSacre(db, id, ana, { action: { type: 'deal' } })).rejects.toBeInstanceOf(
      HttpError,
    );
    await takeSacreSeat(db, id, bo);
    await expect(actOnSacre(db, id, bo, { action: { type: 'deal' } })).rejects.toBeInstanceOf(
      HttpError,
    );
    const view = await actOnSacre(db, id, ana, { action: { type: 'deal' } });
    expect(view.status).toBe('active');
    expect(view.game.round).toBe(1);
  });

  it('deals a hand to each player and keeps every other hand hidden', async () => {
    const id = await dealtTable(db);
    const view = await getSacreView(db, id, bo);
    expect(view.game.yourHand).toHaveLength(15);
    expect(view.game.seats[1].hand).toHaveLength(15);
    // Ana's hand is not in Bo's view at all -- not empty, absent.
    expect(view.game.seats[0].hand).toBeUndefined();
    expect(view.game.seats[0].cards).toBe(15);
    // Nor is the deck.
    expect(view.game.deck).toBeUndefined();
  });

  it('refuses a turn taken out of order, without throwing', async () => {
    const id = await dealtTable(db);
    const bosView = await getSacreView(db, id, bo);
    const card = bosView.game.yourHand[0];
    // Ana is active, so Bo's action is turned away with a sentence rather than
    // a 500 -- invalid input degrades.
    const after = await actOnSacre(db, id, bo, {
      action: { type: 'return', cards: [card.id] },
    });
    expect(after.note).toMatch(/not your turn/i);
    expect(after.game.round).toBe(1);
  });

  it('plays a turn and hands it on', async () => {
    const id = await dealtTable(db);
    const before = await getSacreView(db, id, ana);
    expect(before.game.active).toBe(0);
    const card = before.game.yourHand[0];

    const after = await actOnSacre(db, id, ana, {
      action: { type: 'return', cards: [card.id] },
    });
    expect(after.note).toBeNull();
    expect(after.game.active).toBe(1);
    expect(after.game.yourHand).toHaveLength(15);
  });

  it('parks an Advertise until the table answers', async () => {
    const id = await dealtTable(db);
    const anas = await getSacreView(db, id, ana);
    const offer = anas.game.yourHand.find((c) => c.rank !== null);

    const offered = await actOnSacre(db, id, ana, {
      action: { type: 'advertise', card: offer!.id },
    });
    expect(offered.game.pending?.kind).toBe('advertise');
    expect(offered.game.turnPhase).toBe('awaiting');
    // Still Ana's turn -- it does not pass until the answers are in.
    expect(offered.game.active).toBe(0);

    const bos = await getSacreView(db, id, bo);
    expect(bos.game.pending?.youOwe).toBe(true);
    // The advertiser sees no answers while any are outstanding.
    expect(offered.game.pending?.responses).toBeUndefined();
  });

  it('shows a card game in the games list under its own kind', async () => {
    const id = await dealtTable(db);
    const mine = await listGames(db, ana);
    const row = mine.find((g) => g.id === id);
    expect(row?.kind).toBe('cards');
  });

  it('never lets a card document be read as a war game', async () => {
    const id = await createSacreGame(db, ana, { kind: 'cards', players: 2 });
    const doc = (await games(db).doc(id).get()).data() as SacreGameDoc;
    expect(doc.kind).toBe('cards');
    // The guard that used to be `kind !== 'party'`: a card game answering a
    // war-only endpoint is a 409, not a 500 on a map it never had.
    const { startGame } = await import('./games.js');
    await expect(startGame(db, id, ana)).rejects.toBeInstanceOf(HttpError);
  });

  it('turns a stranger away from the table', async () => {
    const id = await dealtTable(db);
    await expect(
      actOnSacre(db, id, cy, { action: { type: 'return', cards: [] } }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('is idempotent about taking a seat', async () => {
    const id = await createSacreGame(db, ana, { kind: 'cards', players: 4 });
    const first = await takeSacreSeat(db, id, bo);
    const second = await takeSacreSeat(db, id, bo);
    expect(first.mySlot).toBe(second.mySlot);
    expect((await getSacreView(db, id, ana)).seats.filter((s) => s.taken)).toHaveLength(2);
  });

  it('shows a spectator no hands at all', async () => {
    const id = await dealtTable(db);
    const view: SacreGameView = await getSacreView(db, id, cy);
    expect(view.mySlot).toBeNull();
    expect(view.game.yourHand).toEqual([]);
    expect(view.game.seats.every((s) => s.hand === undefined)).toBe(true);
  });
});
