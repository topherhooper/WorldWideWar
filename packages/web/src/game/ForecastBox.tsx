import { describeEvent, waveCollapsingOn } from '@www/engine';
import type { GameState, GeneratedMap, RuleConfig } from '@www/engine';

/**
 * What the world is about to do — in one place.
 *
 * Before this, the answer was spread across five: two HUD banners, two kinds of
 * report entry behind the "Show last turn's report" collapse, and a clause in
 * the map key. The storm's line is what makes an unhatched map unambiguous: it
 * says whether the storm has not started, is not due this turn, or is finished.
 */
export function ForecastBox({
  state,
  map,
  rules,
}: {
  state: GameState;
  map: GeneratedMap;
  rules: RuleConfig;
}) {
  const active = describeEvent(state.activeEvent);
  const pending = describeEvent(state.pendingEvent);

  const wave = waveCollapsingOn(state.turn, rules);
  const burningNow = wave !== null && wave < map.collapseWaves.length;
  const remaining = map.collapseWaves.length - state.wavesCollapsed;

  let nextWaveTurn: number | null = null;
  if (!burningNow) {
    for (let t = state.turn + 1; t <= state.turn + 60; t++) {
      const w = waveCollapsingOn(t, rules);
      if (w !== null && w < map.collapseWaves.length) {
        nextWaveTurn = t;
        break;
      }
    }
  }

  const storm = burningNow
    ? `The storm takes the hatched land when this turn resolves — ${map.collapseWaves[wave].length} territories, and every army standing on them.`
    : nextWaveTurn !== null
      ? `The storm is quiet this turn. Next wave lands on turn ${nextWaveTurn}${remaining > 1 ? `, ${remaining} still to come` : ''}.`
      : 'The storm has finished. No more land will be taken.';

  const growth =
    rules.neutralGrowthInterval > 0 &&
    (state.turn + 1) % rules.neutralGrowthInterval === 0 &&
    !burningNow
      ? 'Neutral garrisons grow when this turn resolves.'
      : null;

  return (
    <section className="forecast" aria-label="what the world is doing">
      <h2 className="forecast-head">The world</h2>
      <ul className="forecast-list">
        <li className="forecast-storm">{storm}</li>
        {active !== null && (
          <li>
            <strong>This turn:</strong> {active}
          </li>
        )}
        {pending !== null && (
          <li className="forecast-coming">
            <strong>Next turn:</strong> {pending}
          </li>
        )}
        {growth !== null && <li className="forecast-coming">{growth}</li>}
      </ul>
    </section>
  );
}
