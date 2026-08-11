/** Seeded place names, so every generated world reads like a place. */

import type { Rng } from '../rng.js';

const ONSETS = [
  'Ka', 'Ve', 'Mor', 'Tal', 'Zan', 'Bre', 'Dro', 'Fen', 'Ges', 'Hal',
  'Ish', 'Jor', 'Kel', 'Lum', 'Mar', 'Nix', 'Oss', 'Pyr', 'Quin', 'Rav',
  'Sor', 'Thal', 'Ur', 'Vor', 'Wyn', 'Xan', 'Yar', 'Zeph', 'Cor', 'Dal',
];

const CODAS = [
  'dor', 'mir', 'esh', 'ash', 'ka', 'nor', 'vek', 'rim', 'tan', 'oth',
  'is', 'ur', 'an', 'eth', 'ok', 'ai', 'en', 'ul', 'ax', 'yr',
];

const REGION_SUFFIXES = [
  'Reach', 'Expanse', 'Marches', 'Vale', 'Wastes', 'Basin', 'Highlands',
  'Steppe', 'Hollow', 'Verge', 'Shelf', 'Downs',
];

/**
 * Generates `count` distinct territory names.
 *
 * Collisions are resolved by appending a roman numeral rather than by
 * resampling, so the name list stays a pure function of the draw order.
 */
export function territoryNames(rng: Rng, count: number): string[] {
  const used = new Set<string>();
  const out: string[] = [];

  for (let i = 0; i < count; i++) {
    let name = `${rng.pick(ONSETS)}${rng.pick(CODAS)}`;
    if (used.has(name)) {
      let suffix = 2;
      while (used.has(`${name} ${roman(suffix)}`)) suffix++;
      name = `${name} ${roman(suffix)}`;
    }
    used.add(name);
    out.push(name);
  }
  return out;
}

export function regionNames(rng: Rng, count: number): string[] {
  const used = new Set<string>();
  const out: string[] = [];

  for (let i = 0; i < count; i++) {
    let name = `The ${rng.pick(ONSETS)}${rng.pick(CODAS)} ${rng.pick(REGION_SUFFIXES)}`;
    if (used.has(name)) {
      let suffix = 2;
      while (used.has(`${name} ${roman(suffix)}`)) suffix++;
      name = `${name} ${roman(suffix)}`;
    }
    used.add(name);
    out.push(name);
  }
  return out;
}

const ROMAN: [number, string][] = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

function roman(value: number): string {
  let remaining = value;
  let out = '';
  for (const [amount, numeral] of ROMAN) {
    while (remaining >= amount) {
      out += numeral;
      remaining -= amount;
    }
  }
  return out;
}
