import type { GameView } from '@www/server/api-types';
import type { GameState, OrderSet, TiersGuess, TiersOrders } from '@www/engine';
import { TIERS_LIST_SIZE, TIERS_MAX_GUESSES } from '@www/engine';

import { playerColor } from '../format.js';

const TIER_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

export const emptyTiers = (): TiersOrders => ({
  list: new Array<string>(TIERS_LIST_SIZE).fill(''),
  guesses: [],
});

interface Props {
  view: GameView;
  state: GameState;
  draft: OrderSet;
  onDraftChange: (draft: OrderSet) => void;
}

export function TiersPanel({ view, state, draft, onDraftChange }: Props) {
  const mySlot = view.mySlot;
  if (mySlot === null) return null;
  const locked = view.myLocked;
  const tiers = draft.tiers ?? emptyTiers();

  const change = (next: TiersOrders) => onDraftChange({ ...draft, tiers: next });

  const setEntry = (i: number, value: string) =>
    change({ ...tiers, list: tiers.list.map((v, j) => (j === i ? value : v)) });

  const guessOn = (target: number) => tiers.guesses.find((g) => g.target === target);

  const toggleGuess = (target: number) => {
    const existing = guessOn(target);
    if (existing) {
      change({ ...tiers, guesses: tiers.guesses.filter((g) => g.target !== target) });
      return;
    }
    if (tiers.guesses.length >= TIERS_MAX_GUESSES) return;
    const order = Array.from({ length: TIERS_LIST_SIZE }, (_, i) => i);
    change({ ...tiers, guesses: [...tiers.guesses, { target, order }] });
  };

  const moveItem = (guess: TiersGuess, tier: number, delta: number) => {
    const swapWith = tier + delta;
    if (swapWith < 0 || swapWith >= TIERS_LIST_SIZE) return;
    const order = guess.order.slice();
    const tmp = order[tier];
    order[tier] = order[swapWith];
    order[swapWith] = tmp;
    change({
      ...tiers,
      guesses: tiers.guesses.map((g) => (g.target === guess.target ? { ...g, order } : g)),
    });
  };

  const guessables = view.seats.filter(
    (s) =>
      s.slot !== mySlot && state.status[s.slot] === 'active' && state.tiersLists[s.slot] !== null,
  );

  return (
    <aside className="orders">
      <div className="tiers-editor">
        <h3>Your tier list — {view.tiersTopic}</h3>
        {TIER_LABELS.map((label, i) => (
          <label key={label} className="tier-row">
            <span className="tier-label">{label}</span>
            <input
              value={tiers.list[i] ?? ''}
              disabled={locked}
              onChange={(e) => setEntry(i, e.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="tiers-editor">
        <h3>
          Read your rivals ({tiers.guesses.length}/{TIERS_MAX_GUESSES})
        </h3>
        <p className="muted hint">
          Reorder a rival&rsquo;s items as you think THEY ranked them. A good read pays you both; a
          wild one costs you.
        </p>
        {guessables.length === 0 && <p className="muted">Nobody has a readable list.</p>}
        {guessables.map((seat) => {
          const guess = guessOn(seat.slot);
          const items = state.tiersLists[seat.slot]?.items ?? [];
          return (
            <div key={seat.slot}>
              <button
                className={guess ? 'pledge-btn pledge-on' : 'pledge-btn'}
                disabled={locked || (!guess && tiers.guesses.length >= TIERS_MAX_GUESSES)}
                onClick={() => toggleGuess(seat.slot)}
              >
                <span className="seat-dot" style={{ background: playerColor(seat.slot) }} />
                {guess ? `Reading ${seat.name}` : `Read ${seat.name}`}
              </button>
              {guess &&
                guess.order.map((position, tier) => (
                  <div key={position} className="guess-item">
                    <span className="tier-label">{TIER_LABELS[tier]}</span>
                    <span>{items[position] ?? '?'}</span>
                    <span className="spacer" />
                    <button
                      disabled={locked || tier === 0}
                      onClick={() => moveItem(guess, tier, -1)}
                    >
                      ▲
                    </button>
                    <button
                      disabled={locked || tier === TIERS_LIST_SIZE - 1}
                      onClick={() => moveItem(guess, tier, 1)}
                    >
                      ▼
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
