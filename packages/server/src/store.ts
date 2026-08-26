import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type CollectionReference, type Firestore } from 'firebase-admin/firestore';
import type { Timestamp } from 'firebase-admin/firestore';
import { canonicalJson, inContest, rulesFor } from '@www/engine';
import type { GameState, GeneratedMap, RuleConfig, TiersList } from '@www/engine';
import type { PartyState } from '@www/engine/party';
import type { SacreState } from '@www/engine/sacre';

import type { GameStatus, NotifyKind } from './api-types.js';

export interface Seat {
  uid: string | null;
  name: string;
  email: string | null;
  isBot: boolean;
  /**
   * Party only. Guests with no Google account who arrived on this seat.
   *
   * `young: true` is a child, who never touches a phone by design. `young:
   * false` is the same mechanism for a grown-up without an account — a
   * grandparent whose phone will not finish an OAuth redirect on somebody's
   * guest wifi. The prototype's clearest finding was that a dinner party does
   * not want the account model at all; this is how much of that survives being
   * a mode inside an app that does.
   */
  dependents?: Dependent[];
}

export interface Dependent {
  name: string;
  young: boolean;
}

export interface UserDoc {
  name: string;
  email: string | null;
  gameIds: string[];
  /** Absent, or partial, means the missing kinds are on. See notify.ts. */
  notify?: Partial<Record<NotifyKind, boolean>>;
}

/** What the lobby, the seats and the deadline sweep need, whichever game it is. */
interface GameDocBase {
  status: GameStatus;
  createdBy: string;
  createdAt: Timestamp;
  playerCount: number;
  seats: (Seat | null)[];
  turn: number;
  deadlineAt: Timestamp | null;
  turnMinutes: number;
  remindedTurn: number;
  /** Drives combat RNG, and the party's deal; never leaves the server. */
  seed: string;
}

export interface WarGameDoc extends GameDocBase {
  /**
   * Absent on every document written before the party existed, which is
   * precisely what makes those documents keep working: `kind === 'party'` is
   * false for them, and every war-only field is still there.
   */
  kind?: 'war';
  presetId?: string;
  rules: RuleConfig;
  /** Canonical JSON; null until the game starts. */
  stateJson: string | null;
  mapJson: string;
}

export interface PartyGameDoc extends GameDocBase {
  kind: 'party';
  /** A tale is code, not data, so there will only ever be two or three. */
  tale: 'sleeping-beauty';
  /** Canonical JSON; null until the host deals. */
  partyJson: string | null;
}

export interface SacreGameDoc extends GameDocBase {
  kind: 'cards';
  /** Canonical JSON; null until the host deals. */
  sacreJson: string | null;
}

/**
 * A union rather than a wide record with everything optional, so the compiler
 * finds every war-only read — `rules`, `mapJson`, `stateJson` — instead of one
 * of them surfacing at runtime as a party game with no map.
 */
export type GameDoc = WarGameDoc | PartyGameDoc | SacreGameDoc;

export const isPartyDoc = (doc: GameDoc): doc is PartyGameDoc => doc.kind === 'party';
export const isSacreDoc = (doc: GameDoc): doc is SacreGameDoc => doc.kind === 'cards';

/**
 * Positive, not `kind !== 'party'`.
 *
 * That negative form was correct while there were two kinds and silently wrong
 * the moment there was a third: a cards document answered `true` here and then
 * failed on a `mapJson` it never had. A new kind must be invisible to this
 * predicate by default, which only a positive test gives you.
 */
export const isWarDoc = (doc: GameDoc): doc is WarGameDoc =>
  doc.kind === undefined || doc.kind === 'war';

export interface OrderDoc {
  ordersJson: string;
  locked: boolean;
  updatedAt: Timestamp;
}

/** Slots seated by humans (taken and not a bot). */
export const humanSlots = (seats: (Seat | null)[]): number[] =>
  seats.flatMap((s, slot) => (s !== null && !s.isBot ? [slot] : []));

/**
 * Human slots the turn still belongs to — whose orders are accepted, who is
 * nudged before the deadline, and who the all-locked shortcut waits for.
 *
 * Competitively that is everyone still alive. Cooperatively it also includes
 * players who have lost their last province, because their reads still pay the
 * coalition (`inContest`, packages/engine/src/participation.ts). A co-op game
 * that resolved without waiting for them would silently drop the contribution
 * the mode is built on.
 */
export const liveHumanSlots = (
  seats: (Seat | null)[],
  state: GameState,
  rules: RuleConfig,
): number[] => humanSlots(seats).filter((slot) => inContest(state, slot, rules));

export function initFirestore(projectId: string): Firestore {
  if (getApps().length === 0) initializeApp({ projectId });
  return getFirestore();
}

export const games = (db: Firestore): CollectionReference => db.collection('games');
export const ordersCol = (db: Firestore, gameId: string): CollectionReference =>
  games(db).doc(gameId).collection('orders');
export const reportsCol = (db: Firestore, gameId: string): CollectionReference =>
  games(db).doc(gameId).collection('reports');
export const usersCol = (db: Firestore): CollectionReference => db.collection('users');

export const orderDocId = (turn: number, slot: number): string => `${turn}-${slot}`;

export const serializeState = (state: GameState): string => canonicalJson(state);
export const serializeMap = (map: GeneratedMap): string => canonicalJson(map);
export const serializeParty = (state: PartyState): string => canonicalJson(state);

export const parseState = (doc: WarGameDoc): GameState | null => {
  if (doc.stateJson === null) return null;
  const state = JSON.parse(doc.stateJson) as GameState;
  // Games stored before the tiers contest lack the field.
  state.tiersLists ??= new Array<TiersList | null>(state.playerCount).fill(null);
  return state;
};
export const parseMap = (doc: WarGameDoc): GeneratedMap => JSON.parse(doc.mapJson) as GeneratedMap;

export const parseParty = (doc: PartyGameDoc): PartyState | null =>
  doc.partyJson === null ? null : (JSON.parse(doc.partyJson) as PartyState);

export const serializeSacre = (state: SacreState): string => canonicalJson(state);

export const parseSacre = (doc: SacreGameDoc): SacreState | null =>
  doc.sacreJson === null ? null : (JSON.parse(doc.sacreJson) as SacreState);

/**
 * The rules a game actually plays under. Stored rules win; rulesFor only
 * fills fields that games predating them never stored — the legacy-defaults
 * layer that keeps active games resolving exactly as they always did.
 */
export function effectiveRules(doc: WarGameDoc): RuleConfig {
  return {
    ...rulesFor(doc.playerCount, doc.rules.turnCap, doc.rules.contest ?? 'pact'),
    ...doc.rules,
  };
}
