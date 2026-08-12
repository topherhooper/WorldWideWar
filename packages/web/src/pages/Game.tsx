import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { emptyOrders } from '@www/engine';
import type { OrderSet, TerritoryId } from '@www/engine';

import { GameHud } from '../game/GameHud.js';
import { HowToWin } from '../game/HowToWin.js';
import { MapView } from '../game/MapView.js';
import { DeleteGame } from '../game/DeleteGame.js';
import { OrdersPanel, type EntryMode } from '../game/OrdersPanel.js';
import { TiersPanel, emptyTiers } from '../game/TiersPanel.js';
import { ReportView } from '../game/ReportView.js';
import { useGame } from '../useGame.js';
import { Lobby } from './Lobby.js';

const AUTOSAVE_MS = 800;

export function Game() {
  const { id } = useParams<{ id: string }>();
  if (id === undefined) throw new Error('missing game id');
  return <GameInner key={id} id={id} />;
}

function GameInner({ id }: { id: string }) {
  const { view, error, refresh, saveOrders } = useGame(id);

  const [draft, setDraft] = useState<OrderSet | null>(null);
  const [selected, setSelected] = useState<TerritoryId | null>(null);
  const [mode, setMode] = useState<EntryMode>('deploy');
  const [moveCount, setMoveCount] = useState(1);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showReport, setShowReport] = useState(false);
  const draftTurn = useRef<number | null>(null);
  const dirty = useRef(false);

  // Re-seed the draft at first load and at every turn boundary.
  useEffect(() => {
    if (view === null || view.mySlot === null || view.state === null) return;
    if (draftTurn.current === view.turn) return;
    draftTurn.current = view.turn;
    dirty.current = false;
    const base = view.myOrders ?? emptyOrders(view.mySlot);
    if (view.contest === 'tiers' && base.tiers === undefined) base.tiers = emptyTiers();
    setDraft(base);
    setSelected(null);
    setWarnings([]);
    setShowReport(false);
  }, [view]);

  // Debounced autosave of dirty drafts while unlocked.
  useEffect(() => {
    if (draft === null || view === null || view.myLocked || !dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      void saveOrders(draft, false).then(setWarnings);
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, view, saveOrders]);

  if (view === null) {
    return <main className="panel">{error ?? 'Loading…'}</main>;
  }
  if (view.status === 'lobby') {
    return <Lobby view={view} onChanged={refresh} />;
  }

  const state = view.state;
  if (state === null) return <main className="panel">Loading…</main>;
  const mySlot = view.mySlot;

  const changeDraft = (next: OrderSet) => {
    dirty.current = true;
    setDraft(next);
  };

  const onTerritoryClick = (tid: TerritoryId) => {
    if (draft === null || mySlot === null || view.myLocked || view.status !== 'active') return;
    const mine = state.owner[tid] === mySlot;

    if (mode === 'deploy') {
      if (!mine) return;
      const deployed = draft.deploys.reduce((sum, d) => sum + d.count, 0);
      if (state.income[mySlot] - deployed <= 0) return;
      const existing = draft.deploys.findIndex((d) => d.to === tid);
      const deploys =
        existing === -1
          ? [...draft.deploys, { to: tid, count: 1 }]
          : draft.deploys.map((d, i) => (i === existing ? { ...d, count: d.count + 1 } : d));
      changeDraft({ ...draft, deploys });
      return;
    }

    if (selected === null) {
      if (mine) setSelected(tid);
      return;
    }
    if (tid === selected) {
      setSelected(null);
      return;
    }
    if (view.map.adjacency[selected]?.includes(tid)) {
      const max = Math.max(1, state.armies[selected]);
      const count = Math.min(Math.max(1, moveCount), max);
      changeDraft({
        ...draft,
        units: [...draft.units, { kind: 'MOVE', from: selected, to: tid, count }],
      });
      setSelected(null);
      return;
    }
    if (mine) setSelected(tid);
  };

  const finished = view.status === 'finished';

  return (
    <main className="game-layout">
      <div className="map-wrap">
        <GameHud view={view} state={state} />
        <MapView
          map={view.map}
          state={state}
          mySlot={mySlot}
          selected={selected}
          mode={mode}
          onTerritoryClick={onTerritoryClick}
        />
        <p className="muted hint map-key">
          Number = armies stationed there · ★ = capital · gold outline = yours · grey = neutral
          garrisons that defend and grow over time · ⚓ = sea-lane port (select it to see the route
          it connects) · heavy seams divide regions.
        </p>
        <HowToWin view={view} state={state} map={view.map} />
        {error !== null && <p className="error">{error}</p>}
      </div>

      <div className="side">
        {finished ? (
          view.latestReport !== null && (
            <ReportView view={view} map={view.map} report={view.latestReport} />
          )
        ) : (
          <>
            {mySlot !== null && state.status[mySlot] !== 'active' ? (
              <p className="panel muted">
                You were {state.status[mySlot]} on turn {state.eliminatedTurn[mySlot] ?? '?'} —
                spectating.
              </p>
            ) : mySlot !== null && draft !== null ? (
              <>
                <OrdersPanel
                  view={view}
                  state={state}
                  map={view.map}
                  draft={draft}
                  mode={mode}
                  moveCount={moveCount}
                  selected={selected}
                  warnings={warnings}
                  onModeChange={setMode}
                  onMoveCountChange={setMoveCount}
                  onDraftChange={changeDraft}
                  onLock={() => {
                    if (draft !== null) void saveOrders(draft, true).then(setWarnings);
                  }}
                  onUnlock={() => {
                    if (draft !== null) void saveOrders(draft, false).then(setWarnings);
                  }}
                />
                {view.contest === 'tiers' && (
                  <TiersPanel view={view} state={state} draft={draft} onDraftChange={changeDraft} />
                )}
              </>
            ) : (
              <p className="panel muted">Spectating.</p>
            )}
            {view.latestReport !== null && (
              <div className="panel">
                <button onClick={() => setShowReport(!showReport)}>
                  {showReport ? 'Hide' : 'Show'} last turn&rsquo;s report
                </button>
                {showReport && <ReportView view={view} map={view.map} report={view.latestReport} />}
              </div>
            )}
            {mySlot === 0 && (
              <div className="panel">
                <DeleteGame gameId={view.id} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
