/**
 * Per-client rate limiting.
 *
 * A token bucket rather than a fixed window, because the traffic this has to
 * survive is bursty by design: a player opening three tabs at a turn deadline
 * is normal, and a fixed window would punish them for arriving on the wrong
 * side of a minute boundary.
 *
 * Buckets are separated by what the request costs rather than by endpoint.
 * Creating a game generates a map and pins memory until it expires; reading one
 * is nearly free. Charging them from the same allowance would either throttle
 * ordinary play or leave the expensive path wide open.
 */

export interface RateRule {
  /** Requests available in a burst. */
  capacity: number;
  /** Sustained rate once the burst is spent. */
  perHour: number;
}

export interface RateLimits {
  create: RateRule;
  join: RateRule;
  write: RateRule;
  read: RateRule;
}

export type Bucket = keyof RateLimits;

/**
 * Deliberately generous. These exist to stop a script from filling the disk or
 * the game table, not to police enthusiasm — a player polling every five
 * seconds across two games uses well under half the read allowance.
 */
export const DEFAULT_LIMITS: RateLimits = {
  create: { capacity: 5, perHour: 20 },
  join: { capacity: 10, perHour: 60 },
  write: { capacity: 60, perHour: 1200 },
  read: { capacity: 240, perHour: 4000 },
};

interface Entry {
  tokens: number;
  updated: number;
}

const HOUR_MS = 60 * 60 * 1000;
/** Entries idle this long are forgotten; a full bucket holds no information. */
const IDLE_MS = 2 * HOUR_MS;

export class RateLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly now: () => number,
    private readonly limits: RateLimits = DEFAULT_LIMITS,
  ) {}

  /** Charges one request against `client`. False means refuse it. */
  take(bucket: Bucket, client: string): boolean {
    const rule = this.limits[bucket];
    const key = `${bucket}|${client}`;
    const now = this.now();
    const entry = this.entries.get(key) ?? { tokens: rule.capacity, updated: now };

    const refill = ((now - entry.updated) / HOUR_MS) * rule.perHour;
    entry.tokens = Math.min(rule.capacity, entry.tokens + Math.max(0, refill));
    entry.updated = now;

    const allowed = entry.tokens >= 1;
    if (allowed) entry.tokens -= 1;
    this.entries.set(key, entry);

    return allowed;
  }

  /** Seconds until `client` may retry, for the Retry-After header. */
  retryAfter(bucket: Bucket): number {
    const rule = this.limits[bucket];
    return Math.max(1, Math.ceil(HOUR_MS / rule.perHour / 1000));
  }

  sweep(): void {
    const cutoff = this.now() - IDLE_MS;
    for (const [key, entry] of this.entries) {
      if (entry.updated < cutoff) this.entries.delete(key);
    }
  }

  size(): number {
    return this.entries.size;
  }
}

/**
 * Which allowance a request draws on.
 *
 * `path` has already had the `/api` prefix stripped, matching `ApiRequest`.
 */
export function bucketFor(method: string, path: string): Bucket {
  if (method.toUpperCase() !== 'POST') return 'read';
  if (path === '/games' || path === '/games/') return 'create';
  if (path.endsWith('/join')) return 'join';
  return 'write';
}
