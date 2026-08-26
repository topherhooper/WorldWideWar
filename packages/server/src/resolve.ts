import { Timestamp } from 'firebase-admin/firestore';
import {
  canonicalJson,
  commandsArmies,
  decideOrders,
  decideTiersOrders,
  emptyOrders,
  inContest,
  makePersonality,
  redact,
  resolveTurn,
  substream,
  topicForTurn,
} from '@www/engine';
import type { OrderSet, TurnReport } from '@www/engine';

import { notify, type NotifyDeps } from './notify.js';
import {
  effectiveRules,
  games,
  humanSlots,
  ordersCol,
  orderDocId,
  parseMap,
  parseState,
  reportsCol,
  serializeState,
  type GameDoc,
  type OrderDoc,
  isPartyDoc,
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
  deps: NotifyDeps,
  gameId: string,
  expectedTurn: number,
): Promise<ResolutionOutcome> {
  const { db } = deps;
  const committed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(games(db).doc(gameId));
    if (!snap.exists) return null;
    const game = snap.data() as GameDoc;
    // A dinner party has no turns to resolve. `tick.ts` already routes them
    // elsewhere; this is the second lock, so no future caller can reach the war
    // resolver with a document that has no map and no war state.
    if (isPartyDoc(game)) return null;
    if (game.status !== 'active' || game.turn !== expectedTurn) return null;

    const state = parseState(game);
    if (state === null) return null;
    const map = parseMap(game);

    const submissions: (OrderSet | null)[] = Array.from({ length: game.playerCount }, () => null);

    const humans = humanSlots(game.seats);
    const orderSnaps =
      humans.length > 0
        ? await tx.getAll(
            ...humans.map((slot) => ordersCol(db, gameId).doc(orderDocId(expectedTurn, slot))),
          )
        : [];
    orderSnaps.forEach((orderSnap, i) => {
      if (!orderSnap.exists) return;
      submissions[humans[i]] = JSON.parse((orderSnap.data() as OrderDoc).ordersJson) as OrderSet;
    });

    // Bot seats plan from redacted state, exactly as the balance harness does
    // (packages/engine/src/simulate.ts) — same personalities, same substreams.
    const rules = effectiveRules(game);
    for (let slot = 0; slot < game.playerCount; slot++) {
      const seat = game.seats[slot];
      if (seat?.isBot && inContest(state, slot, rules)) {
        const personality = makePersonality(
          substream(game.seed, 'personality', slot),
          slot,
          'normal',
        );
        const view = redact(state, slot);
        // A landless co-op bot still reads its allies, exactly as the balance
        // harness has it (packages/engine/src/simulate.ts). These two must
        // agree: a bot that contests in the sweep and abstains in a real game
        // makes every measured difficulty number a fiction.
        const orderSet = commandsArmies(state, slot)
          ? decideOrders(
              view,
              map,
              slot,
              substream(game.seed, 'bot', expectedTurn, slot),
              personality,
            )
          : emptyOrders(slot);
        if ((game.rules.contest ?? 'pact') === 'tiers') {
          orderSet.tiers = decideTiersOrders(
            view,
            slot,
            topicForTurn(game.seed, expectedTurn),
            topicForTurn(game.seed, expectedTurn - 1),
            substream(game.seed, expectedTurn, 'tiers-bot', slot),
          );
        }
        submissions[slot] = orderSet;
      }
    }

    const { next, report } = resolveTurn(state, submissions, {
      seed: game.seed,
      map,
      rules,
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

  await notify(
    deps,
    finished ? 'gameOver' : 'turnResolved',
    game.seats.flatMap((seat) => (seat !== null && !seat.isBot ? [seat] : [])),
    {
      subject: finished
        ? `[WWW] Game over — ${report.result?.detail ?? report.result?.kind}`
        : `[WWW] Turn ${expectedTurn} resolved — ${report.headline}`,
      text: `${report.headline}\n\nSee the full report: ${deps.baseUrl}/g/${gameId}`,
    },
  );
  return { resolved: true, report, finished };
}
