import { describe, expect, it } from 'vitest';

import { formatRange, nextRow, rowInstants, validateNewPoll, type CandidateRow } from './times.js';

const HOUR = 60 * 60 * 1000;
const ms = (iso: string): number => new Date(iso).getTime();

/** A date `days` from today, as a date input holds it, in the runner's local zone. */
function dateIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
const row = (days: number, start = '19:00', end = '23:00'): CandidateRow => ({
  date: dateIn(days),
  start,
  end,
});

describe('rowInstants', () => {
  it('turns a local date and times into a range in that order', () => {
    const r = rowInstants(row(3, '19:00', '23:00'));
    expect(r).not.toBeNull();
    expect(ms(r!.endsAt) - ms(r!.startsAt)).toBe(4 * HOUR);
  });

  it('reads an end at or before the start as the next day', () => {
    const r = rowInstants(row(3, '21:00', '01:00'));
    expect(ms(r!.endsAt) - ms(r!.startsAt)).toBe(4 * HOUR);
    const same = rowInstants(row(3, '21:00', '21:00'));
    expect(ms(same!.endsAt) - ms(same!.startsAt)).toBe(24 * HOUR);
  });

  it('is null while a row is incomplete or not a real date', () => {
    expect(rowInstants({ date: '', start: '19:00', end: '23:00' })).toBeNull();
    expect(rowInstants({ date: dateIn(3), start: '', end: '23:00' })).toBeNull();
    expect(rowInstants({ date: '2026-13-45', start: '19:00', end: '23:00' })).toBeNull();
  });
});

describe('nextRow', () => {
  it("copies the previous row's times and leaves the date empty", () => {
    expect(nextRow([row(2, '18:30', '22:00')])).toEqual({ date: '', start: '18:30', end: '22:00' });
  });
  it('starts empty when there is no previous row', () => {
    expect(nextRow([])).toEqual({ date: '', start: '', end: '' });
  });
});

describe('validateNewPoll', () => {
  const ok = { title: 'Board games', rows: [row(2), row(3)], deadline: '' };

  it('accepts a good poll and sorts the times', () => {
    const result = validateNewPoll({ ...ok, rows: [row(4), row(2), row(3)] });
    expect('candidates' in result).toBe(true);
    if ('candidates' in result) {
      const starts = result.candidates.map((c) => c.startsAt);
      expect([...starts].sort()).toEqual(starts);
      expect(result.deadlineAt).toBeNull();
    }
  });

  it.each([
    ['no title', { ...ok, title: '  ' }],
    ['a title over 80 characters', { ...ok, title: 'x'.repeat(81) }],
    ['a single time', { ...ok, rows: [row(2)] }],
    ['an incomplete row', { ...ok, rows: [row(2), { date: '', start: '19:00', end: '23:00' }] }],
    ['a time in the past', { ...ok, rows: [row(2), row(-1)] }],
    ['two identical times', { ...ok, rows: [row(2), row(2)] }],
  ])('rejects %s', (_name, input) => {
    expect('error' in validateNewPoll(input)).toBe(true);
  });

  it('rejects a deadline in the past or after the last time, and accepts one between', () => {
    const at = (days: number) => `${dateIn(days)}T12:00`;
    expect('error' in validateNewPoll({ ...ok, deadline: at(-1) })).toBe(true);
    expect('error' in validateNewPoll({ ...ok, deadline: at(5) })).toBe(true);
    const fine = validateNewPoll({ ...ok, deadline: at(1) });
    expect('deadlineAt' in fine && fine.deadlineAt !== null).toBe(true);
  });
});

describe('formatRange', () => {
  it('formats a range in the viewer’s zone, with both ends', () => {
    const text = formatRange(
      new Date(2026, 9, 14, 19, 0).toISOString(),
      new Date(2026, 9, 14, 23, 0).toISOString(),
      'en-US',
    );
    expect(text).toContain('Oct 14');
    expect(text).toContain('7:00');
    expect(text).toContain('11:00');
  });
});
