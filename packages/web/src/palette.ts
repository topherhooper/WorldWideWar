/**
 * Seat colours.
 *
 * Twelve hues separated for deuteranopia and protanopia as well as normal
 * vision — the same set the map renderer uses, because a player who generated a
 * map preview should recognise their own colour when they sit down at it.
 */

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
