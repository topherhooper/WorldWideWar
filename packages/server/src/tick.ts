import type { Firestore } from 'firebase-admin/firestore';

import type { Mailer } from './mailer.js';
import { resolveGameTurn } from './resolve.js';
import {
  games,
  liveHumanSlots,
  ordersCol,
  orderDocId,
  parseState,
  type GameDoc,
  type OrderDoc,
} from './store.js';

export interface TickResult {
  resolvedGames: string[];
  remindedGames: string[];
  errors: string[];
}

const REMINDER_FRACTION = 0.25;

/**
 * One sweep over every active game: resolve what is past deadline, remind the
 * unlocked when little time remains. Fetches all active games — fine at
 * playtest scale, and it keeps Firestore free of composite indexes.
 */
export async function runTick(
  db: Firestore,
  mailer: Mailer,
  baseUrl: string,
  now: Date,
): Promise<TickResult> {
  const result: TickResult = { resolvedGames: [], remindedGames: [], errors: [] };
  const active = await games(db).where('status', '==', 'active').get();

  for (const snap of active.docs) {
    try {
      const game = snap.data() as GameDoc;
      if (game.deadlineAt === null) continue;
      const remainingMs = game.deadlineAt.toMillis() - now.getTime();

      if (remainingMs <= 0) {
        const outcome = await resolveGameTurn(db, mailer, baseUrl, snap.id, game.turn);
        if (outcome.resolved) result.resolvedGames.push(snap.id);
        continue;
      }

      if (
        remainingMs <= game.turnMinutes * 60_000 * REMINDER_FRACTION &&
        game.remindedTurn < game.turn
      ) {
        const reminded = await remind(db, mailer, baseUrl, snap.id, game);
        if (reminded) result.remindedGames.push(snap.id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[tick] game ${snap.id} failed:`, err);
      result.errors.push(`${snap.id}: ${message}`);
    }
  }
  return result;
}

async function remind(
  db: Firestore,
  mailer: Mailer,
  baseUrl: string,
  gameId: string,
  game: GameDoc,
): Promise<boolean> {
  const state = parseState(game);
  if (state === null) return false;

  const liveHumans = liveHumanSlots(game.seats, state);
  if (liveHumans.length === 0) return false;

  const orderSnaps = await db.getAll(
    ...liveHumans.map((slot) => ordersCol(db, gameId).doc(orderDocId(game.turn, slot))),
  );
  const unlocked = liveHumans.filter((_, i) => {
    const snap = orderSnaps[i];
    return !snap.exists || !(snap.data() as OrderDoc).locked;
  });
  if (unlocked.length === 0) return false;

  for (const slot of unlocked) {
    const seat = game.seats[slot];
    if (seat !== null && seat.email !== null) {
      await mailer.send({
        to: seat.email,
        subject: `[WWW] Orders due soon — turn ${game.turn}`,
        text: `The turn deadline is approaching and your orders are not locked in.\n\nSubmit them here: ${baseUrl}/g/${gameId}`,
      });
    }
  }
  await games(db).doc(gameId).update({ remindedTurn: game.turn });
  return true;
}
