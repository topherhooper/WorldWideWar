import { describe, expect, it } from 'vitest';

import { freeCells, gridDays, HOUR_MS, localDate, offeredByDay, zonedHour } from './grid.js';

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

describe('time zones', () => {
  const utc = (iso: string) => new Date(iso).getTime();

  it('finds the instant a wall-clock hour starts in a named zone', () => {
    expect(zonedHour(2026, 10, 30, 18, 'America/New_York')).toBe(utc('2026-10-30T22:00:00Z'));
    expect(zonedHour(2026, 10, 30, 18, 'Europe/London')).toBe(utc('2026-10-30T18:00:00Z'));
    expect(zonedHour(2026, 10, 30, 18, 'Asia/Kolkata')).toBe(utc('2026-10-30T12:30:00Z'));
    expect(zonedHour(2026, 10, 30, 18, 'Asia/Kathmandu')).toBe(utc('2026-10-30T12:15:00Z'));
  });

  it('follows a daylight-saving change between two days of the same grid', () => {
    // New York falls back at 02:00 on 1 November 2026: 18:00 is 22:00Z before, 23:00Z after.
    const days = gridDays(
      { firstDay: '2026-10-31', days: 2, fromHour: 18, toHour: 19 },
      'America/New_York',
    );
    expect(days.map((d) => d.cells[0].ms)).toEqual([
      utc('2026-10-31T22:00:00Z'),
      utc('2026-11-01T23:00:00Z'),
    ]);
  });

  it('rolls days over month ends whatever the zone', () => {
    const days = gridDays(
      { firstDay: '2026-10-31', days: 2, fromHour: 9, toHour: 10 },
      'Asia/Tokyo',
    );
    expect(days.map((d) => d.date)).toEqual(['2026-10-31', '2026-11-01']);
  });

  it('groups offered hours by the viewer’s day, not the organizer’s', () => {
    // 23:30Z on 3 October is already 4 October in Tokyo.
    const days = offeredByDay(['2026-10-03T23:30:00Z'], 'Asia/Tokyo');
    expect(days[0].date).toBe('2026-10-04');
    expect(localDate(new Date('2026-10-03T23:30:00Z'), 'America/New_York')).toBe('2026-10-03');
  });
});
