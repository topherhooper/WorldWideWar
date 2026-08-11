/**
 * Bot-vs-bot game runner.
 *
 * The balance harness lives on top of this. Because resolution is pure and
 * everything is seeded, a summary here is exactly reproducible from its seed —
 * which is what makes it usable as a CI gate rather than a vibe check.
 */

import {
  decideOrders,
  makePersonality,
  type BotPersonality,
  type Difficulty,
} from './bot/index.js';
import { rulesFor } from './constants.js';
import { generateMap } from './mapgen/generate.js';
import { redact } from './redact.js';
import { substream } from './rng.js';
import { createInitialState } from './setup.js';
import { resolveTurn } from './resolve.js';
import { territoryCount } from './supply.js';
import type {
  GameResult,
  GameState,
  GeneratedMap,
  OrderSet,
  PactOutcome,
  RuleConfig,
  Slot,
  TurnReport,
} from './types.js';

export interface SimulateOptions {
  seed: string;
  playerCount: number;
  difficulty?: Difficulty;
  rules?: RuleConfig;
  /** Retain every turn report; off by default to keep bulk runs cheap. */
  keepHistory?: boolean;
}

export interface GameSummary {
  seed: string;
  playerCount: number;
  turns: number;
  result: GameResult;
  winners: Slot[];
  kind: GameResult['kind'];
  /** Final rank per slot, 0 = best. */
  rankBySlot: number[];
  pactOutcomes: Record<PactOutcome, number>;
  /** Turns on which at least one pledge was made. */
  pledgesMade: number;
  /** Turn of the first territory capture, or null. */
  firstBloodTurn: number | null;
  territoriesCaptured: number;
  /** Largest share of live territory any single player ever held. */
  peakShare: number;
  history?: TurnReport[];
  finalState: GameState;
  map: GeneratedMap;
  personalities: BotPersonality[];
}

const EMPTY_OUTCOMES = (): Record<PactOutcome, number> => ({
  concord: 0,
  betrayal: 0,
  betrayed: 0,
  mutual_treachery: 0,
  spurned: 0,
  courted: 0,
  abstain: 0,
});

export function playBotGame(options: SimulateOptions): GameSummary {
  const { seed, playerCount } = options;
  const rules = options.rules ?? rulesFor(playerCount);
  const difficulty = options.difficulty ?? 'normal';

  const map = generateMap(seed, playerCount);
  let state = createInitialState(map, rules);

  const personalities = Array.from({ length: playerCount }, (_, slot) =>
    makePersonality(substream(seed, 'personality', slot), slot, difficulty),
  );

  const pactOutcomes = EMPTY_OUTCOMES();
  const history: TurnReport[] = [];
  let firstBloodTurn: number | null = null;
  let territoriesCaptured = 0;
  let pledgesMade = 0;
  let peakShare = 0;

  // Hard ceiling well above the rule turn cap: if resolution ever failed to
  // terminate, a bulk run should fail loudly rather than hang a CI job.
  const safetyLimit = rules.turnCap + 5;

  while (state.result === null && state.turn <= safetyLimit) {
    const submissions: (OrderSet | null)[] = [];

    for (let slot = 0; slot < playerCount; slot++) {
      if (state.status[slot] !== 'active') {
        submissions.push(null);
        continue;
      }
      // Bots plan from redacted state, so they physically cannot see anything a
      // human in the same seat could not.
      const view = redact(state, slot);
      const rng = substream(seed, state.turn, 'bot', slot);
      submissions.push(decideOrders(view, map, slot, rng, personalities[slot]));
    }

    const { next, report } = resolveTurn(state, submissions, { seed, map, rules });

    for (const pact of report.pacts) {
      pactOutcomes[pact.outcome]++;
      if (pact.pledged !== null) pledgesMade++;
    }
    const captures = report.battles.filter((battle) => battle.captured).length;
    if (captures > 0 && firstBloodTurn === null) firstBloodTurn = report.turn;
    territoriesCaptured += captures;

    if (options.keepHistory) history.push(report);

    state = next;

    const live = state.collapsed.filter((c) => !c).length;
    if (live > 0) {
      for (let slot = 0; slot < playerCount; slot++) {
        peakShare = Math.max(peakShare, territoryCount(state, slot) / live);
      }
    }
  }

  const result: GameResult = state.result ?? {
    kind: 'turn_cap',
    winners: [],
    standings: Array.from({ length: playerCount }, (_, slot) => slot),
  };

  const rankBySlot = new Array<number>(playerCount).fill(playerCount - 1);
  result.standings.forEach((slot, rank) => {
    rankBySlot[slot] = rank;
  });

  return {
    seed,
    playerCount,
    turns: state.turn - 1,
    result,
    winners: result.winners,
    kind: result.kind,
    rankBySlot,
    pactOutcomes,
    pledgesMade,
    firstBloodTurn,
    territoriesCaptured,
    peakShare,
    ...(options.keepHistory ? { history } : {}),
    finalState: state,
    map,
    personalities,
  };
}
