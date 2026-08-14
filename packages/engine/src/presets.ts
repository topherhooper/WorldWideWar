/**
 * Game presets — the identity a game is created with.
 *
 * A preset fixes the contest, the payout mode and the pacing; players, turn
 * length and game length stay lobby-editable. Two layers of defaults exist on
 * purpose: DEFAULT_RULES/rulesFor is the legacy layer that backfills games
 * created before a knob existed, and presetRules is what new games actually
 * get. Every preset applies the anti-turtle economy — growth off, cheap
 * neutrals, plunder — because mechanics that reward doing nothing are not fun.
 *
 * The blitz presets run that economy hotter (neutrals at -2, plunder at 2)
 * because a 15-turn clock is otherwise too short to reach a victory condition:
 * measured at the classic -1/1, half of six-player pact-blitz games and
 * two-thirds of tiers-v2 games were decided by the turn cap rather than won.
 * Note that the lever has to be *asymmetric* — rewarding the player taking
 * ground. Ramping warEconomyInterval to 2 instead pays attacker and defender
 * alike and measurably entrenched the stalemate it was meant to break, and
 * -3 neutrals is indistinguishable from -2 because garrisons floor at 1.
 */

import { rulesFor } from './constants.js';
import type { ContestKind, RuleConfig, TiersPayout } from './types.js';

export type PresetId = 'pact' | 'tiers' | 'pact-blitz' | 'tiers-v2';

export interface GamePreset {
  id: PresetId;
  name: string;
  tagline: string;
  contest: ContestKind;
  tiersPayout: TiersPayout;
  defaultTurnCap: number;
  defaultTurnMinutes: number;
  /** The war economy ramps +1 income every N turns; blitz presets ramp hotter. */
  warEconomyInterval: number;
  /** Added to each mapgen neutral garrison at setup; blitz makes neutrals cheaper. */
  neutralGarrisonDelta: number;
  /** Bonus income next turn per territory captured this turn. */
  plunderIncome: number;
}

export const PRESETS: readonly GamePreset[] = [
  {
    id: 'pact',
    name: 'Pact',
    tagline: 'Pledge & betray — the classic game.',
    contest: 'pact',
    tiersPayout: 'multiplier',
    defaultTurnCap: 25,
    defaultTurnMinutes: 1440,
    warEconomyInterval: 5,
    neutralGarrisonDelta: -1,
    plunderIncome: 1,
  },
  {
    id: 'tiers',
    name: 'Tiers',
    tagline: 'Read your rivals — lists drive combat.',
    contest: 'tiers',
    tiersPayout: 'multiplier',
    defaultTurnCap: 25,
    defaultTurnMinutes: 1440,
    warEconomyInterval: 5,
    neutralGarrisonDelta: -1,
    plunderIncome: 1,
  },
  {
    id: 'pact-blitz',
    name: 'Pact Blitz',
    tagline: 'The classic, fast — early storm, hot economy.',
    contest: 'pact',
    tiersPayout: 'multiplier',
    defaultTurnCap: 15,
    defaultTurnMinutes: 60,
    warEconomyInterval: 3,
    neutralGarrisonDelta: -2,
    plunderIncome: 2,
  },
  {
    id: 'tiers-v2',
    name: 'Tiers v2',
    tagline: 'Reads pay armies, not combat luck — fast-paced.',
    contest: 'tiers',
    tiersPayout: 'income',
    defaultTurnCap: 15,
    defaultTurnMinutes: 60,
    warEconomyInterval: 3,
    neutralGarrisonDelta: -2,
    plunderIncome: 2,
  },
];

export function presetById(id: string): GamePreset | null {
  return PRESETS.find((preset) => preset.id === id) ?? null;
}

/** The rules a NEW game gets: legacy base, preset pacing, anti-turtle economy. */
export function presetRules(preset: GamePreset, playerCount: number, turnCap: number): RuleConfig {
  return {
    ...rulesFor(playerCount, turnCap, preset.contest),
    warEconomyInterval: preset.warEconomyInterval,
    neutralGrowthInterval: 0,
    neutralGarrisonDelta: preset.neutralGarrisonDelta,
    plunderIncome: preset.plunderIncome,
    plunderCap: 3,
    tiersPayout: preset.tiersPayout,
  };
}
