import { Timestamp } from 'firebase-admin/firestore';

import { advanceParty } from '@www/engine/party';

import { notify, type NotifyDeps } from './notify.js';
import { resolveGameTurn } from './resolve.js';
import {
  games,
  isPartyDoc,
  liveHumanSlots,
  ordersCol,
  orderDocId,
  parseParty,
  parseState,
  serializeParty,
  type GameDoc,
  type OrderDoc,
  type WarGameDoc,
} from './store.js';

export interface TickResult {
  resolvedGames: string[];
  remindedGames: string[];
  /** Parties whose bell rang, or whose floor closed, with nobody watching. */
  advancedParties: string[];
  errors: string[];
}

const REMINDER_FRACTION = 0.25;

/**
 * One sweep over every active game: resolve what is past deadline, remind the
 * unlocked when little time remains. Fetches all active games — fine at
 * playtest scale, and it keeps Firestore free of composite indexes.
 */
export async function runTick(deps: NotifyDeps, now: Date): Promise<TickResult> {
  const { db } = deps;
  const result: TickResult = {
    resolvedGames: [],
    remindedGames: [],
    advancedParties: [],
    errors: [],
  };
  const active = await games(db).where('status', '==', 'active').get();

  for (const snap of active.docs) {
    try {
      const game = snap.data() as GameDoc;
      // A dealt-but-unrung party has no deadline, which is exactly right: an
      // invitation may sit for days, and nothing should sweep it.
      if (game.deadlineAt === null) continue;
      const remainingMs = game.deadlineAt.toMillis() - now.getTime();

      if (isPartyDoc(game)) {
        // Parties get no reminder mail — a nudge twenty seconds into a
        // ninety-second vote is noise, and the guests are in the same room.
        if (remainingMs > 0) continue;
        if (await advancePartyGame(deps, snap.id, now)) {
          result.advancedParties.push(snap.id);
        }
        continue;
      }

      if (remainingMs <= 0) {
        const outcome = await resolveGameTurn(deps, snap.id, game.turn);
        if (outcome.resolved) result.resolvedGames.push(snap.id);
        continue;
      }

      if (
        remainingMs <= game.turnMinutes * 60_000 * REMINDER_FRACTION &&
        game.remindedTurn < game.turn
      ) {
        const reminded = await remind(deps, snap.id, game);
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

/**
 * The backstop, not the mechanism. Every party request advances its own clock,
 * because a sweep once a minute cannot drive a ninety-second vote window. This
 * is what keeps a party burning candles once every phone in the room is in a
 * pocket — including all the way to the end.
 */
async function advancePartyGame(deps: NotifyDeps, gameId: string, now: Date): Promise<boolean> {
  const { db } = deps;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) return false;
    // Re-read inside the transaction: the sweep's snapshot is stale the moment
    // any guest's own lazy advance lands first, and twenty phones race here.
    const fresh = snap.data() as GameDoc;
    if (!isPartyDoc(fresh)) return false;
    const state = parseParty(fresh);
    if (state === null) return false;

    const advanced = advanceParty(state, now.getTime());
    if (!advanced.changed) return false;

    tx.update(games(db).doc(gameId), {
      partyJson: serializeParty(advanced.state),
      deadlineAt: partyDeadline(advanced.state.phaseEndsAt),
      status: advanced.state.phase === 'over' ? 'finished' : fresh.status,
      turn: advanced.state.round,
    });
    return true;
  });
}

/** The document mirror of `phaseEndsAt`, which is what the sweeper queries on. */
export const partyDeadline = (phaseEndsAt: number | null): Timestamp | null =>
  phaseEndsAt === null ? null : Timestamp.fromMillis(phaseEndsAt);

async function remind(deps: NotifyDeps, gameId: string, game: WarGameDoc): Promise<boolean> {
  const { db } = deps;
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

  await notify(
    deps,
    'reminder',
    unlocked.flatMap((slot) => {
      const seat = game.seats[slot];
      return seat !== null ? [seat] : [];
    }),
    {
      subject: `[WWW] Orders due soon — turn ${game.turn}`,
      text: `The turn deadline is approaching and your orders are not locked in.\n\nSubmit them here: ${deps.baseUrl}/g/${gameId}`,
    },
  );
  await games(db).doc(gameId).update({ remindedTurn: game.turn });
  return true;
}
