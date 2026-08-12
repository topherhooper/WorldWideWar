/**
 * Turning a `GameRecord` into what one particular viewer is allowed to see.
 *
 * Every read path out of the server funnels through here, and every one of them
 * builds its numbers from the *already redacted* state rather than the raw
 * record — so a summary line cannot leak a strength that the map itself is
 * hiding.
 */

import {
  EVENT_DESCRIPTIONS,
  HIDDEN_ARMIES,
  redact,
  warnedTerritories,
  type GameState,
  type Slot,
} from '@www/engine';
import { fogged, latestReport, openSeats, type GameRecord, type Seat } from './game.js';
import type { GameView, LobbyEntry, PlayerView } from './protocol.js';

export function buildView(
  game: GameRecord,
  seat: Seat | null,
  isHost: boolean,
  now: number,
): GameView {
  const viewer = seat ? seat.slot : null;
  const inPlay = game.phase !== 'lobby';
  const state = redact(game.state, viewer);

  return {
    id: game.id,
    code: game.code,
    phase: game.phase,
    turn: game.state.turn,
    playerCount: game.playerCount,
    seed: game.seed,
    turnSeconds: game.turnSeconds,
    deadline: game.deadline,
    serverTime: now,
    version: game.version,
    rules: game.rules,
    you: seat ? { slot: seat.slot, name: seat.name, isHost } : null,
    players: game.seats.map((each) => playerView(game, each, state)),
    state: inPlay ? state : null,
    draft: seat?.draft ?? null,
    locked: seat?.locked ?? false,
    report: latestReport(game),
    fog: fogged(game),
    warned: inPlay ? warnedTerritories(game.map, game.state.turn, game.rules) : [],
    eventDescriptions: EVENT_DESCRIPTIONS,
    result: game.state.result,
  };
}

function playerView(game: GameRecord, seat: Seat, state: GameState): PlayerView {
  const slot = seat.slot;
  let territories = 0;
  let armies = 0;
  let hidden = false;

  for (let id = 0; id < state.owner.length; id++) {
    if (state.owner[id] !== slot || state.collapsed[id]) continue;
    territories++;
    if (state.armies[id] === HIDDEN_ARMIES) hidden = true;
    else armies += state.armies[id];
  }

  return {
    slot,
    name: seat.name,
    kind: seat.kind,
    status: state.status[slot],
    ready: seat.locked,
    open: game.phase === 'lobby' && seat.kind === 'human' && seat.token === null,
    tags: seat.kind === 'bot' ? game.personalities[slot].tags : [],
    territories,
    armies: hidden ? null : armies,
    income: state.income[slot],
    pactsHonored: state.pactsHonored[slot],
    pactsBroken: state.pactsBroken[slot],
    streak: state.pactStreak[slot],
    partner: state.pactPartner[slot] as Slot | null,
  };
}

export function lobbyEntry(game: GameRecord): LobbyEntry {
  return {
    id: game.id,
    code: game.code,
    phase: game.phase,
    playerCount: game.playerCount,
    openSeats: openSeats(game),
    turnSeconds: game.turnSeconds,
    turn: game.state.turn,
    createdAt: game.createdAt,
  };
}
