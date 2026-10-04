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

/** The browser's own zone: what the organizer most likely means. */
export function detectedZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Every zone the browser knows, for the picker; just the detected one where unsupported. */
export function knownZones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  return supported ? supported('timeZone') : [detectedZone()];
}

const partsFormat = new Map<string, Intl.DateTimeFormat>();
/** Wall-clock fields of an instant in a zone. */
function wallClock(ms: number, timeZone: string) {
  let fmt = partsFormat.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    partsFormat.set(timeZone, fmt);
  }
  const get = (type: string) =>
    Number(fmt.formatToParts(new Date(ms)).find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') };
}

/** How far a zone's wall clock runs ahead of UTC at an instant, in ms. */
function zoneOffset(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min) - Math.floor(ms / 60_000) * 60_000;
}

/**
 * The instant a wall-clock hour starts in a zone. Two passes settle daylight-saving edges; an
 * hour that does not exist (clocks jump forward) lands on the hour after the jump.
 */
export function zonedHour(y: number, m: number, d: number, hour: number, timeZone: string) {
  const wall = Date.UTC(y, m - 1, d, hour);
  let ms = wall - zoneOffset(wall, timeZone);
  ms = wall - zoneOffset(ms, timeZone);
  return ms;
}

/** A calendar date as YYYY-MM-DD, in a zone (the browser's when omitted). */
export function localDate(d: Date, timeZone?: string): string {
  if (!timeZone) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const w = wallClock(d.getTime(), timeZone);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}

/** One row per day, one cell per hour, in the given zone (the browser's when omitted). */
export function gridDays(spec: GridSpec, timeZone: string = detectedZone()): GridDay[] {
  const [y, m, d] = spec.firstDay.split('-').map(Number);
  if (!y || !m || !d) return [];
  const out: GridDay[] = [];
  for (let i = 0; i < spec.days; i++) {
    // Date.UTC normalises day overflow, so the 32nd of a month is the 1st of the next.
    const day = new Date(Date.UTC(y, m - 1, d + i));
    const [dy, dm, dd] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    const cells: GridCell[] = [];
    for (let h = spec.fromHour; h < spec.toHour; h++) {
      cells.push({ hour: h, ms: zonedHour(dy, dm, dd, h, timeZone) });
    }
    out.push({ date: `${dy}-${pad(dm)}-${pad(dd)}`, cells });
  }
  return out;
}

/** The cells no busy span touches: an hour is busy if any part of it is. */
export function freeCells(cells: number[], busy: BusySpan[]): Set<number> {
  const spans = busy.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()]);
  return new Set(cells.filter((ms) => !spans.some(([s, e]) => s < ms + HOUR_MS && e > ms)));
}

/** Offered hour starts grouped by day in a zone, contiguous hours merged into [start, end). */
export function offeredByDay(
  offered: string[],
  timeZone: string = detectedZone(),
): { date: string; spans: [number, number][] }[] {
  const days: { date: string; spans: [number, number][] }[] = [];
  for (const ms of offered.map((iso) => new Date(iso).getTime()).sort((a, b) => a - b)) {
    const date = localDate(new Date(ms), timeZone);
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
