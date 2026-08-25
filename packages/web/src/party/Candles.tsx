/**
 * The curser's clock, and the only part of the grown-ups' game a child can
 * read. One burns at the end of every round, and a second whenever the hall
 * spends its accusation on the wrong neck.
 */
export function Candles({ lit, of }: { lit: number; of: number }) {
  return (
    <p className="candles" aria-label={`${lit} of ${of} candles still lit`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={i < lit ? 'candle is-lit' : 'candle is-out'}>
          {i < lit ? '🕯️' : '🕯'}
        </span>
      ))}
      <span className="muted"> {lit} left</span>
    </p>
  );
}
