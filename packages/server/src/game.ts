/**
 * Game lifecycle: everything that happens to a table between "create" and
 * "somebody won".
 *
 * The engine is a pure function of (state, orders, ctx). This module owns the
 * two things it deliberately refuses to know about — who is allowed to submit
 * what, and when the turn is due — and nothing else. Wall-clock and id
 * generation arrive as injected dependencies so the whole lifecycle can be
 * driven forward instantly in a test rather than waited out in real time.
 */

import {
  assistOrders,
  createInitialState,
  decideOrders,
  fogActive,
  generateMap,
  makePersonality,
  MAX_PLAYERS,
  MIN_PLAYERS,
  redact,
  resolveTurn,
  rulesFor,
  substream,
  type BotPersonality,
  type Difficulty,
  type GameState,
  type GeneratedMap,
  type OrderSet,
  type RuleConfig,
  type Slot,
  type TurnReport,
} from '@www/engine';
import type { CreateGameRequest, GamePhase, SeatKind } from './protocol.js';

export const MIN_TURN_SECONDS = 10;
export const MAX_TURN_SECONDS = 7 * 24 * 60 * 60;
/** How long the server pauses between turns once only bots are left playing. */
export const BOT_TURN_DELAY_MS = 1500;

export interface GameDeps {
  now: () => number;
  /** Opaque, unguessable identifier. Used for both game ids and seat tokens. */
  uid: () => string;
}

export interface Seat {
  slot: Slot;
  name: string;
  kind: SeatKind;
  /** Secret. Leaves the server exactly once, to the player who claimed it. */
  token: string | null;
  /** Working orders for the current turn. Never sent to anyone else. */
  draft: OrderSet | null;
  /** Draft is locked in; the turn may resolve without waiting for this seat. */
  locked: boolean;
  lastSeen: number;
}

export interface GameRecord {
  id: string;
  code: string;
  phase: GamePhase;
  seed: string;
  playerCount: number;
  difficulty: Difficulty;
  turnSeconds: number;
  createdAt: number;
  hostToken: string;
  map: GeneratedMap;
  rules: RuleConfig;
  state: GameState;
  seats: Seat[];
  personalities: BotPersonality[];
  history: TurnReport[];
  /** Epoch ms at which the current turn resolves. Null while in the lobby. */
  deadline: number | null;
  version: number;
}

export class GameError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

// ─── Creation ────────────────────────────────────────────────────────────────

export function createGame(request: CreateGameRequest, deps: GameDeps): GameRecord {
  const playerCount = intInRange(request.playerCount, MIN_PLAYERS, MAX_PLAYERS, 'player count');
  const humanSeats = intInRange(request.humanSeats, 1, playerCount, 'human seat count');
  const turnSeconds = intInRange(
    request.turnSeconds,
    MIN_TURN_SECONDS,
    MAX_TURN_SECONDS,
    'turn length',
  );
  const difficulty = parseDifficulty(request.difficulty);
  const seed = (request.seed ?? deps.uid()).slice(0, 64) || deps.uid();

  const map = generateMap(seed, playerCount);
  const rules = rulesFor(playerCount);
  const state = createInitialState(map, rules);
  const now = deps.now();

  const personalities = Array.from({ length: playerCount }, (_, slot) =>
    makePersonality(substream(seed, 'personality', slot), slot, difficulty),
  );

  // Human seats come first so that a partly-filled table still seats its humans
  // in low slots, which keeps the player list stable as bots fill in behind.
  const seats: Seat[] = Array.from({ length: playerCount }, (_, slot) => ({
    slot,
    name: slot < humanSeats ? `Seat ${slot + 1}` : personalities[slot].name,
    kind: slot < humanSeats ? 'human' : 'bot',
    token: null,
    draft: null,
    locked: false,
    lastSeen: now,
  }));

  const game: GameRecord = {
    id: deps.uid(),
    code: makeCode(deps),
    phase: 'lobby',
    seed,
    playerCount,
    difficulty,
    turnSeconds,
    createdAt: now,
    hostToken: '',
    map,
    rules,
    state,
    seats,
    personalities,
    history: [],
    deadline: null,
    version: 1,
  };

  // The creator is seated immediately. Being host is not a separate credential:
  // it is simply whoever holds seat zero's token.
  const host = joinGame(game, request.name, deps);
  game.hostToken = host.token as string;

  return game;
}

// ─── Joining ─────────────────────────────────────────────────────────────────

export function joinGame(game: GameRecord, name: string, deps: GameDeps): Seat {
  if (game.phase !== 'lobby') throw new GameError('this game has already started', 409);

  const seat = game.seats.find((candidate) => candidate.kind === 'human' && !candidate.token);
  if (!seat) throw new GameError('no open seats', 409);

  seat.token = deps.uid();
  seat.name = cleanName(name) ?? `Seat ${seat.slot + 1}`;
  seat.lastSeen = deps.now();
  game.version++;

  // A table nobody else is expected at should not sit in a lobby waiting for
  // nobody — a solo game against bots starts the moment it is created.
  if (lobbyFull(game)) startGame(game, deps);

  return seat;
}

export function seatFor(game: GameRecord, token: string | null): Seat | null {
  if (!token) return null;
  return game.seats.find((seat) => seat.token === token) ?? null;
}

export function openSeats(game: GameRecord): number {
  if (game.phase !== 'lobby') return 0;
  return game.seats.filter((seat) => seat.kind === 'human' && !seat.token).length;
}

/** Everyone who claimed a seat is here. Used to start without waiting. */
export function lobbyFull(game: GameRecord): boolean {
  return openSeats(game) === 0;
}

export function startGame(game: GameRecord, deps: GameDeps): void {
  if (game.phase === 'active') return;
  if (game.phase === 'finished') throw new GameError('this game is over', 409);

  const claimed = game.seats.filter((seat) => seat.kind === 'human' && seat.token);
  if (claimed.length === 0) throw new GameError('nobody has joined yet', 409);

  // Unclaimed human seats become bots rather than sitting idle: an empty seat
  // in a free-for-all is free food, and warps the game around whoever borders
  // it.
  for (const seat of game.seats) {
    if (seat.kind === 'human' && !seat.token) {
      seat.kind = 'bot';
      seat.name = game.personalities[seat.slot].name;
    }
  }

  game.phase = 'active';
  game.deadline = nextDeadline(game, deps.now());
  game.version++;
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export function submitOrders(
  game: GameRecord,
  seat: Seat,
  orders: OrderSet,
  locked: boolean,
  deps: GameDeps,
): void {
  if (game.phase !== 'active') throw new GameError('the game is not running', 409);
  if (game.state.status[seat.slot] !== 'active') {
    throw new GameError('you are no longer in this game', 409);
  }

  seat.draft = { ...orders, slot: seat.slot };
  seat.locked = locked;
  seat.lastSeen = deps.now();
  game.version++;

  maybeResolve(game, deps);
}

export function resign(game: GameRecord, seat: Seat, deps: GameDeps): void {
  if (game.phase !== 'active') throw new GameError('the game is not running', 409);
  if (game.state.status[seat.slot] !== 'active') return;

  game.state.status[seat.slot] = 'resigned';
  game.state.income[seat.slot] = 0;
  seat.draft = null;
  seat.locked = false;

  // Walking away from the last human seat should not leave everyone else
  // watching a full-length clock run down on a table of bots.
  if (liveHumanSeats(game).length === 0 && game.deadline !== null) {
    game.deadline = Math.min(game.deadline, deps.now() + BOT_TURN_DELAY_MS);
  }
  game.version++;

  // A resignation can be the last thing a turn was waiting on.
  maybeResolve(game, deps);
}

/** Claimed human seats still in the game — the ones a turn actually waits on. */
export function liveHumanSeats(game: GameRecord): Seat[] {
  return game.seats.filter(
    (seat) =>
      seat.kind === 'human' && seat.token !== null && game.state.status[seat.slot] === 'active',
  );
}

/** Live human seats that have not locked in yet. */
export function pendingSeats(game: GameRecord): Seat[] {
  return liveHumanSeats(game).filter((seat) => !seat.locked);
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/**
 * Resolves the turn if it is due — either every live human has locked in, or
 * the deadline has passed. Returns whether anything happened.
 */
export function maybeResolve(game: GameRecord, deps: GameDeps): boolean {
  if (game.phase !== 'active') return false;

  const now = deps.now();
  // "Everyone is ready" is only a reason to resolve when there is somebody to
  // be ready: a table of bots would otherwise resolve every time anything
  // touched it, and race through the game as fast as it was polled.
  const humans = liveHumanSeats(game);
  const everyoneReady = humans.length > 0 && humans.every((seat) => seat.locked);
  const overdue = game.deadline !== null && now >= game.deadline;
  if (!everyoneReady && !overdue) return false;

  resolveNow(game, deps);
  return true;
}

export function resolveNow(game: GameRecord, deps: GameDeps): TurnReport {
  const { state, map, rules, seed } = game;
  const submissions: (OrderSet | null)[] = [];

  for (let slot = 0; slot < game.playerCount; slot++) {
    submissions.push(submissionFor(game, slot));
  }

  const { next, report } = resolveTurn(state, submissions, { seed, map, rules });

  game.state = next;
  game.history.push(report);

  for (const seat of game.seats) {
    seat.draft = null;
    seat.locked = false;
  }

  if (next.result) {
    game.phase = 'finished';
    game.deadline = null;
  } else {
    game.deadline = nextDeadline(game, deps.now());
  }

  game.version++;
  return report;
}

function submissionFor(game: GameRecord, slot: Slot): OrderSet | null {
  const { state, map, seed } = game;
  if (state.status[slot] !== 'active') return null;

  const seat = game.seats[slot];
  // Bots and the missed-deadline assistant both plan from the *redacted* state,
  // so neither can act on anything the human in that seat could not have seen.
  const view = redact(state, slot);
  const personality = game.personalities[slot];

  if (seat.kind === 'bot') {
    return decideOrders(view, map, slot, substream(seed, state.turn, 'bot', slot), personality);
  }

  if (seat.locked && seat.draft) return seat.draft;

  // A missed turn still has to be a competent turn: the assistant fills the
  // gaps around whatever the player had drafted, rather than passing.
  return assistOrders(
    view,
    map,
    slot,
    substream(seed, state.turn, 'assist', slot),
    personality,
    seat.draft,
  );
}

function nextDeadline(game: GameRecord, now: number): number {
  // Once every human is out, the table is just bots playing each other. Run it
  // at a watchable pace instead of making spectators sit through the clock.
  const humansPlaying = liveHumanSeats(game).length > 0;
  return now + (humansPlaying ? game.turnSeconds * 1000 : BOT_TURN_DELAY_MS);
}

// ─── Derived reads ───────────────────────────────────────────────────────────

export function fogged(game: GameRecord): boolean {
  return fogActive(game.state);
}

export function latestReport(game: GameRecord): TurnReport | null {
  return game.history.length > 0 ? game.history[game.history.length - 1] : null;
}

// ─── Input hygiene ───────────────────────────────────────────────────────────

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Collapse whitespace and drop control characters: this string is rendered in
  // every other player's browser.
  const name = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return name.length > 0 ? name : null;
}

function intInRange(value: unknown, min: number, max: number, label: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new GameError(`${label} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

function parseDifficulty(raw: unknown): Difficulty {
  return raw === 'easy' || raw === 'hard' ? raw : 'normal';
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Short, human-shareable, and free of characters that look like each other. */
function makeCode(deps: GameDeps): string {
  const source = deps.uid().replace(/[^0-9a-f]/gi, '');
  let code = '';
  for (let i = 0; i < 6; i++) {
    const value = parseInt(source.slice(i * 2, i * 2 + 2) || '0', 16);
    code += CODE_ALPHABET[value % CODE_ALPHABET.length];
  }
  return code;
}
