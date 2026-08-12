/** The Tiers contest. Scoring and resolution arrive with the contest core. */

/**
 * Collapses an entry to its identity: lowercased, accents folded, everything
 * that is not a letter or digit removed — "McDonald's" and "mcdonalds" are the
 * same item. Used for duplicate detection and bot popularity lookups, never
 * for display.
 */
export function normalizeItemText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
