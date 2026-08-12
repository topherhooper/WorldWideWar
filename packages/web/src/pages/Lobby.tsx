import { useState } from 'react';
import type { GameView } from '@www/server/api-types';
import { TIERS_LIST_SIZE, normalizeTiersList } from '@www/engine';

import { api, ApiError } from '../api.js';
import { DeleteGame } from '../game/DeleteGame.js';
import { playerColor } from '../format.js';

const TIER_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

interface Props {
  view: GameView;
  onChanged: () => Promise<unknown>;
}

export function Lobby({ view, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<string[]>(new Array<string>(TIERS_LIST_SIZE).fill(''));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  };

  const openSeats = view.seats.filter((s) => !s.taken).length;
  const isTiers = view.contest === 'tiers';
  const myListIn = view.mySlot !== null && view.lobbyListSlots.includes(view.mySlot);
  const listValid = normalizeTiersList(list) !== null;
  const humansMissing = view.seats.filter(
    (s) => s.taken && !s.isBot && !view.lobbyListSlots.includes(s.slot),
  ).length;

  return (
    <main className="panel">
      <h2>
        Lobby — {view.playerCount - openSeats}/{view.playerCount} seated
      </h2>
      <ul className="seat-list">
        {view.seats.map((seat) => (
          <li key={seat.slot} className="seat">
            <span className="seat-dot" style={{ background: playerColor(seat.slot) }} />
            {seat.taken ? (
              <span>
                {seat.name}
                {seat.isBot ? ' (bot)' : ''}
                {seat.slot === view.mySlot ? ' — you' : ''}
                {isTiers && !seat.isBot && (
                  <span className={view.lobbyListSlots.includes(seat.slot) ? 'concord' : 'muted'}>
                    {view.lobbyListSlots.includes(seat.slot) ? ' ✓ list in' : ' — writing list'}
                  </span>
                )}
              </span>
            ) : (
              <span className="muted">open seat</span>
            )}
          </li>
        ))}
      </ul>

      {isTiers && view.mySlot !== null && (
        <div className="tiers-editor">
          <h3>Your first tier list — {view.tiersTopic}</h3>
          <p className="muted">
            Rank honestly, A best to F worst. Rivals will try to guess your order — being readable
            pays you both.
          </p>
          {TIER_LABELS.map((label, i) => (
            <label key={label} className="tier-row">
              <span className="tier-label">{label}</span>
              <input
                value={list[i]}
                disabled={busy || myListIn}
                onChange={(e) => setList(list.map((v, j) => (j === i ? e.target.value : v)))}
              />
            </label>
          ))}
          {!myListIn ? (
            <button
              disabled={busy || !listValid}
              onClick={() => void run(() => api.submitLobbyList(view.id, list))}
            >
              Submit list
            </button>
          ) : (
            <p className="concord">List submitted — waiting on the rest of the table.</p>
          )}
        </div>
      )}

      <p className="muted">Invite friends by sharing this page&rsquo;s URL.</p>
      {error !== null && <p className="error">{error}</p>}

      <div className="form-row">
        {view.mySlot === null && openSeats > 0 && (
          <button disabled={busy} onClick={() => void run(() => api.join(view.id))}>
            Take a seat
          </button>
        )}
        {view.mySlot === 0 && (
          <button
            disabled={busy || (isTiers && humansMissing > 0)}
            title={
              isTiers && humansMissing > 0
                ? 'waiting for tier lists from seated players'
                : undefined
            }
            onClick={() => void run(() => api.start(view.id))}
          >
            Start now — fill empty seats with bots
          </button>
        )}
        {view.mySlot === 0 && <DeleteGame gameId={view.id} />}
      </div>
    </main>
  );
}
