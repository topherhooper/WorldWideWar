import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  canonicalJson,
  decideOrders,
  makePersonality,
  redact,
  resolveTurn,
  substream,
} from '@www/engine';
import type { OrderSet, TurnReport } from '@www/engine';

import type { Mailer } from './mailer.js';
import {
  games,
  ordersCol,
  orderDocId,
  parseMap,
  parseState,
  reportsCol,
  serializeState,
  type GameDoc,
  type OrderDoc,
} from './store.js';

export interface ResolutionOutcome {
  resolved: boolean;
  report: TurnReport | null;
  finished: boolean;
}

const NOT_RESOLVED: ResolutionOutcome = { resolved: false, report: null, finished: false };

/**
 * Resolve `expectedTurn` if the game is still on it; no-op otherwise. The tick
 * and the last lock-in race to call this — the turn-number guard inside the
 * transaction makes double resolution structurally impossible.
 */
export async function resolveGameTurn(
  db: Firestore,
  mailer: Mailer,
  baseUrl: string,
  gameId: string,
  expectedTurn: number,
): Promise<ResolutionOutcome> {
  const committed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) return null;
    const game = snap.data() as GameDoc;
    if (game.status !== 'active' || game.turn !== expectedTurn) return null;

    const state = parseState(game);
    if (state === null) return null;
    const map = parseMap(game);

    const submissions: (OrderSet | null)[] = Array.from({ length: game.playerCount }, () => null);

    const humanSlots = game.seats.flatMap((s, slot) => (s !== null && !s.isBot ? [slot] : []));
    const orderSnaps =
      humanSlots.length > 0
        ? await tx.getAll(
            ...humanSlots.map((slot) => ordersCol(db, gameId).doc(orderDocId(expectedTurn, slot))),
          )
        : [];
    orderSnaps.forEach((orderSnap, i) => {
      if (!orderSnap.exists) return;
      submissions[humanSlots[i]] = JSON.parse(
        (orderSnap.data() as OrderDoc).ordersJson,
      ) as OrderSet;
    });

    // Bot seats plan from redacted state, exactly as the balance harness does
    // (packages/engine/src/simulate.ts) — same personalities, same substreams.
    for (let slot = 0; slot < game.playerCount; slot++) {
      const seat = game.seats[slot];
      if (seat?.isBot && state.status[slot] === 'active') {
        const personality = makePersonality(
          substream(game.seed, 'personality', slot),
          slot,
          'normal',
        );
        submissions[slot] = decideOrders(
          redact(state, slot),
          map,
          slot,
          substream(game.seed, 'bot', expectedTurn, slot),
          personality,
        );
      }
    }

    const { next, report } = resolveTurn(state, submissions, {
      seed: game.seed,
      map,
      rules: game.rules,
    });
    const finished = report.result !== null;

    tx.update(games(db).doc(gameId), {
      stateJson: serializeState(next),
      turn: next.turn,
      status: finished ? 'finished' : 'active',
      deadlineAt: finished ? null : Timestamp.fromMillis(Date.now() + game.turnMinutes * 60_000),
    });
    tx.set(reportsCol(db, gameId).doc(String(expectedTurn)), {
      reportJson: canonicalJson(report),
    });
    return { report, finished, game };
  });

  if (committed === null) return NOT_RESOLVED;
  const { report, finished, game } = committed;

  const subject = finished
    ? `[WWW] Game over — ${report.result?.detail ?? report.result?.kind}`
    : `[WWW] Turn ${expectedTurn} resolved — ${report.headline}`;
  const text = `${report.headline}\n\nSee the full report: ${baseUrl}/g/${gameId}`;
  for (const seat of game.seats) {
    if (seat !== null && !seat.isBot && seat.email !== null) {
      await mailer.send({ to: seat.email, subject, text });
    }
  }
  return { resolved: true, report, finished };
}
