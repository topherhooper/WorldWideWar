import { useState } from 'react';
import type { SacreAction, SacreGameView } from '@www/server/api-types';

import { api, ApiError } from '../api.js';
import { DeleteGame } from '../game/DeleteGame.js';
import { useNow } from '../useNow.js';
import { SacreTable } from './SacreTable.js';

/**
 * Everything a card player sees, dispatched on the phase.
 *
 * Same shape as PartyGame, and for the same reason: the last server answer wins
 * over the polled one until the next poll lands, so a card you just played
 * moves immediately rather than up to 2.5s later.
 */
export function SacreGame({
  view: initial,
  act: refresh,
  id,
}: {
  view: SacreGameView;
  act: () => Promise<unknown>;
  id: string;
}) {
  const [fresh, setFresh] = useState<SacreGameView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  const view = fresh !== null && fresh.game.round >= initial.game.round ? fresh : initial;

  const run = async (fn: () => Promise<SacreGameView>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      setFresh(next);
      // A refused action is not an error the client invented: the engine wrote
      // the sentence and it is addressed to whoever tried it.
      if (next.note !== null) setError(next.note);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  };

  const onAct = (action: SacreAction) => void run(() => api.sacreAct(id, action));

  const seated = view.mySlot !== null;
  const taken = view.seats.filter((s) => s.taken).length;
  const secondsLeft =
    view.phaseEndsAt === null
      ? null
      : Math.max(0, Math.round((Date.parse(view.phaseEndsAt) - now) / 1000));

  return (
    <main>
      <section className="panel">
        <h2>S.A.C.R.E. Bleu!</h2>

        {view.status === 'lobby' ? (
          <>
            <p className="muted">
              Everyone plays at the same table at the same time — share this page&rsquo;s link and
              take a seat. {taken} of {view.maxSeats} seated.
            </p>
            <ol className="sacre-seats">
              {view.seats.map((seat) => (
                <li key={seat.slot} className="sacre-seat">
                  <strong>{seat.name || 'Empty seat'}</strong>
                  {seat.isHost && <span className="muted"> · host</span>}
                </li>
              ))}
            </ol>
            {!seated && (
              <button
                type="button"
                data-testid="take-seat"
                disabled={busy || taken >= view.maxSeats}
                onClick={() => void run(() => api.takeSacreSeat(id))}
              >
                Take a seat
              </button>
            )}
            {view.isHost && (
              <button
                type="button"
                data-testid="deal"
                disabled={busy || taken < 2}
                onClick={() => onAct({ type: 'deal' })}
              >
                {taken < 2 ? 'Waiting for one more player' : `Deal for ${taken}`}
              </button>
            )}
          </>
        ) : (
          <>
            <p className="muted">
              Round {view.game.round} of {view.game.rounds}
              {secondsLeft !== null && view.game.phase === 'playing' && ` · ${secondsLeft}s left`}
            </p>
            <SacreTable view={view} onAct={onAct} busy={busy} />
          </>
        )}

        {error !== null && (
          <p className="error" data-testid="sacre-error">
            {error}
          </p>
        )}
      </section>

      <DeleteGame gameId={id} label="Delete this game" />
    </main>
  );
}
