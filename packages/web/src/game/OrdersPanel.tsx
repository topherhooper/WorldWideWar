import type { GameView } from '@www/server/api-types';
import type { Deployment, GameState, GeneratedMap, OrderSet, UnitOrder } from '@www/engine';

import { formatRemaining, playerColor } from '../format.js';
import { useNow } from '../useNow.js';

export type EntryMode = 'move' | 'deploy';

interface Props {
  view: GameView;
  state: GameState;
  map: GeneratedMap;
  draft: OrderSet;
  mode: EntryMode;
  moveCount: number;
  warnings: string[];
  onModeChange: (mode: EntryMode) => void;
  onMoveCountChange: (count: number) => void;
  onDraftChange: (draft: OrderSet) => void;
  onLock: () => void;
}

const name = (map: GeneratedMap, id: number): string => map.territories[id]?.name ?? `#${id}`;

export function OrdersPanel(props: Props) {
  const { view, state, map, draft, mode, moveCount, warnings } = props;
  const now = useNow();
  const mySlot = view.mySlot;
  if (mySlot === null) return null;

  const deployed = draft.deploys.reduce((sum, d) => sum + d.count, 0);
  const pool = state.income[mySlot] - deployed;
  const locked = view.myLocked;

  const removeDeploy = (i: number) => {
    const deploys = draft.deploys.filter((_, j) => j !== i);
    props.onDraftChange({ ...draft, deploys });
  };
  const removeUnit = (i: number) => {
    const units = draft.units.filter((_, j) => j !== i);
    props.onDraftChange({ ...draft, units });
  };
  const setPledge = (slot: number) => {
    props.onDraftChange({ ...draft, pledge: draft.pledge === slot ? null : slot });
  };

  const others = view.seats.filter((s) => s.slot !== mySlot && state.status[s.slot] === 'active');

  return (
    <aside className="orders">
      <div className="orders-head">
        <strong>Turn {view.turn}</strong>
        {view.deadlineAt !== null && (
          <span className="muted">{formatRemaining(view.deadlineAt, now)}</span>
        )}
      </div>

      <div className="orders-modes">
        <button
          className={mode === 'deploy' ? 'mode-on' : ''}
          disabled={locked}
          onClick={() => props.onModeChange('deploy')}
        >
          Deploy ({pool} left)
        </button>
        <button
          className={mode === 'move' ? 'mode-on' : ''}
          disabled={locked}
          onClick={() => props.onModeChange('move')}
        >
          Move
        </button>
        {mode === 'move' && (
          <label className="muted">
            armies{' '}
            <input
              type="number"
              min={1}
              value={moveCount}
              disabled={locked}
              onChange={(e) => props.onMoveCountChange(Math.max(1, Number(e.target.value)))}
              style={{ width: '4.5rem' }}
            />
          </label>
        )}
      </div>
      <p className="muted hint">
        {mode === 'deploy'
          ? 'Click your territories to place reinforcements.'
          : 'Click a territory of yours, then an adjacent one to move.'}
      </p>

      {draft.deploys.length + draft.units.length > 0 && (
        <ul className="chips">
          {draft.deploys.map((d: Deployment, i) => (
            <li key={`d${i}`}>
              <button className="chip" disabled={locked} onClick={() => removeDeploy(i)}>
                +{d.count} {name(map, d.to)} ✕
              </button>
            </li>
          ))}
          {draft.units.map((u: UnitOrder, i) => (
            <li key={`u${i}`}>
              <button className="chip" disabled={locked} onClick={() => removeUnit(i)}>
                {u.kind === 'MOVE'
                  ? `${u.count} ⟶ ${name(map, u.to)}`
                  : u.kind === 'SUPPORT'
                    ? `support ${name(map, u.target)}`
                    : `hold ${name(map, u.from)}`}{' '}
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="pledge">
        <h3>Pact pledge</h3>
        <div className="pledge-row">
          {others.map((s) => (
            <button
              key={s.slot}
              className={draft.pledge === s.slot ? 'pledge-btn pledge-on' : 'pledge-btn'}
              disabled={locked}
              onClick={() => setPledge(s.slot)}
              title={`${s.name} — honored ${state.pactsHonored[s.slot]}, broken ${state.pactsBroken[s.slot]}`}
            >
              <span className="seat-dot" style={{ background: playerColor(s.slot) }} />
              {s.name}
              <span className="muted rep">
                {' '}
                {state.pactsHonored[s.slot]}✓ {state.pactsBroken[s.slot]}✗
              </span>
            </button>
          ))}
          {others.length === 0 && <span className="muted">nobody left to court</span>}
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <div className="lock-row">
        <button className="lock-btn" disabled={locked} onClick={props.onLock}>
          {locked ? 'Locked in' : 'Lock in orders'}
        </button>
        <span className="muted">
          locked:{' '}
          {view.lockedSlots.length === 0
            ? 'nobody yet'
            : view.lockedSlots.map((slot) => view.seats[slot]?.name ?? `seat ${slot}`).join(', ')}
        </span>
      </div>
    </aside>
  );
}
