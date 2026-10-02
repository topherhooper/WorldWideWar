import type { GridDay } from './grid.js';

const dayLabel = (date: string): string =>
  new Date(`${date}T12:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

/**
 * Days down, hours across; a cell is on when the hour is offered. Past hours cannot be offered
 * and are shown but not tappable.
 */
export function HourGrid({
  days,
  on,
  now,
  onToggle,
}: {
  days: GridDay[];
  on: Set<number>;
  now: number;
  onToggle: (ms: number) => void;
}) {
  const hours = days[0]?.cells.map((c) => c.hour) ?? [];
  return (
    <div className="hour-grid-wrap">
      <table className="hour-grid">
        <thead>
          <tr>
            <th />
            {hours.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th scope="row">{dayLabel(day.date)}</th>
              {day.cells.map((c) => {
                const past = c.ms <= now;
                const isOn = !past && on.has(c.ms);
                return (
                  <td key={c.hour}>
                    <button
                      type="button"
                      aria-label={`${dayLabel(day.date)} ${c.hour}:00`}
                      aria-pressed={isOn}
                      disabled={past}
                      className={past ? 'is-past' : isOn ? 'is-on' : ''}
                      onClick={() => onToggle(c.ms)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
