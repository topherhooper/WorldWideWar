import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type CollectionReference, type Firestore } from 'firebase-admin/firestore';
import type { Timestamp } from 'firebase-admin/firestore';
import { canonicalJson } from '@www/engine';
import type { GameState, GeneratedMap, RuleConfig } from '@www/engine';

import type { GameStatus } from './api-types.js';

export interface Seat {
  uid: string | null;
  name: string;
  email: string | null;
  isBot: boolean;
}

export interface GameDoc {
  status: GameStatus;
  createdBy: string;
  createdAt: Timestamp;
  playerCount: number;
  seats: (Seat | null)[];
  turn: number;
  deadlineAt: Timestamp | null;
  turnMinutes: number;
  remindedTurn: number;
  /** Drives combat RNG; never leaves the server. */
  seed: string;
  rules: RuleConfig;
  /** Canonical JSON; null until the game starts. */
  stateJson: string | null;
  mapJson: string;
}

export interface OrderDoc {
  ordersJson: string;
  locked: boolean;
  updatedAt: Timestamp;
}

/** Slots seated by humans (taken and not a bot). */
export const humanSlots = (seats: (Seat | null)[]): number[] =>
  seats.flatMap((s, slot) => (s !== null && !s.isBot ? [slot] : []));

/** Human slots still alive in the game. */
export const liveHumanSlots = (seats: (Seat | null)[], state: GameState): number[] =>
  humanSlots(seats).filter((slot) => state.status[slot] === 'active');

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

export const parseState = (doc: GameDoc): GameState | null =>
  doc.stateJson === null ? null : (JSON.parse(doc.stateJson) as GameState);
export const parseMap = (doc: GameDoc): GeneratedMap => JSON.parse(doc.mapJson) as GeneratedMap;
