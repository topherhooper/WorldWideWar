import type { ContestKind } from '@www/engine';

/** The combat maths, in player language — mirrors packages/engine/src/combat.ts. */
export function HowCombatWorks({ contest }: { contest: ContestKind }) {
  const contestSource =
    contest === 'tiers' ? 'your tier-list reads' : 'how your pact pledges played out';

  return (
    <details className="panel how-to-win">
      <summary>How combat works</summary>
      <ul className="report-list">
        <li>
          <strong>Power</strong> — every side in a battle rolls{' '}
          <em>strength × contest multiplier × dice</em>. Highest power takes the territory.
        </li>
        <li>
          <strong>Strength</strong> — the armies you have in the fight. A capital (★) with someone
          standing in it defends at +2. A territory that sent support defends at half — its garrison
          is facing outward. Supporting neighbours add half their garrison and take no casualties.
        </li>
        <li>
          <strong>Contest multiplier</strong> — ×0.80 to ×1.40 from {contestSource}. This is the
          biggest lever in the game: a 1.40 against a 0.80 is nearly a 2:1 edge before a die is
          rolled. Neutral garrisons always fight at ×1.00.
        </li>
        <li>
          <strong>Dice</strong> — one d6 per side, worth ×0.88 to ×1.12. Luck can steal a close
          fight, never a lopsided one.
        </li>
        <li>
          <strong>Ties</strong> — go to the defender; between attackers, a coin flip.
        </li>
        <li>
          <strong>The cost of winning</strong> — the winner loses half the total losing strength
          (rounded up), though never their last army. Winning a big melee can leave you holding the
          ground with almost nothing.
        </li>
        <li>
          <strong>Losing</strong> — a beaten attacking stack limps home with a third of what it
          committed. Defenders who lose their ground are wiped out.
        </li>
      </ul>
      <p className="muted hint">
        The odds shown when you commit an attack account for all of this — including the range that
        comes from not knowing your opponent&rsquo;s multiplier until the turn resolves.
      </p>
    </details>
  );
}
