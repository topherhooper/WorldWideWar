import { useState } from 'react';
import type { PartyAction } from '@www/engine/party';
import type { PartyGameView } from '@www/server/api-types';

import { api, ApiError } from '../api.js';
import { DeleteGame } from '../game/DeleteGame.js';
import { useNow } from '../useNow.js';
import { Invitation } from './Invitation.js';
import { KidView } from './KidView.js';
import { PartyLobby } from './PartyLobby.js';
import { PartyNight } from './PartyNight.js';

/**
 * Everything a party guest sees, dispatched on the phase.
 *
 * A seat may speak for several guests, so this also owns the toggle that turns
 * a grown-up's phone into a child's screen. That is how a child plays without
 * ever holding a device: their half is a page their grown-up hands them.
 */
export function PartyGame({
  view: initial,
  act: refresh,
  id,
}: {
  view: PartyGameView;
  act: () => Promise<unknown>;
  id: string;
}) {
  // The last server answer wins over the polled one until the next poll lands,
  // so a confirmed encounter shows immediately rather than up to 2.5s later.
  const [fresh, setFresh] = useState<PartyGameView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showing, setShowing] = useState(0);
  const now = useNow();

  const view = fresh !== null && fresh.party.round >= initial.party.round ? fresh : initial;
  const cards = view.party.cards;
  const card = cards[Math.min(showing, Math.max(0, cards.length - 1))];

  const run = async (fn: () => Promise<PartyGameView>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      setFresh(next);
      // A rejected action is not an error the client invented; the engine wrote
      // the sentence, and it is addressed to the guest who tried it.
      if (next.note !== null) setError(next.note);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  };

  const onAct = (action: PartyAction) => void run(() => api.partyAct(id, action));

  if (view.status === 'lobby') {
    return (
      <PartyLobby
        view={view}
        busy={busy}
        error={error}
        onSeat={(dependents) => void run(() => api.takePartySeat(id, dependents))}
        onDrop={(slot) => void run(() => api.dropPartySeat(id, slot))}
        onConfig={(patch) => void run(() => api.updatePartyConfig(id, patch))}
        onDeal={() => onAct({ kind: 'deal' })}
      />
    );
  }

  if (view.mySlot === null || card === undefined) {
    return (
      <main className="panel">
        <h2>{view.party.tale?.title ?? 'A christening'}</h2>
        <p className="muted">
          The roles are dealt, so no more guests can be seated. Ask the host to start another.
        </p>
      </main>
    );
  }

  if (view.party.phase === 'invited') {
    return (
      <>
        <Invitation
          view={view.party}
          cards={cards}
          onBegin={view.isHost ? () => onAct({ kind: 'bell' }) : null}
        />
        {error !== null && <p className="error">{error}</p>}
        {view.isHost && <HostTools id={id} />}
      </>
    );
  }

  return (
    <main>
      {cards.length > 1 && (
        <nav className="party-whose form-row">
          {cards.map((c, i) => (
            <button
              key={c.id}
              className={i === showing ? 'is-current' : undefined}
              onClick={() => setShowing(i)}
            >
              {i === showing ? c.name : `hand the phone to ${c.name}`}
            </button>
          ))}
        </nav>
      )}

      {error !== null && <p className="error">{error}</p>}

      {view.party.phase === 'over' && <Ending view={view} />}

      {card.young ? (
        <KidView card={card} view={view.party} />
      ) : (
        <PartyNight view={view.party} card={card} now={now} busy={busy} onAct={onAct} />
      )}

      {view.isHost && view.party.phase === 'mingle' && (
        <div className="form-row">
          <button disabled={busy} onClick={() => onAct({ kind: 'bell' })}>
            Ring the bell — close the mingling
          </button>
        </div>
      )}

      {view.isHost && <HostTools id={id} />}
    </main>
  );
}

/**
 * The one control a party has always been missing: the way out.
 *
 * A party has no resolve-now and no start, so unlike the war game's host panel
 * this holds a single button — but it has to be on every screen after the
 * lobby, because the evening that most wants deleting is the one that got
 * dealt to the wrong people and stopped there.
 */
function HostTools({ id }: { id: string }) {
  return (
    <div className="panel host-tools">
      <DeleteGame gameId={id} label="Delete this party" />
    </div>
  );
}

function Ending({ view }: { view: PartyGameView }) {
  const party = view.party;
  const culprit = party.roster.find((r) => r.id === party.culprit);
  const won = party.cards[0]?.won;
  return (
    <section className="panel party-ending">
      <h2>{party.outcome}</h2>
      {culprit !== undefined && (
        <p>
          It was <strong>{culprit.name}</strong>
          {culprit.part !== null && <> — {culprit.part}</>}.
        </p>
      )}
      <p className={won === true ? 'concord' : 'error'}>
        {won === true ? 'You won.' : 'Aurora sleeps.'}
      </p>
    </section>
  );
}
