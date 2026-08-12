import { describe, expect, it } from 'vitest';

import { normalizeItemText } from './tiers.js';
import { TIERS_TOPICS, topicForTurn } from './topics.js';

describe('the topic bank', () => {
  it('has at least 40 topics of 8 distinct canned items each', () => {
    expect(TIERS_TOPICS.length).toBeGreaterThanOrEqual(40);
    for (const topic of TIERS_TOPICS) {
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.canned).toHaveLength(8);
      const keys = new Set(topic.canned.map(normalizeItemText));
      expect(keys.size).toBe(8);
      expect(keys.has('')).toBe(false);
    }
  });

  it('draws deterministically and without repeats within a full cycle', () => {
    const seen = new Set<string>();
    for (let turn = 0; turn < TIERS_TOPICS.length; turn++) {
      const topic = topicForTurn('seed-a', turn);
      expect(topicForTurn('seed-a', turn)).toEqual(topic);
      seen.add(topic.title);
    }
    expect(seen.size).toBe(TIERS_TOPICS.length);
  });

  it('different seeds draw different schedules', () => {
    const a = Array.from({ length: 5 }, (_, t) => topicForTurn('seed-a', t).title).join('|');
    const b = Array.from({ length: 5 }, (_, t) => topicForTurn('seed-b', t).title).join('|');
    expect(a).not.toBe(b);
  });
});
