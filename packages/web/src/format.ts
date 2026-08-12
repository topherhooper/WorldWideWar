const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRemaining(deadlineIso: string, now: number = Date.now()): string {
  const ms = new Date(deadlineIso).getTime() - now;
  if (ms <= 0) return 'resolving…';
  if (ms < MINUTE) return 'under a minute';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    const m = Math.floor((ms % HOUR) / MINUTE);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

const PLAYER_COLORS = [
  '#e6553a',
  '#4da6ff',
  '#66cc66',
  '#e6c84d',
  '#b980ff',
  '#ff9e4d',
  '#4dd2c4',
  '#ff80b3',
  '#a3e64d',
  '#7f8cff',
  '#d9a066',
  '#66e0ff',
];

export const playerColor = (slot: number): string => PLAYER_COLORS[slot % PLAYER_COLORS.length];
