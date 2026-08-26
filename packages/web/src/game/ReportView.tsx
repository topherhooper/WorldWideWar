import { describeEvent } from '@www/engine';
import type { GeneratedMap, PactResult, TiersResult, TurnReport } from '@www/engine';
import type { GameView } from '@www/server/api-types';

import { playerColor } from '../format.js';

interface Props {
  view: GameView;
  map: GeneratedMap;
  report: TurnReport;
}

const tName = (map: GeneratedMap, id: number): string => map.territories[id]?.name ?? `#${id}`;

export function ReportView({ view, map, report }: Props) {
  const seatName = (slot: number | null): string =>
    slot === null ? 'Neutral' : (view.seats[slot]?.name ?? `seat ${slot}`);

  const Dot = ({ slot }: { slot: number | null }) =>
    slot === null ? null : <span className="seat-dot" style={{ background: playerColor(slot) }} />;

  const pactLine = (p: PactResult) => {
    switch (p.outcome) {
      case 'betrayal':
        return (
          <span className="betrayal">
            <Dot slot={p.slot} /> {seatName(p.slot)} BETRAYED {seatName(p.partner)}
          </span>
        );
      case 'betrayed':
        return null; // rendered from the betrayer's row
      case 'mutual_treachery':
        return p.partner !== null && p.slot < p.partner ? (
          <span className="betrayal">
            <Dot slot={p.slot} /> {seatName(p.slot)} and {seatName(p.partner)} betrayed each other
          </span>
        ) : null;
      case 'concord':
        return p.partner !== null && p.slot < p.partner ? (
          <span className="concord">
            <Dot slot={p.slot} /> {seatName(p.slot)} and {seatName(p.partner)} kept concord
            {p.streak > 1 ? ` (${p.streak} turns)` : ''}
          </span>
        ) : null;
      case 'spurned':
        return (
          <span className="muted">
            {seatName(p.slot)} pledged {seatName(p.pledged)}, who looked elsewhere
          </span>
        );
      case 'courted':
        return <span className="muted">{seatName(p.slot)} was courted</span>;
      case 'abstain':
        return null;
    }
  };

  return (
    <section className="report">
      <h3>
        Turn {report.turn}: {report.headline}
      </h3>

      <ul className="report-list">
        {report.pacts.map((p, i) => {
          const line = pactLine(p);
          return line === null ? null : <li key={`p${i}`}>{line}</li>;
        })}
      </ul>

      {(report.tiers ?? []).length > 0 && (
        <div className="tiers-report">
          <h4>Tier lists revealed{report.revealedTopic ? ` — ${report.revealedTopic}` : ''}</h4>
          {view.rules.tiersPayout === 'pooled' &&
            (() => {
              // The pool is the sum of what everyone put in — including players
              // with no land left, whose reads are the only thing they can still
              // contribute. Splitting it is the engine's job; showing the total
              // is what tells the table whether the round paid for itself.
              const pool = (report.tiers ?? []).reduce(
                (sum: number, r: TiersResult) => sum + (r.incomeDelta ?? 0),
                0,
              );
              const holders =
                view.state?.status.filter((st) => st === 'active').length ?? 0;
              return (
                <p className={pool >= 0 ? 'concord' : 'betrayal'}>
                  The coalition read itself for <strong>{pool}</strong>{' '}
                  {Math.abs(pool) === 1 ? 'army' : 'armies'}
                  {holders > 0 && pool !== 0
                    ? `, split among the ${holders} still holding ground`
                    : ''}
                  .
                </p>
              );
            })()}
          <ul className="report-list">
            {(report.tiers ?? []).map((t: TiersResult) => (
              <li key={`t${t.slot}`}>
                <Dot slot={t.slot} /> <strong>{seatName(t.slot)}</strong>
                {t.revealed !== null ? (
                  <span className="muted"> — {t.revealed.join(' › ')}</span>
                ) : (
                  <span className="muted"> — wrote no list</span>
                )}
                {t.guesses.map((g, i) => (
                  <div key={i} className="muted">
                    read {seatName(g.target)}: {g.score}/12
                  </div>
                ))}
                {t.bestRead !== null && t.bestRead.score >= 10 && (
                  <div className="concord">
                    {seatName(t.bestRead.guesser)} read {seatName(t.slot)} like a book —{' '}
                    {t.bestRead.score}/12
                  </div>
                )}
                {view.rules.tiersPayout === 'income' && (t.incomeDelta ?? 0) !== 0 && (
                  <div className={(t.incomeDelta ?? 0) > 0 ? 'concord' : 'betrayal'}>
                    {(t.incomeDelta ?? 0) > 0 ? '+' : ''}
                    {t.incomeDelta ?? 0} armies from the tiers
                  </div>
                )}
                {view.rules.tiersPayout === 'pooled' && (t.incomeDelta ?? 0) !== 0 && (
                  <div className={(t.incomeDelta ?? 0) > 0 ? 'concord' : 'betrayal'}>
                    {(t.incomeDelta ?? 0) > 0 ? '+' : ''}
                    {t.incomeDelta ?? 0} to the coalition
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.clashes.length > 0 && (
        <ul className="report-list">
          {report.clashes.map((c, i) => (
            <li key={`c${i}`}>
              Armies clashed between {tName(map, c.a)} and {tName(map, c.b)} — {seatName(c.winner)}{' '}
              won the field
            </li>
          ))}
        </ul>
      )}

      {report.battles.length > 0 && (
        <ul className="report-list">
          {report.battles.map((b, i) => (
            <li key={`b${i}`}>
              <Dot slot={b.winner} /> {seatName(b.winner)} {b.captured ? 'took' : 'held'}{' '}
              <strong>{tName(map, b.territory)}</strong>
              {b.casualties > 0 ? ` (lost ${b.casualties})` : ''}
            </li>
          ))}
        </ul>
      )}

      {(report.plunder ?? []).length > 0 && (
        <ul className="report-list">
          {(report.plunder ?? []).map((p) => (
            <li key={`pl${p.slot}`}>
              <Dot slot={p.slot} /> {seatName(p.slot)} plundered {p.captures}{' '}
              {p.captures === 1 ? 'province' : 'provinces'} (+{p.income}{' '}
              {p.income === 1 ? 'army' : 'armies'} next turn)
            </li>
          ))}
        </ul>
      )}

      {report.quietMoves > 0 && <p className="muted">{report.quietMoves} quiet moves elsewhere.</p>}

      {report.world.length > 0 && (
        <ul className="report-list">
          {report.world.map((w, i) => {
            switch (w.kind) {
              case 'storm':
                return (
                  <li key={i} className="storm">
                    The storm swallowed {w.territories.length} territories
                  </li>
                );
              case 'storm_warning':
                return (
                  <li key={i} className="storm">
                    Storm warning: {w.territories.map((t) => tName(map, t)).join(', ')} —{' '}
                    <strong>this land burns when the orders you write now resolve</strong>, not next
                    turn. Anything standing there is lost.
                  </li>
                );
              case 'eliminated':
                return (
                  <li key={i}>
                    <strong>{seatName(w.slot)} was eliminated</strong>
                  </li>
                );
              case 'capital_fell':
                return (
                  <li key={i}>
                    {seatName(w.slot)}&rsquo;s capital at {tName(map, w.from)} fell
                    {w.to !== null ? `; relocated to ${tName(map, w.to)}` : ''}
                  </li>
                );
              case 'routed':
                return (
                  <li key={i}>
                    {seatName(w.slot)} routed at {tName(map, w.at)}, losing {w.lost}
                  </li>
                );
              case 'global_event':
              case 'event_announced':
                return (
                  <li key={i} className="event">
                    {w.kind === 'global_event' ? 'In effect' : 'Announced for next turn'}:{' '}
                    {describeEvent(w.id)}
                  </li>
                );
              default:
                return null;
            }
          })}
        </ul>
      )}

      {report.result !== null && (
        <div className="result-banner">
          <h2>
            {report.result.winners.map((w) => seatName(w)).join(' & ')} win
            {report.result.winners.length === 1 ? 's' : ''} — {report.result.kind}
          </h2>
          {report.result.detail !== undefined && <p>{report.result.detail}</p>}
          <p className="muted">
            Standings: {report.result.standings.map((s) => seatName(s)).join(' › ')}
          </p>
        </div>
      )}
    </section>
  );
}
