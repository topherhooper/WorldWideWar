/**
 * Bot personalities.
 *
 * A bot that plays the same correct move every turn makes a one-human game
 * sterile — and in a twelve-player free-for-all, eleven identical bots produce
 * a table with no politics at all. Personalities are seeded per bot, shown to
 * players as visible tags, and drive both how they fight and, more importantly,
 * who they trust.
 */

import type { Rng } from '../rng.js';
import type { Slot } from '../types.js';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface BotPersonality {
  slot: Slot;
  name: string;
  difficulty: Difficulty;
  /** Willingness to take a marginal attack. 0 cautious, 1 reckless. */
  aggression: number;
  /** Weight placed on region bonuses and captured capitals. */
  greed: number;
  /** Resistance to betraying a standing pact. 1 never defects unprompted. */
  loyalty: number;
  /** Chance of doing something deliberately unwise. */
  chaos: number;
  /** How hard a remembered betrayal is held against its author. */
  vengefulness: number;
  tags: string[];
}

const TITLES = [
  'Marshal',
  'Warden',
  'Consul',
  'Hetman',
  'Prefect',
  'Archon',
  'Steward',
  'Reeve',
  'Vizier',
  'Castellan',
  'Doge',
  'Margrave',
];

const NAMES = [
  'Vex',
  'Rhea',
  'Kord',
  'Sable',
  'Ianto',
  'Mira',
  'Dross',
  'Quill',
  'Nadir',
  'Ferrow',
  'Oleg',
  'Wren',
  'Talus',
  'Ceres',
  'Grim',
  'Ash',
];

export function makePersonality(rng: Rng, slot: Slot, difficulty: Difficulty): BotPersonality {
  const aggression = 0.25 + rng.float() * 0.6;
  const greed = 0.2 + rng.float() * 0.7;
  const loyalty = 0.2 + rng.float() * 0.7;
  const vengefulness = 0.3 + rng.float() * 0.7;

  // Easy bots are erratic rather than merely weak: a bot that plays a coherent
  // plan badly is far less fun to beat than one that is visibly impulsive.
  const chaos = difficulty === 'easy' ? 0.25 + rng.float() * 0.2 : rng.float() * 0.12;

  const tags: string[] = [];
  tags.push(aggression > 0.6 ? 'Aggressive' : aggression < 0.4 ? 'Cautious' : 'Measured');
  if (loyalty > 0.7) tags.push('Loyal');
  if (loyalty < 0.35) tags.push('Treacherous');
  if (vengefulness > 0.75) tags.push('Vengeful');
  if (greed > 0.7) tags.push('Grasping');
  if (chaos > 0.25) tags.push('Erratic');

  return {
    slot,
    name: `${TITLES[slot % TITLES.length]} ${NAMES[(slot * 5 + 3) % NAMES.length]}`,
    difficulty,
    aggression,
    greed,
    loyalty,
    chaos,
    vengefulness,
    tags,
  };
}

/**
 * Minimum win probability a bot demands before committing to an attack.
 *
 * Aggressive bots take fights at little better than a coin flip; cautious ones
 * want the fight already won before they start it.
 */
export function attackThreshold(personality: BotPersonality): number {
  const base = 0.75 - personality.aggression * 0.2;
  return personality.difficulty === 'easy' ? base - 0.1 : base;
}
