import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { emptyOrders } from '@www/engine';
import type { OrderSet, TerritoryId } from '@www/engine';
import type { WarGameView } from '@www/server/api-types';

import { GameHud } from '../game/GameHud.js';
import { HowCombatWorks } from '../game/HowCombatWorks.js';
import { HowToWin } from '../game/HowToWin.js';
import { MapView } from '../game/MapView.js';
import { ForecastBox } from '../game/ForecastBox.js';
import { DeleteGame } from '../game/DeleteGame.js';
import { ResolveNow } from '../game/ResolveNow.js';
import { OrdersPanel, type EntryMode } from '../game/OrdersPanel.js';
import { TiersPanel, emptyTiers } from '../game/TiersPanel.js';
import { ReportView } from '../game/ReportView.js';
import { useGame, type UseGame } from '../useGame.js';
import { PartyGame } from '../party/PartyGame.js';
import { Lobby } from './Lobby.js';

const AUTOSAVE_MS = 800;

export function Game() {
  const { id } = useParams<{ id: string }>();
  if (id === undefined) throw new Error('missing game id');
  return <GameInner key={id} id={id} />;
}

/**
 * The fork between the two games, above everything war-shaped.
 *
 * `kind` is read with a `?? 'war'` fallback for the same reason `contest` is —
 * Cloud Run deploys ahead of Hosting, so a tab loaded before this shipped keeps
 * its old bundle and a document written by the new server must still render.
 */
function GameInner({ id }: { id: string }) {
  const game = useGame(id);
  if (game.view === null) {
    return <main className="panel">{game.error ?? 'Loading…'}</main>;
  }
  if (game.view.kind === 'party') {
    return <PartyGame view={game.view} act={game.refresh} id={id} />;
  }
  return (
    <WarGame
      view={game.view}
      error={game.error}
      refresh={game.refresh}
      saveOrders={game.saveOrders}
    />
  );
}

function WarGame({
  view,
  error,
  refresh,
  saveOrders,
}: {
  view: WarGameView;
  error: string | null;
  refresh: () => Promise<unknown>;
  saveOrders: UseGame['saveOrders'];
}) {
  const [draft, setDraft] = useState<OrderSet | null>(null);
  const [selected, setSelected] = useState<TerritoryId | null>(null);
  const [mode, setMode] = useState<EntryMode>('deploy');
  // '' while the player has the field cleared mid-edit; treated as 1 on use.
  const [moveCount, setMoveCount] = useState<number | ''>(1);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showReport, setShowReport] = useState(false);
  const draftTurn = useRef<number | null>(null);
  const dirty = useRef(false);

  // Re-seed the draft at first load and at every turn boundary.
  useEffect(() => {
    if (view.mySlot === null || view.state === null) return;
    if (draftTurn.current === view.turn) return;
    draftTurn.current = view.turn;
    dirty.current = false;
    // Copy — myOrders is owned by useGame state and must not be mutated.
    const base = { ...(view.myOrders ?? emptyOrders(view.mySlot)) };
    if (view.contest === 'tiers' && base.tiers === undefined) base.tiers = emptyTiers();
    setDraft(base);
    setSelected(null);
    setWarnings([]);
    setShowReport(false);
  }, [view]);

  // Debounced autosave of dirty drafts while unlocked.
  useEffect(() => {
    if (draft === null || view.myLocked || !dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      void saveOrders(draft, false).then(setWarnings);
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, view, saveOrders]);

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
      const count = Math.min(Math.max(1, moveCount === '' ? 1 : moveCount), max);
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
        <ForecastBox state={state} map={view.map} rules={view.rules} />
        <MapView
          map={view.map}
          state={state}
          rules={view.rules}
          mySlot={mySlot}
          selected={selected}
          mode={mode}
          onTerritoryClick={onTerritoryClick}
        />
        <p className="muted hint map-key">
          Number = armies stationed there · ★ = capital · gold outline = yours · grey = neutral
          garrisons that defend and grow over time · ⚓ = sea-lane port (select it to see the route
          it connects) · heavy seams divide regions · beaded ridges are impassable — bordering lands
          you cannot march across · hatched land is taken by the storm when this turn resolves ·
          dark ash is land the storm has already taken.
        </p>
        <HowToWin view={view} state={state} map={view.map} />
        <HowCombatWorks
          contest={view.contest}
          tiersPayout={view.rules.tiersPayout}
          plunderIncome={view.rules.plunderIncome}
        />
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
              <div className="panel host-tools">
                {view.status === 'active' && (
                  <ResolveNow gameId={view.id} onResolved={() => void refresh()} />
                )}
                <DeleteGame gameId={view.id} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
