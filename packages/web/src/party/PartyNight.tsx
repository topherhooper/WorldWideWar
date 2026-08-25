import type { GuestCard, PartyAction, PartyView } from '@www/engine/party';

import { formatRemaining } from '../format.js';
import { Candles } from './Candles.js';

const nameOf = (view: PartyView, id: number): string =>
  view.roster.find((r) => r.id === id)?.name ?? 'somebody';

/**
 * A grown-up's evening: who is left to meet, what is waiting on your word, and
 * the fragments you are holding. Everything here came through `redactParty` —
 * a piece is never attributed, which is what makes a liar both possible and
 * catchable.
 */
export function PartyNight({
  view,
  card,
  now,
  busy,
  onAct,
}: {
  view: PartyView;
  card: GuestCard;
  now: number;
  busy: boolean;
  onAct: (action: PartyAction) => void;
}) {
  const mingling = view.phase === 'mingle';

  return (
    <div className="party-night">
      <header className="party-bar">
        <span>
          Round {view.round} — {mingling ? 'mingling' : 'the floor is open'}
        </span>
        {view.phaseEndsAt !== null && (
          <span className="muted">
            {formatRemaining(new Date(view.phaseEndsAt).toISOString(), now)}
          </span>
        )}
        <Candles lit={view.candles} of={view.maxCandles} />
      </header>

      {view.snuffed !== null && <p className="muted">A candle went out: {view.snuffed}.</p>}

      {card.toConfirm.length > 0 && (
        <section className="panel">
          <h3>Waiting on your word</h3>
          {card.toConfirm.map((claim) => (
            <div key={`${claim.claimantId}-${claim.aboutId}`} className="party-claim">
              <p>
                <strong>{claim.claimant}</strong> says they met{' '}
                {claim.aboutId === card.id ? 'you' : <strong>{claim.about}</strong>}.
                {claim.favour !== null && (
                  <>
                    {' '}
                    Did they <strong>{claim.favour}</strong>?
                  </>
                )}
              </p>
              <div className="form-row">
                <button
                  disabled={busy}
                  onClick={() =>
                    onAct({ kind: 'confirm', about: claim.aboutId, claimant: claim.claimantId })
                  }
                >
                  They did
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    onAct({ kind: 'deny', about: claim.aboutId, claimant: claim.claimantId })
                  }
                >
                  They did not
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {mingling && card.canMeet.length > 0 && (
        <section className="panel">
          <h3>Go and meet somebody</h3>
          <ul className="meet-list">
            {card.canMeet.map((option) => (
              <li key={option.id}>
                <span>
                  <strong>{option.name}</strong> <span className="muted">{option.part}</span>
                  {option.favour !== null && (
                    <span className="muted"> — you must {option.favour}</span>
                  )}
                </span>
                {option.state === 'met' ? (
                  <span className="concord">met</span>
                ) : option.state === 'pending' ? (
                  <span className="muted">waiting on {option.signer}</span>
                ) : (
                  <span className="form-row">
                    <button
                      disabled={busy}
                      onClick={() =>
                        onAct({ kind: 'meet', actor: card.id, target: option.id, lie: false })
                      }
                    >
                      I met them
                    </button>
                    {/* Only ever rendered for one guest in the room. */}
                    {card.lies > 0 && (
                      <button
                        className="danger"
                        disabled={busy}
                        title="Hand them something untrue"
                        onClick={() =>
                          onAct({ kind: 'meet', actor: card.id, target: option.id, lie: true })
                        }
                      >
                        …and lie
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {card.lies > 0 && (
            <p className="muted">{card.lies} falsehoods left. Nobody can see you spend one.</p>
          )}
        </section>
      )}

      <section className="panel">
        <h3>What you know</h3>
        {card.pieces.length === 0 ? (
          <p className="muted">Nothing yet. Go and meet somebody.</p>
        ) : (
          <ul className="piece-list">
            {card.pieces.map((piece, i) => (
              <li key={i} className={piece.fake === true ? 'piece is-fake' : 'piece'}>
                {piece.text}
                {/* The Godmother's whole character is being able to tell. */}
                {piece.fake === true && <span className="error"> — this one is a lie</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {card.hall !== null && (
        <section className="panel">
          <h3>The whole hall</h3>
          <p className="muted">
            You see every meeting anyone has had tonight. Comparing who met whom is how a falsehood
            gets caught.
          </p>
          <ul className="piece-list">
            {card.hall.map((row) => (
              <li key={row.id}>
                <strong>{nameOf(view, row.id)}</strong> met{' '}
                {row.met.map((id) => nameOf(view, id)).join(', ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.duo?.id === 'huntsman' && (
        <section className="panel">
          <h3>The cub&rsquo;s nose</h3>
          {card.sniff !== null ? (
            <p>
              {nameOf(view, card.sniff.target)}{' '}
              {card.sniff.lied ? (
                <strong className="error">has told a lie tonight</strong>
              ) : (
                <span className="concord">smells honest</span>
              )}
              .
            </p>
          ) : (
            <div className="form-row">
              <span className="muted">Once tonight, name a guest:</span>
              {view.roster
                .filter((r) => !r.young && !r.absent && r.id !== card.id)
                .map((r) => (
                  <button
                    key={r.id}
                    disabled={busy}
                    onClick={() => onAct({ kind: 'sniff', actor: card.id, target: r.id })}
                  >
                    {r.name}
                  </button>
                ))}
            </div>
          )}
        </section>
      )}

      {view.phase === 'vote' && <Floor view={view} card={card} busy={busy} onAct={onAct} />}
    </div>
  );
}

/**
 * The floor. In a hunt it is a nomination and a weighted vote; in a together
 * party there is nobody to vote against, so naming a courtier is the guess and
 * it settles the moment it is made.
 */
function Floor({
  view,
  card,
  busy,
  onAct,
}: {
  view: PartyView;
  card: GuestCard;
  busy: boolean;
  onAct: (action: PartyAction) => void;
}) {
  const together = view.mode === 'together';

  if (view.nomination === null) {
    return (
      <section className="panel">
        <h3>{together ? 'Who do you think it was?' : 'Name a suspect'}</h3>
        {together && (
          <p className="muted">
            Wrong, and you strike them off the list and lose a candle. Right, and the curse breaks.
          </p>
        )}
        <div className="form-row">
          {card.nominable.map((id) => (
            <button
              key={id}
              disabled={busy || card.young}
              onClick={() => onAct({ kind: 'nominate', actor: card.id, suspect: id })}
            >
              {nameOf(view, id)}
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <h3>
        {nameOf(view, view.nomination.suspect)} — named by {nameOf(view, view.nomination.by)}
      </h3>
      <p className="muted">
        {view.nomination.cast} of {view.nomination.total} voices spoken. Still waiting on{' '}
        {view.nomination.waitingOn.map((id) => nameOf(view, id)).join(', ') || 'nobody'}.
      </p>
      {card.canVote && card.voted === null ? (
        <div className="form-row">
          <button
            disabled={busy}
            onClick={() => onAct({ kind: 'vote', actor: card.id, yes: true })}
          >
            Banish them ({card.weight === 1 ? '1 voice' : `${card.weight} voices`})
          </button>
          <button
            disabled={busy}
            onClick={() => onAct({ kind: 'vote', actor: card.id, yes: false })}
          >
            Let them off
          </button>
        </div>
      ) : (
        <p className="muted">
          {card.voted === null ? 'You have no voice left.' : 'You have spoken.'}
        </p>
      )}
    </section>
  );
}
