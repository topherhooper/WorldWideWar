import type { Card } from '@www/engine/sacre';
import { cardName } from '@www/engine/sacre';

/**
 * A hand you can pick from.
 *
 * Selection is ordered and shown, because a run is laid in an order and the
 * player needs to see the one they built -- 5,6,7 and 7,6,5 are not the same
 * submission, and a Joker's position is what decides which rank it stands for.
 */
export function Hand({
  cards,
  selected,
  onToggle,
  disabled = false,
}: {
  cards: readonly Card[];
  selected: readonly string[];
  onToggle?: ((id: string) => void) | undefined;
  disabled?: boolean | undefined;
}) {
  return (
    <ul className="sacre-hand">
      {cards.map((card) => {
        const at = selected.indexOf(card.id);
        return (
          <li key={card.id}>
            <button
              type="button"
              data-testid={`card-${card.id}`}
              className={`sacre-card${at >= 0 ? ' is-picked' : ''}${
                card.suit === 'H' || card.suit === 'D' ? ' is-red' : ''
              }`}
              disabled={disabled || onToggle === undefined}
              onClick={() => onToggle?.(card.id)}
            >
              {cardName(card)}
              {at >= 0 && <span className="sacre-order">{at + 1}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
