import { beforeEach, describe, expect, it } from 'vitest';
import { generateMap, createInitialState, rulesFor } from '@www/engine';
import { Timestamp } from 'firebase-admin/firestore';

import { emulatorDb, clearFirestore } from './testing.js';
import { games, serializeState, serializeMap, parseState, parseMap, type GameDoc } from './store.js';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('store', () => {
  beforeEach(clearFirestore);

  it('round-trips a full game doc through Firestore', async () => {
    const db = emulatorDb();
    const map = generateMap('round-trip', 4);
    const state = createInitialState(map, rulesFor(4));
    const doc: GameDoc = {
      status: 'active',
      createdBy: 'u1',
      createdAt: Timestamp.now(),
      playerCount: 4,
      seats: [{ uid: 'u1', name: 'A', email: null, isBot: false }, null, null, null],
      turn: 1,
      deadlineAt: Timestamp.now(),
      turnMinutes: 1440,
      remindedTurn: 0,
      seed: 'round-trip',
      rules: rulesFor(4),
      stateJson: serializeState(state),
      mapJson: serializeMap(map),
    };
    await games(db).doc('g1').set(doc);
    const got = (await games(db).doc('g1').get()).data() as GameDoc;
    expect(parseState(got)).toEqual(state);
    expect(parseMap(got)).toEqual(map);
    expect(got.seats).toEqual(doc.seats);
    expect(got.rules).toEqual(doc.rules);
  });
});
