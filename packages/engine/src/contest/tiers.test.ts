import { describe, expect, it } from 'vitest';

import { redact } from '../redact.js';
import { lineMap, scenario } from '../testing.js';
import type { TiersList } from '../types.js';

const LIST: TiersList = {
  items: ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'], // true A→F
  shuffle: [3, 0, 5, 1, 4, 2], // public position p shows items[shuffle[p]]
};

function stateWithList() {
  const map = lineMap(4, 2);
  const state = scenario(map, { owner: [0, 0, 1, 1], armies: [3, 3, 3, 3] });
  state.tiersLists[0] = { items: [...LIST.items], shuffle: [...LIST.shuffle] };
  return state;
}

describe('tiers redaction', () => {
  it('authors see their own ordering', () => {
    const view = redact(stateWithList(), 0);
    expect(view.tiersLists[0]).toEqual(LIST);
  });

  it('rivals see items in public order with an identity shuffle', () => {
    const view = redact(stateWithList(), 1);
    expect(view.tiersLists[0]).toEqual({
      items: ['delta', 'alpha', 'foxtrot', 'bravo', 'echo', 'charlie'],
      shuffle: [0, 1, 2, 3, 4, 5],
    });
  });

  it('spectators get the public view too, and the ordering is hidden even without fog', () => {
    const state = stateWithList();
    expect(state.fogUntilTurn).toBe(0); // fog inactive — redaction must still apply
    const view = redact(state, null);
    expect(view.tiersLists[0]?.items[0]).toBe('delta');
    expect(JSON.stringify(view.tiersLists[0])).not.toContain('"shuffle":[3');
  });

  it('redaction never mutates the source state', () => {
    const state = stateWithList();
    redact(state, 1);
    expect(state.tiersLists[0]).toEqual(LIST);
  });
});
