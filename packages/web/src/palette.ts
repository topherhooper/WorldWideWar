/**
 * Seat colours.
 *
 * Twelve hues separated for deuteranopia and protanopia as well as normal
 * vision — the same set the map renderer uses, because a player who generated a
 * map preview should recognise their own colour when they sit down at it.
 */

import { s } from './dom.js';

export const PLAYER_COLOURS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#bfef45',
  '#fabed4',
  '#469990',
  '#dcbeff',
  '#9a6324',
];

export function colourFor(slot: number | null): string {
  if (slot === null || slot < 0) return '#5b6478';
  return PLAYER_COLOURS[slot % PLAYER_COLOURS.length];
}

/**
 * A seat's colour chip.
 *
 * Drawn as an SVG rather than a coloured `<span>` for a security reason: an
 * inline `style` attribute would force `style-src 'unsafe-inline'` into the
 * content security policy, and a per-seat CSS class would mean maintaining a
 * second copy of this palette in the stylesheet. `fill` is a presentation
 * attribute, not a style, so it stays out of the policy's way and the colours
 * keep exactly one home.
 */
export function swatch(slot: number | null): SVGElement {
  return s(
    'svg',
    { class: 'swatch', viewBox: '0 0 10 10', 'aria-hidden': 'true', focusable: 'false' },
    s('rect', { width: 10, height: 10, rx: 2.5, fill: colourFor(slot) }),
  );
}
