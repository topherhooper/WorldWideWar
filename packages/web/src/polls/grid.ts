/** The arithmetic behind the availability grid. Pure, so it is testable. */

export const HOUR_MS = 60 * 60 * 1000;
export const MAX_DAYS = 31;

/** Whole local days and hours, as the organizer sees them. */
export interface GridSpec {
  firstDay: string; // YYYY-MM-DD
  days: number;
  fromHour: number; // first row hour
  toHour: number; // exclusive
}

export interface GridCell {
  hour: number;
  ms: number; // the hour's start
}

export interface GridDay {
  date: string; // YYYY-MM-DD
  cells: GridCell[];
}

export interface BusySpan {
  start: string; // ISO
  end: string; // ISO
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** A local calendar date as YYYY-MM-DD. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** One row per day, one cell per hour, in the browser's zone (the organizer's). */
export function gridDays(spec: GridSpec): GridDay[] {
  const [y, m, d] = spec.firstDay.split('-').map(Number);
  if (!y || !m || !d) return [];
  const out: GridDay[] = [];
  for (let i = 0; i < spec.days; i++) {
    const cells: GridCell[] = [];
    for (let h = spec.fromHour; h < spec.toHour; h++) {
      cells.push({ hour: h, ms: new Date(y, m - 1, d + i, h).getTime() });
    }
    out.push({ date: localDate(new Date(y, m - 1, d + i)), cells });
  }
  return out;
}

/** The cells no busy span touches: an hour is busy if any part of it is. */
export function freeCells(cells: number[], busy: BusySpan[]): Set<number> {
  const spans = busy.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()]);
  return new Set(cells.filter((ms) => !spans.some(([s, e]) => s < ms + HOUR_MS && e > ms)));
}

/** Offered hour starts grouped by local day, contiguous hours merged into [start, end) spans. */
export function offeredByDay(offered: string[]): { date: string; spans: [number, number][] }[] {
  const days: { date: string; spans: [number, number][] }[] = [];
  for (const ms of offered.map((iso) => new Date(iso).getTime()).sort((a, b) => a - b)) {
    const date = localDate(new Date(ms));
    let day = days[days.length - 1];
    if (day?.date !== date) {
      day = { date, spans: [] };
      days.push(day);
    }
    const last = day.spans[day.spans.length - 1];
    if (last && last[1] === ms) last[1] = ms + HOUR_MS;
    else day.spans.push([ms, ms + HOUR_MS]);
  }
  return days;
}
