import { describe, expect, it } from 'vitest';

import {
  MAX_TURN_CAP,
  MAX_TURN_MINUTES,
  MIN_TURN_CAP,
  MIN_TURN_MINUTES,
  rulesFor,
} from './constants.js';
import { PRESETS, presetById, presetRules, presetsForDate, type GamePreset } from './presets.js';

/**
 * Every rule a preset must satisfy, as a list of complaints. Empty means valid.
 *
 * The catalogue grows by one generated preset a day, so this has to validate a
 * preset nobody has seen rather than recognise the ones somebody wrote. It
 * lives in the test file on purpose: the daily routine runs `pnpm test`, which
 * runs this, and an exported validator with one caller is an abstraction the
 * design did not ask for.
 */
function problemsWith(preset: GamePreset, all: readonly GamePreset[]): string[] {
  const problems: string[] = [];
  const say = (ok: boolean, complaint: string): void => {
    if (!ok) problems.push(complaint);
  };
  const inRange = (value: number, lo: number, hi: number): boolean =>
    Number.isInteger(value) && value >= lo && value <= hi;

  say(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(preset.id), 'id must be kebab-case');
  say(all.filter((p) => p.id === preset.id).length === 1, 'id must be unique');
  say(preset.name.trim().length > 0, 'name must not be blank');
  say(preset.tagline.trim().length > 0, 'tagline must not be blank');
  say(preset.tagline.length <= 64, 'tagline must fit a card');
  say(preset.contest === 'pact' || preset.contest === 'tiers', 'contest must be a real contest');
  say(
    preset.tiersPayout === 'multiplier' || preset.tiersPayout === 'income',
    'tiersPayout must be a real payout',
  );

  say(inRange(preset.defaultTurnCap, MIN_TURN_CAP, MAX_TURN_CAP), 'turn cap out of bounds');
  say(
    inRange(preset.defaultTurnMinutes, MIN_TURN_MINUTES, MAX_TURN_MINUTES),
    'turn length out of bounds',
  );
  say(inRange(preset.warEconomyInterval, 1, 10), 'warEconomyInterval out of bounds');
  // -3 is the floor because garrisons floor at 1: below -2 the knob stops doing
  // anything, so a preset reaching for it has misunderstood the lever.
  say(inRange(preset.neutralGarrisonDelta, -3, 0), 'neutralGarrisonDelta out of bounds');
  say(inRange(preset.plunderIncome, 0, 3), 'plunderIncome out of bounds');

  if (preset.featuredOn !== undefined) {
    say(/^\d{4}-\d{2}-\d{2}$/.test(preset.featuredOn), 'featuredOn must be an ISO date');
    say(
      all.filter((p) => p.featuredOn === preset.featuredOn).length === 1,
      'two presets claim the same day',
    );
  }

  // Novelty, mechanically: a preset that tunes identically to another one is
  // the same game wearing a different name.
  const tuning = (p: GamePreset): string =>
    [
      p.contest,
      p.tiersPayout,
      p.defaultTurnCap,
      p.defaultTurnMinutes,
      p.warEconomyInterval,
      p.neutralGarrisonDelta,
      p.plunderIncome,
    ].join('/');
  say(all.filter((p) => tuning(p) === tuning(preset)).length === 1, 'tuning duplicates another');

  return problems;
}

describe('every preset in the catalogue', () => {
  it.each(PRESETS.map((preset) => [preset.id, preset] as const))('%s is valid', (_id, preset) => {
    expect(problemsWith(preset, PRESETS)).toEqual([]);
  });

  it('still ships the four evergreen presets, undated', () => {
    expect(PRESETS.filter((p) => p.featuredOn === undefined).map((p) => p.id)).toEqual([
      'pact',
      'tiers',
      'pact-blitz',
      'tiers-v2',
    ]);
    expect(presetById('nope')).toBeNull();
  });

  it('applies the anti-turtle economy to all of them', () => {
    for (const preset of PRESETS) {
      const rules = presetRules(preset, 6, preset.defaultTurnCap);
      expect(rules.neutralGrowthInterval).toBe(0);
      expect(rules.plunderCap).toBe(3);
    }
  });
});

describe('the validator itself', () => {
  /** Valid, and deliberately not a clone of anything shipped. */
  const CANDIDATE: GamePreset = {
    id: 'candidate',
    name: 'Candidate',
    tagline: 'A preset under review.',
    contest: 'pact',
    tiersPayout: 'multiplier',
    defaultTurnCap: 30,
    defaultTurnMinutes: 720,
    warEconomyInterval: 4,
    neutralGarrisonDelta: -1,
    plunderIncome: 1,
  };

  const complaintsFor = (preset: GamePreset): string[] =>
    problemsWith(preset, [...PRESETS, preset]);

  it('accepts a well-formed newcomer', () => {
    expect(complaintsFor(CANDIDATE)).toEqual([]);
  });

  const bad: readonly (readonly [string, Partial<GamePreset>, string])[] = [
    ['a shouted id', { id: 'Not Kebab' }, 'id must be kebab-case'],
    ['a blank tagline', { tagline: '  ' }, 'tagline must not be blank'],
    ['a novel-length tagline', { tagline: 'x'.repeat(65) }, 'tagline must fit a card'],
    ['a year-long game', { defaultTurnCap: 500 }, 'turn cap out of bounds'],
    ['a one-minute turn', { defaultTurnMinutes: 1 }, 'turn length out of bounds'],
    ['a fractional turn', { defaultTurnMinutes: 90.5 }, 'turn length out of bounds'],
    ['no war economy', { warEconomyInterval: 0 }, 'warEconomyInterval out of bounds'],
    ['erased neutrals', { neutralGarrisonDelta: -40 }, 'neutralGarrisonDelta out of bounds'],
    ['runaway plunder', { plunderIncome: 99 }, 'plunderIncome out of bounds'],
    ['a European date', { featuredOn: '14/08/2026' }, 'featuredOn must be an ISO date'],
    [
      'a made-up contest',
      { contest: 'duel' as GamePreset['contest'] },
      'contest must be a real contest',
    ],
  ];

  it.each(bad)('rejects %s', (_label, patch, complaint) => {
    expect(complaintsFor({ ...CANDIDATE, ...patch })).toContain(complaint);
  });

  it('rejects a rename of a shipped preset', () => {
    const clone: GamePreset = { ...presetById('pact-blitz')!, id: 'pact-blitz-again' };
    expect(complaintsFor(clone)).toContain('tuning duplicates another');
  });

  it('rejects a second preset claiming a day that is taken', () => {
    const monday = { ...CANDIDATE, featuredOn: '2026-08-17' };
    const alsoMonday = { ...CANDIDATE, id: 'also-monday', featuredOn: '2026-08-17' };
    expect(problemsWith(alsoMonday, [...PRESETS, monday, alsoMonday])).toContain(
      'two presets claim the same day',
    );
  });
});

describe('presets', () => {
  it('classic presets are the classic contests plus the anti-turtle economy', () => {
    const pact = presetById('pact')!;
    expect(pact.defaultTurnCap).toBe(25);
    expect(pact.defaultTurnMinutes).toBe(1440);
    expect(presetRules(pact, 6, 25)).toEqual({
      ...rulesFor(6, 25, 'pact'),
      neutralGrowthInterval: 0,
      neutralGarrisonDelta: -1,
      plunderIncome: 1,
      plunderCap: 3,
    });
    expect(presetById('tiers')!.contest).toBe('tiers');
    expect(presetById('tiers')!.tiersPayout).toBe('multiplier');
  });

  it('blitz presets run short, hot games', () => {
    for (const id of ['pact-blitz', 'tiers-v2'] as const) {
      const preset = presetById(id)!;
      expect(preset.defaultTurnCap).toBe(15);
      expect(preset.defaultTurnMinutes).toBe(60);
      const rules = presetRules(preset, 6, preset.defaultTurnCap);
      expect(rules.warEconomyInterval).toBe(3);
      expect(rules.stormFirstWave).toBe(6); // rulesFor already scales storm to the cap
      // Hotter than the classics on purpose: a 15-turn clock needs the economy
      // to reward taking ground, or the cap decides the game instead of a win.
      expect(rules.neutralGarrisonDelta).toBe(-2);
      expect(rules.plunderIncome).toBe(2);
    }
  });

  it('tiers v2 pays income', () => {
    const rules = presetRules(presetById('tiers-v2')!, 4, 15);
    expect(rules.contest).toBe('tiers');
    expect(rules.tiersPayout).toBe('income');
  });
});

describe('presetsForDate', () => {
  it('offers every evergreen preset on any date', () => {
    const ids = presetsForDate('2026-08-14').map((p) => p.id);
    for (const preset of PRESETS.filter((p) => p.featuredOn === undefined)) {
      expect(ids).toContain(preset.id);
    }
  });

  it('offers a daily preset on its date and no other', () => {
    for (const daily of PRESETS.filter((p) => p.featuredOn !== undefined)) {
      expect(presetsForDate(daily.featuredOn!).map((p) => p.id)).toContain(daily.id);
      expect(presetsForDate('1999-12-31').map((p) => p.id)).not.toContain(daily.id);
    }
  });

  it('stays playable by id after its day', () => {
    for (const daily of PRESETS.filter((p) => p.featuredOn !== undefined)) {
      expect(presetById(daily.id)).not.toBeNull();
    }
  });
});
