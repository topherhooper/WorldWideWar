import { fullyHeldRegions, territoryCount } from '@www/engine';
import type { GameState, GeneratedMap } from '@www/engine';
import type { GameView } from '@www/server/api-types';

/** The victory conditions, with live numbers instead of abstract shares. */
export function HowToWin({
  view,
  state,
  map,
}: {
  view: GameView;
  state: GameState;
  map: GeneratedMap;
}) {
  // The rules frozen into the game at creation — never recomputed, so the
  // panel cannot drift from what resolution actually uses as tuning changes.
  const rules = view.rules;
  const surviving = state.collapsed.filter((c) => !c).length;
  const regionsAlive = map.regions.filter((region) =>
    region.territoryIds.some((id) => !state.collapsed[id]),
  ).length;

  const dominationNeed = Math.ceil(rules.dominationShare * surviving);
  const hegemonyNeed = Math.max(
    rules.hegemonyMinimum,
    Math.ceil(regionsAlive * rules.hegemonyShare),
  );
  const mySlot = view.mySlot;
  const mine = mySlot === null ? null : territoryCount(state, mySlot);
  const myRegions = mySlot === null ? null : fullyHeldRegions(state, map, mySlot);
  const rivals = view.playerCount - 1;
  const capitalsNeed = Math.floor(rivals * rules.decapitationShare) + 1;

  return (
    <details className="panel how-to-win">
      <summary>
        How to win — turn {view.turn} of {rules.turnCap}
      </summary>
      <ul className="report-list">
        <li>
          <strong>Conquest</strong> — be the last power standing.
        </li>
        <li>
          <strong>Domination</strong> — hold {dominationNeed} of the {surviving} surviving
          territories{mine !== null ? ` (you hold ${mine})` : ''}.
        </li>
        <li>
          <strong>Hegemony</strong> — fully own {hegemonyNeed} of the {regionsAlive} regions, held
          for {rules.hegemonyStreak} turns
          {myRegions !== null ? ` (you fully own ${myRegions})` : ''}. Off once fewer than{' '}
          {rules.hegemonyMinRegionsAlive} regions survive.
        </li>
        <li>
          <strong>Decapitation</strong> — hold your own capital (★) plus {capitalsNeed} rival
          capitals for {rules.decapitationStreak} turns.
        </li>
        {view.contest === 'pact' && view.playerCount >= 3 && (
          <li>
            <strong>Condominium</strong> — two powers in unbroken mutual concord for{' '}
            {rules.condominiumStreak} turns, jointly holding{' '}
            {Math.round(rules.condominiumShare * 100)}% of the surviving map, share the win.
          </li>
        )}
        {view.contest === 'pact' && view.playerCount >= 4 && (
          <li>
            <strong>Concordat</strong> — three powers whose every pair kept concord within the last{' '}
            {rules.concordatWindow} turns, jointly holding {Math.round(rules.concordatShare * 100)}
            %, share the win.
          </li>
        )}
        <li>
          <strong>Turn cap</strong> — after turn {rules.turnCap}, standings (territory, then
          strength) decide.
        </li>
      </ul>
      <h4 className="regions-head">Regions — hold one whole for its income bonus</h4>
      <ul className="report-list">
        {map.regions.map((region) => {
          const live = region.territoryIds.filter((id) => !state.collapsed[id]);
          if (live.length === 0) return null;
          const owners = new Set(live.map((id) => state.owner[id]));
          const holder = owners.size === 1 ? [...owners][0] : undefined;
          const status =
            holder === undefined
              ? 'contested'
              : holder === null
                ? 'unclaimed'
                : holder === mySlot
                  ? 'held whole by you'
                  : `held whole by ${view.seats[holder]?.name ?? `seat ${holder}`}`;
          return (
            <li key={region.id}>
              {region.name} <strong>+{region.bonus}</strong>{' '}
              <span className="muted">
                — {live.length} {live.length === 1 ? 'territory' : 'territories'}, {status}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="muted hint">
        The storm starts collapsing the map&rsquo;s edge on turn {rules.stormFirstWave}, then every{' '}
        {rules.stormInterval === 1 ? 'turn' : `${rules.stormInterval} turns`}. A world event lands
        every {rules.eventInterval} turns and is always announced one turn ahead. Sea lanes (⚓)
        make two distant territories adjacent for movement.
      </p>
    </details>
  );
}
