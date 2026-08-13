import { useEffect, useState } from 'react';
import type { GameView, UpdateConfigRequest } from '@www/server/api-types';
import { MAX_PLAYERS, MIN_PLAYERS, MAX_TURN_CAP, MIN_TURN_CAP, presetById } from '@www/engine';

import { api, ApiError } from '../api.js';

type Unit = 'minutes' | 'hours' | 'days';
const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

const unitOf = (minutes: number): Unit =>
  minutes % 1440 === 0 && minutes >= 1440 ? 'days' : minutes % 60 === 0 && minutes >= 60 ? 'hours' : 'minutes';

const describeTurnLength = (minutes: number): string =>
  minutes % 1440 === 0 && minutes >= 1440
    ? `${minutes / 1440}-day`
    : minutes % 60 === 0 && minutes >= 60
      ? `${minutes / 60}-hour`
      : `${minutes}-minute`;

interface Props {
  view: GameView;
  onChanged: () => Promise<unknown>;
}

export function GameSetup({ view, onChanged }: Props) {
  const isCreator = view.mySlot === 0;
  const preset = view.presetId !== null ? presetById(view.presetId) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local drafts for the two number inputs; committed on blur.
  const [unit, setUnit] = useState<Unit>(unitOf(view.turnMinutes));
  const [turnValue, setTurnValue] = useState(String(view.turnMinutes / UNIT_MINUTES[unitOf(view.turnMinutes)]));
  const [capValue, setCapValue] = useState(String(view.turnCap));
  useEffect(() => {
    const u = unitOf(view.turnMinutes);
    setUnit(u);
    setTurnValue(String(view.turnMinutes / UNIT_MINUTES[u]));
    setCapValue(String(view.turnCap));
  }, [view.turnMinutes, view.turnCap]);

  const apply = async (req: UpdateConfigRequest) => {
    setBusy(true);
    setError(null);
    try {
      await api.updateConfig(view.id, req);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  };

  const commitTurnLength = (nextUnit: Unit, rawValue: string) => {
    const minutes = Math.round(Number(rawValue) * UNIT_MINUTES[nextUnit]);
    if (!Number.isFinite(minutes) || minutes === view.turnMinutes) return;
    void apply({ turnMinutes: minutes });
  };

  const commitCap = (rawValue: string) => {
    const turnCap = Number(rawValue);
    if (!Number.isInteger(turnCap) || turnCap === view.turnCap) return;
    void apply({ turnCap });
  };

  return (
    <div className="game-setup">
      <h3>
        Game setup — {view.presetName}
        {preset !== null && <span className="muted"> · {preset.tagline}</span>}
      </h3>
      {isCreator ? (
        <div className="form-row">
          <label>
            Players{' '}
            <select
              value={view.playerCount}
              disabled={busy}
              onChange={(e) => void apply({ playerCount: Number(e.target.value) })}
            >
              {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map(
                (n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Turn length{' '}
            <input
              type="number"
              min={1}
              value={turnValue}
              disabled={busy}
              onChange={(e) => setTurnValue(e.target.value)}
              onBlur={() => commitTurnLength(unit, turnValue)}
            />
          </label>
          <select
            aria-label="turn length unit"
            value={unit}
            disabled={busy}
            onChange={(e) => {
              const nextUnit = e.target.value as Unit;
              setUnit(nextUnit);
              commitTurnLength(nextUnit, turnValue);
            }}
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
          <label>
            Game length{' '}
            <input
              type="number"
              min={MIN_TURN_CAP}
              max={MAX_TURN_CAP}
              value={capValue}
              disabled={busy}
              onChange={(e) => setCapValue(e.target.value)}
              onBlur={() => commitCap(capValue)}
            />
          </label>
          <span className="muted">turns</span>
        </div>
      ) : (
        <p className="muted">
          {view.playerCount} players · {describeTurnLength(view.turnMinutes)} turns · {view.turnCap}{' '}
          turns
        </p>
      )}
      <p className="muted">
        Storm begins ~turn {view.rules.stormFirstWave} · standings decide at turn {view.turnCap}.
      </p>
      {error !== null && <p className="error">{error}</p>}
    </div>
  );
}
