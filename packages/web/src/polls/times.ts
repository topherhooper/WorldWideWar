/** The date/time arithmetic behind the poll form and the poll page. Pure, so it is testable. */

const HOUR = 60 * 60 * 1000;
export const MAX_SPAN_MS = 24 * HOUR;
export const MIN_CANDIDATES = 2;
export const MAX_CANDIDATES = 6;

/** One row of the "when" list, as the browser's date and time inputs hold it. */
export interface CandidateRow {
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string; // HH:MM
}

export interface Instants {
  startsAt: string; // ISO
  endsAt: string; // ISO
}

/**
 * Local date and times to instants. The browser's zone is the organizer's zone, which is what
 * they meant. An end at or before the start means the next day: "21:00–01:00".
 * Null while the row is incomplete or the date is not a real date.
 */
export function rowInstants(row: CandidateRow): Instants | null {
  if (row.date === '' || row.start === '' || row.end === '') return null;
  const start = new Date(`${row.date}T${row.start}`);
  if (Number.isNaN(start.getTime())) return null;
  let end = new Date(`${row.date}T${row.end}`);
  if (Number.isNaN(end.getTime())) return null;
  if (end.getTime() <= start.getTime()) {
    // setDate rather than +24h, so a clock change does not shift the end by an hour.
    end = new Date(end);
    end.setDate(end.getDate() + 1);
  }
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

/** A new row copies the previous row's times: "same time, different day" is the common case. */
export function nextRow(rows: CandidateRow[]): CandidateRow {
  const last = rows[rows.length - 1];
  return { date: '', start: last?.start ?? '', end: last?.end ?? '' };
}

/**
 * Mirrors the server's rules so the form can say what is wrong before a round trip. The
 * server stays the authority; this only saves a trip.
 */
export function validateNewPoll(
  input: { title: string; rows: CandidateRow[]; deadline: string },
  now: number = Date.now(),
): { error: string } | { candidates: Instants[]; deadlineAt: string | null } {
  const title = input.title.trim();
  if (title.length < 1 || title.length > 80)
    return { error: 'Give the poll a title (up to 80 characters).' };

  if (input.rows.length < MIN_CANDIDATES) return { error: 'Offer at least two times.' };
  const candidates: Instants[] = [];
  for (const row of input.rows) {
    const instants = rowInstants(row);
    if (instants === null) return { error: 'Fill in a date, a start and an end for every time.' };
    const start = new Date(instants.startsAt).getTime();
    const end = new Date(instants.endsAt).getTime();
    if (start <= now) return { error: 'Every time has to be in the future.' };
    if (end - start > MAX_SPAN_MS) return { error: 'A time can be at most 24 hours long.' };
    candidates.push(instants);
  }
  const keys = candidates.map((c) => `${c.startsAt}|${c.endsAt}`);
  if (new Set(keys).size !== keys.length) return { error: 'Two of the times are the same.' };

  let deadlineAt: string | null = null;
  if (input.deadline !== '') {
    const deadline = new Date(input.deadline);
    if (Number.isNaN(deadline.getTime())) return { error: 'That deadline is not a real time.' };
    const lastStart = Math.max(...candidates.map((c) => new Date(c.startsAt).getTime()));
    if (deadline.getTime() <= now) return { error: 'The deadline has to be in the future.' };
    if (deadline.getTime() >= lastStart) {
      return { error: 'The deadline has to come before the last time.' };
    }
    deadlineAt = deadline.toISOString();
  }
  candidates.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { candidates, deadlineAt };
}

const RANGE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

/** "Sat, Oct 14, 7:00 – 11:00 PM" in the viewer's own zone. */
export function formatRange(startIso: string, endIso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, RANGE_FORMAT).formatRange(
    new Date(startIso),
    new Date(endIso),
  );
}
