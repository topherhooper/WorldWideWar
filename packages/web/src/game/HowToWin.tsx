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

  // One copy, rendered by both the competitive and the cooperative panel:
  // whole regions pay their bonus identically in either mode.
  const regionRows = map.regions.map((region) => {
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
  });

  // Co-op has no rivals to beat, so every competitive route below is not just
  // irrelevant but actively misleading — a player told to take 60% of the map
  // is being pointed away from the only thing that decides the game.
  if (rules.coop) {
    const alive = state.status.filter((s) => s === 'active').length;
    const wavesLeft = Math.max(0, map.collapseWaves.length - state.wavesCollapsed);
    return (
      <details className="panel how-to-win">
        <summary>
          How to survive — turn {view.turn} of {rules.turnCap}
        </summary>
        <ul className="report-list">
          <li>
            <strong>You all win together, or you don&rsquo;t.</strong> There are no rivals here and
            nothing to take from each other. The storm is the only opponent, and the score is how
            many of you are still standing when it burns out — {alive} of {view.playerCount} so far.
          </li>
          <li>
            <strong>You cannot win early</strong> — only still be there at the end. Holding ground
            is the whole job; there is no share of the map that closes the game out.
          </li>
          <li>
            <strong>The storm</strong> —{' '}
            {wavesLeft === 0
              ? 'has nothing left to take.'
              : `${wavesLeft} ${wavesLeft === 1 ? 'wave' : 'waves'} left to fall.`}{' '}
            It starts on turn {rules.stormFirstWave}, then every{' '}
            {rules.stormInterval === 1 ? 'turn' : `${rules.stormInterval} turns`}. Hatched land goes
            when this turn resolves.
          </li>
          {rules.stormRaiders > 0 && (
            <li>
              <strong>Raiders</strong> — every wave drives {rules.stormRaiders} armies onto the
              map&rsquo;s permanent core, the ground the storm never takes. They thicken neutral
              garrisons and batter held provinces, but never take one outright and never cut a
              garrison below one. The safest land is where the fighting ends up.
            </li>
          )}
          <li>
            <strong>Losing everything is not being out</strong> — keep writing your list and reading
            your allies. Those reads still pay the coalition, and they are spent by whoever still
            has ground to put an army on.
          </li>
        </ul>
        <h4 className="regions-head">Regions — hold one whole for its income bonus</h4>
        <ul className="report-list">{regionRows}</ul>
      </details>
    );
  }

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
      <ul className="report-list">{regionRows}</ul>
      <p className="muted hint">
        The storm starts collapsing the map&rsquo;s edge on turn {rules.stormFirstWave}, then every{' '}
        {rules.stormInterval === 1 ? 'turn' : `${rules.stormInterval} turns`}. A world event lands
        every {rules.eventInterval} turns and is always announced one turn ahead. Sea lanes (⚓)
        make two distant territories adjacent for movement.
      </p>
    </details>
  );
}
