import type { GuestCard, PartyView } from '@www/engine/party';

import { Candles } from './Candles.js';

/**
 * A child's screen, rendered on their grown-up's phone.
 *
 * Nothing on it is load-bearing text and nothing on it is an input: a character
 * to be, a price grown-ups have to pay, a crown count and the candles. The
 * redactor puts no clue on a child's card at all, so there is nothing here that
 * could be read out by accident.
 */
export function KidView({ card, view }: { card: GuestCard; view: PartyView }) {
  return (
    <main className="kid-view">
      <h1>{card.part}</h1>
      {card.duo !== null && <p className="kid-blurb">{card.duo.blurb}</p>}

      {card.favour !== null && (
        <section className="kid-price">
          <p className="muted">Anyone who wants to know a secret must first</p>
          <p className="kid-price-text">{card.favour}</p>
        </section>
      )}

      <section className="kid-crowns">
        <p aria-label={`${card.curtsies.length} crowns`}>
          {card.curtsies.length === 0
            ? '👑'.repeat(0) || '—'
            : '👑'.repeat(Math.min(card.curtsies.length, 12))}
        </p>
        <p className="muted">
          {card.curtsies.length === 0
            ? 'Nobody has bowed to you yet'
            : `${card.curtsies.length} grown-ups have bowed to you`}
        </p>
      </section>

      <Candles lit={view.candles} of={view.maxCandles} />
      {view.outcome !== null && <p className="kid-outcome">{view.outcome}</p>}
    </main>
  );
}
