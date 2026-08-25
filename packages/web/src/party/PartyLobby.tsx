import { useState } from 'react';
import { MIN_TRAITOR_GROWNUPS } from '@www/engine/party';
import type { PartyGameView } from '@www/server/api-types';

/**
 * Filling the hall. The invite link is the page's own URL, exactly as for every
 * other mode — which is the whole reason the party stopped being a four-letter
 * code read aloud at a table.
 */
export function PartyLobby({
  view,
  busy,
  error,
  onSeat,
  onDrop,
  onConfig,
  onDeal,
}: {
  view: PartyGameView;
  busy: boolean;
  error: string | null;
  onSeat: (dependents: { name: string; young: boolean }[]) => void;
  onDrop: (slot: number) => void;
  onConfig: (patch: { candles?: number; roundMinutes?: number }) => void;
  onDeal: () => void;
}) {
  const mine = view.mySlot === null ? null : view.seats.find((s) => s.slot === view.mySlot);
  const [names, setNames] = useState(() => (mine?.dependents ?? []).map((d) => d.name).join(', '));
  const [young, setYoung] = useState(true);
  const [copied, setCopied] = useState(false);

  const parse = (): { name: string; young: boolean }[] =>
    names
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n !== '')
      .map((name) => ({ name, young }));

  const grownUps = view.party.roster.filter((r) => !r.young && !r.absent).length;
  const shortHanded = view.party.mode === 'traitor' && grownUps < MIN_TRAITOR_GROWNUPS;

  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true));
  };

  return (
    <main className="panel">
      <h2>{view.party.mode === 'together' ? 'Bedtime party' : 'Dinner party'}</h2>
      <p className="muted">
        {view.party.mode === 'together'
          ? 'Nobody here will have laid the curse — you work it out side by side, against the candles.'
          : 'One of the grown-ups here will have laid the curse, and the hall votes on who.'}
      </p>

      <div className="form-row">
        <button onClick={copyLink}>{copied ? 'Link copied' : 'Copy the invite link'}</button>
        <span className="muted">Anyone who opens it can take a seat.</span>
      </div>

      <ul className="seat-list">
        {view.seats.map((seat) => (
          <li key={seat.slot} className="seat">
            <span>
              {seat.name}
              {seat.isHost ? ' — host' : ''}
              {seat.slot === view.mySlot ? ' (you)' : ''}
              {seat.dependents.length > 0 && (
                <span className="muted"> with {seat.dependents.map((d) => d.name).join(', ')}</span>
              )}
            </span>
            {view.isHost && !seat.isHost && (
              <button className="link" disabled={busy} onClick={() => onDrop(seat.slot)}>
                not coming
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="party-seat-form">
        <label>
          Who came with you?{' '}
          <input
            value={names}
            placeholder="Robin, Wren"
            disabled={busy}
            onChange={(e) => setNames(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={young}
            disabled={busy}
            onChange={(e) => setYoung(e.target.checked)}
          />{' '}
          they&rsquo;re little
        </label>
        <p className="muted">
          Anyone without a phone of their own goes here — a child, or a grown-up whose sign-in will
          not work. Their card appears on yours.
        </p>
        <button disabled={busy} onClick={() => onSeat(parse())}>
          {view.mySlot === null ? 'Take a seat' : 'Update who came with me'}
        </button>
      </div>

      {view.isHost && (
        <div className="party-dials">
          <h3>How long have we got?</h3>
          <label>
            Candles{' '}
            <input
              type="number"
              min={1}
              max={9}
              value={view.party.candles}
              disabled={busy}
              onChange={(e) => onConfig({ candles: Number(e.target.value) })}
            />
          </label>
          <label>
            Minutes a round{' '}
            <input
              type="number"
              min={1}
              max={60}
              value={view.party.roundMinutes}
              disabled={busy}
              onChange={(e) => onConfig({ roundMinutes: Number(e.target.value) })}
            />
          </label>
          <p className="muted">
            About {view.party.candles * view.party.roundMinutes} minutes of mingling, plus the
            arguing.
          </p>
        </div>
      )}

      {error !== null && <p className="error">{error}</p>}

      {view.isHost && (
        <div className="form-row">
          <button disabled={busy || shortHanded} onClick={onDeal}>
            Deal the roles
          </button>
          {shortHanded && (
            <span className="muted">
              A hunt needs {MIN_TRAITOR_GROWNUPS} grown-ups — with two, the innocent one can never
              carry a vote. Start a bedtime party instead.
            </span>
          )}
        </div>
      )}
      {!view.isHost && <p className="muted">Waiting for the host to deal the roles.</p>}
    </main>
  );
}
