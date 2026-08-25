import type { GuestCard, PartyView } from '@www/engine/party';

import { Candles } from './Candles.js';

/**
 * The party invitation — the thing this whole mode exists to produce.
 *
 * It is addressed to one guest, and everything on it came through
 * `redactParty`, which is the only code that ever knew any of it. A grown-up
 * who brought somebody gets their card beside their own, because they will be
 * holding the phone for both.
 */
export function Invitation({
  view,
  cards,
  onBegin,
}: {
  view: PartyView;
  cards: GuestCard[];
  onBegin: (() => void) | null;
}) {
  const tale = view.tale;
  return (
    <main className="invitation">
      <header className="invitation-head">
        <p className="invitation-eyebrow">You are invited to a christening</p>
        <h1>{tale?.title ?? 'Sleeping Beauty'}</h1>
        <p className="invitation-prompt">{tale?.prompt}</p>
      </header>

      {cards.map((card) => (
        <GuestPanel key={card.id} card={card} view={view} />
      ))}

      <section className="invitation-cast">
        <h3>Everyone at the christening</h3>
        {/* Costumes are public by design: the puzzle is the culprit's costume,
            so the guests have to be readable or there is nothing to deduce. */}
        <ul>
          {view.roster.map((guest) => (
            <li key={guest.id} className={guest.absent ? 'muted' : undefined}>
              <strong>{guest.name}</strong>
              {/* A courtier's name is their part, so saying both reads as a
                  stutter: "The Chamberlain — The Chamberlain in gold". */}
              {guest.part !== null && guest.part !== guest.name && <> — {guest.part}</>}
              {guest.costume !== null && (
                <span className="muted">
                  {' '}
                  in {guest.costume.gown}, with {guest.costume.gift}, {guest.costume.place}
                </span>
              )}
              {guest.absent && <span className="muted"> · went home</span>}
            </li>
          ))}
        </ul>
      </section>

      <footer className="invitation-foot">
        <Candles lit={view.candles} of={view.maxCandles} />
        <p className="muted">
          {view.mode === 'together'
            ? 'Nobody here laid the curse. Work it out together before the last candle goes out.'
            : 'One of the grown-ups here laid it. Find out who before the last candle goes out.'}
        </p>
        {onBegin !== null && <button onClick={onBegin}>Ring the bell — start the party</button>}
      </footer>
    </main>
  );
}

function GuestPanel({ card, view }: { card: GuestCard; view: PartyView }) {
  return (
    <section className={card.young ? 'invitation-card is-child' : 'invitation-card'}>
      <p className="invitation-eyebrow">{card.young ? 'and for' : 'For'}</p>
      <h2>{card.name}</h2>
      <p className="invitation-part">
        You are <strong>{card.part}</strong>
      </p>

      {card.costume !== null && (
        <p className="invitation-costume">
          You came in <strong>{card.costume.gown}</strong>, you brought{' '}
          <strong>{card.costume.gift}</strong>, and you stood <strong>{card.costume.place}</strong>.
          Everyone can see this.
        </p>
      )}

      {card.duo !== null && (
        <p className="invitation-duo">
          <strong>{card.duo.name}.</strong> {card.duo.blurb}
          {card.ally !== null && (
            <>
              {' '}
              You and <strong>{card.ally.name}</strong> are one character, and nobody else knows it.
              You win or lose together.
            </>
          )}
        </p>
      )}

      {card.favour !== null && (
        <p className="invitation-favour">
          Before anybody may hear what you know, they must <strong>{card.favour}</strong>.
        </p>
      )}

      {/* The one secret on any invitation, and only ever on one of them. */}
      {card.lies > 0 && (
        <p className="invitation-secret">
          <strong>You laid the curse.</strong> Tell nobody. {card.lies} times tonight you may hand
          somebody something untrue, and it will look exactly like the truth.
        </p>
      )}

      {view.mode === 'traitor' && card.lies === 0 && !card.young && (
        <p className="muted">
          You did not lay the curse. Somebody in this room did. You speak with{' '}
          {card.weight === 1 ? 'one voice' : `${card.weight} voices`} when the hall argues.
        </p>
      )}
    </section>
  );
}
