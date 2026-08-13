import type { GameView } from '@www/server/api-types';
import type {
  Deployment,
  GameState,
  GeneratedMap,
  OrderSet,
  RuleConfig,
  TerritoryId,
  UnitOrder,
} from '@www/engine';
import { BASE_INCOME, TERRITORIES_PER_INCOME, regionBonusFor, suppliedCount } from '@www/engine';

import { formatRemaining, playerColor } from '../format.js';
import { useNow } from '../useNow.js';

export type EntryMode = 'move' | 'deploy';

/**
 * Raw army-count input → count. Empty stays empty so the field can actually be
 * cleared mid-edit — clamping '' to 1 made the "1" undeletable and every typed
 * digit appended to it. Callers treat '' as 1 at the point of use.
 */
export function parseMoveCount(raw: string): number | '' {
  if (raw.trim() === '') return '';
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? Math.max(1, n) : '';
}

interface Props {
  view: GameView;
  state: GameState;
  map: GeneratedMap;
  draft: OrderSet;
  mode: EntryMode;
  moveCount: number | '';
  selected: TerritoryId | null;
  warnings: string[];
  onModeChange: (mode: EntryMode) => void;
  onMoveCountChange: (count: number | '') => void;
  onDraftChange: (draft: OrderSet) => void;
  onLock: () => void;
  onUnlock: () => void;
}

const name = (map: GeneratedMap, id: number): string => map.territories[id]?.name ?? `#${id}`;

/** Where this turn's reinforcements came from, mirroring the engine's formula. */
function incomeParts(
  state: GameState,
  map: GeneratedMap,
  slot: number,
  rules: RuleConfig,
): string[] {
  const parts: string[] = [];
  let accounted = 0;
  const push = (amount: number, label: string) => {
    if (amount <= 0) return;
    accounted += amount;
    parts.push(`${amount} ${label}`);
  };

  if (state.activeEvent === 'cold_snap') {
    parts.push('cold snap — regions only');
  } else {
    push(BASE_INCOME, 'base');
    const supplied = suppliedCount(state, slot);
    push(
      Math.floor(supplied / TERRITORIES_PER_INCOME),
      `from ${supplied} supplied ${supplied === 1 ? 'land' : 'lands'}`,
    );
    push(Math.floor(state.turn / rules.warEconomyInterval), 'war economy');
  }
  push(regionBonusFor(state, map, slot), 'whole regions');

  let capitals = 0;
  for (let other = 0; other < state.playerCount; other++) {
    const capital = state.capital[other];
    if (other === slot || capital === null) continue;
    if (state.owner[capital] === slot && !state.collapsed[capital]) capitals++;
  }
  push(capitals, `captured ${capitals === 1 ? 'capital' : 'capitals'}`);

  // Whatever the engine granted beyond the recomputable parts (being courted,
  // mobilization) arrived as bonus income.
  push(state.income[slot] - accounted, 'bonuses');
  return parts;
}

export function OrdersPanel(props: Props) {
  const { view, state, map, draft, mode, moveCount, selected, warnings } = props;
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
        <strong>
          <span className="seat-dot" style={{ background: playerColor(mySlot) }} /> Turn {view.turn}
        </strong>
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
              max={selected !== null ? Math.max(1, state.armies[selected]) : undefined}
              value={moveCount}
              disabled={locked}
              onChange={(e) => props.onMoveCountChange(parseMoveCount(e.target.value))}
              style={{ width: '4.5rem' }}
            />
          </label>
        )}
      </div>
      <p className="muted hint">
        {mode === 'deploy'
          ? `Click your territories to place your ${state.income[mySlot]} reinforcements.`
          : selected === null
            ? 'Click one of your territories (gold outline) to move from. Moving into a neutral or enemy land attacks it.'
            : `Moving from ${name(map, selected)} (${state.armies[selected]} armies) — click a dashed neighbour. Beaded ridges cannot be crossed. Click it again to cancel.`}
      </p>
      {mode === 'deploy' && (
        <p className="muted hint">
          Income {state.income[mySlot]}: {incomeParts(state, map, mySlot, view.rules).join(' + ')}.
        </p>
      )}

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

      {view.contest === 'pact' && (
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
      )}

      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <div className="lock-row">
        <button
          className={locked ? 'unlock-btn' : 'lock-btn'}
          onClick={locked ? props.onUnlock : props.onLock}
        >
          {locked ? 'Locked in — unlock to edit' : 'Lock in orders'}
        </button>
        {locked && (
          <span className="muted hint">
            You can unlock and change your orders until the whole table has locked.
          </span>
        )}
      </div>
    </aside>
  );
}
