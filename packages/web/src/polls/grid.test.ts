import { describe, expect, it } from 'vitest';

import { freeCells, gridDays, HOUR_MS, localDate, offeredByDay } from './grid.js';

const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).getTime();

describe('gridDays', () => {
  it('lays out one row per day and one local hour start per cell', () => {
    const days = gridDays({ firstDay: '2026-10-30', days: 3, fromHour: 18, toHour: 21 });
    expect(days.map((d) => d.date)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(days[1].cells).toEqual([
      { hour: 18, ms: at(2026, 10, 31, 18) },
      { hour: 19, ms: at(2026, 10, 31, 19) },
      { hour: 20, ms: at(2026, 10, 31, 20) },
    ]);
  });

  it('returns nothing for a date it cannot read', () => {
    expect(gridDays({ firstDay: '', days: 3, fromHour: 18, toHour: 21 })).toEqual([]);
  });
});

describe('freeCells', () => {
  const cells = [at(2026, 10, 3, 18), at(2026, 10, 3, 19), at(2026, 10, 3, 20)];
  const iso = (ms: number) => new Date(ms).toISOString();

  it('counts an hour busy if any part of it is', () => {
    const busy = [{ start: iso(cells[0] + HOUR_MS / 2), end: iso(cells[1] + 1) }];
    expect([...freeCells(cells, busy)]).toEqual([cells[2]]);
  });

  it('leaves an hour free when a busy span only touches its edge', () => {
    const busy = [{ start: iso(cells[0] - HOUR_MS), end: iso(cells[0]) }];
    expect(freeCells(cells, busy).size).toBe(3);
  });
});

describe('offeredByDay', () => {
  it('merges contiguous hours and splits by local day', () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    const days = offeredByDay([
      iso(at(2026, 10, 4, 18)),
      iso(at(2026, 10, 3, 19)),
      iso(at(2026, 10, 3, 18)),
      iso(at(2026, 10, 3, 21)),
    ]);
    expect(days).toEqual([
      {
        date: '2026-10-03',
        spans: [
          [at(2026, 10, 3, 18), at(2026, 10, 3, 20)],
          [at(2026, 10, 3, 21), at(2026, 10, 3, 22)],
        ],
      },
      { date: '2026-10-04', spans: [[at(2026, 10, 4, 18), at(2026, 10, 4, 19)]] },
    ]);
  });

  it('formats dates as local YYYY-MM-DD', () => {
    expect(localDate(new Date(2026, 0, 5, 23))).toBe('2026-01-05');
  });
});
