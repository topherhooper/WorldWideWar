/**
 * Game presets — the identity a game is created with.
 *
 * A preset fixes the contest, the payout mode and the pacing; players, turn
 * length and game length stay lobby-editable. Two layers of defaults exist on
 * purpose: DEFAULT_RULES/rulesFor is the legacy layer that backfills games
 * created before a knob existed, and presetRules is what new games actually
 * get. Every preset applies the anti-turtle economy — growth off, cheap
 * neutrals, plunder — because mechanics that reward doing nothing are not fun.
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
  },
];

export function presetById(id: string): GamePreset | null {
  return PRESETS.find((preset) => preset.id === id) ?? null;
}

/** The rules a NEW game gets: legacy base, preset pacing, anti-turtle economy. */
export function presetRules(
  preset: GamePreset,
  playerCount: number,
  turnCap: number,
): RuleConfig {
  return {
    ...rulesFor(playerCount, turnCap, preset.contest),
    warEconomyInterval: preset.warEconomyInterval,
    neutralGrowthInterval: 0,
    neutralGarrisonDelta: -1,
    plunderIncome: 1,
    plunderCap: 3,
    tiersPayout: preset.tiersPayout,
  };
}
