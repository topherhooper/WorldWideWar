import { describe, expect, it } from 'vitest';
import { bucketFor, RateLimiter, type RateLimits } from './limits.js';

function clock(): { now: () => number; advance: (ms: number) => void } {
  let value = 1_700_000_000_000;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
}

const LIMITS: RateLimits = {
  create: { capacity: 2, perHour: 4 },
  join: { capacity: 3, perHour: 60 },
  write: { capacity: 5, perHour: 600 },
  read: { capacity: 10, perHour: 3600 },
};

describe('rate limiting', () => {
  it('allows a burst, then refuses', () => {
    const time = clock();
    const limiter = new RateLimiter(time.now, LIMITS);

    expect(limiter.take('create', 'a')).toBe(true);
    expect(limiter.take('create', 'a')).toBe(true);
    expect(limiter.take('create', 'a')).toBe(false);
  });

  it('refills over time rather than at a window boundary', () => {
    const time = clock();
    const limiter = new RateLimiter(time.now, LIMITS);

    limiter.take('create', 'a');
    limiter.take('create', 'a');
    expect(limiter.take('create', 'a')).toBe(false);

    // Four an hour is one every fifteen minutes.
    time.advance(14 * 60 * 1000);
    expect(limiter.take('create', 'a')).toBe(false);
    time.advance(2 * 60 * 1000);
    expect(limiter.take('create', 'a')).toBe(true);
  });

  it('never refills past the burst size', () => {
    const time = clock();
    const limiter = new RateLimiter(time.now, LIMITS);

    time.advance(30 * 24 * 60 * 60 * 1000);
    expect(limiter.take('create', 'a')).toBe(true);
    expect(limiter.take('create', 'a')).toBe(true);
    expect(limiter.take('create', 'a')).toBe(false);
  });

  it('keeps clients and buckets apart', () => {
    const limiter = new RateLimiter(clock().now, LIMITS);

    limiter.take('create', 'a');
    limiter.take('create', 'a');
    expect(limiter.take('create', 'a')).toBe(false);
    // A second player is unaffected...
    expect(limiter.take('create', 'b')).toBe(true);
    // ...and so is the first player's ability to keep playing.
    expect(limiter.take('write', 'a')).toBe(true);
    expect(limiter.take('read', 'a')).toBe(true);
  });

  it('forgets clients that have gone away', () => {
    const time = clock();
    const limiter = new RateLimiter(time.now, LIMITS);

    limiter.take('read', 'a');
    expect(limiter.size()).toBe(1);

    limiter.sweep();
    expect(limiter.size()).toBe(1);

    time.advance(3 * 60 * 60 * 1000);
    limiter.sweep();
    expect(limiter.size()).toBe(0);
  });

  it('charges each kind of request to the right allowance', () => {
    expect(bucketFor('POST', '/games')).toBe('create');
    expect(bucketFor('POST', '/games/ABC123/join')).toBe('join');
    expect(bucketFor('POST', '/games/ABC123/orders')).toBe('write');
    expect(bucketFor('POST', '/games/ABC123/resign')).toBe('write');
    expect(bucketFor('GET', '/games')).toBe('read');
    expect(bucketFor('GET', '/games/ABC123')).toBe('read');
    expect(bucketFor('GET', '/games/ABC123/stream')).toBe('read');
  });

  it('sustains ordinary play well inside the default allowance', () => {
    const time = clock();
    const limiter = new RateLimiter(time.now);
    let refused = 0;

    // An hour of two open tables polling every five seconds, plus a couple of
    // order edits a minute. If this trips, the limits are wrong, not the player.
    for (let second = 0; second < 3600; second += 5) {
      if (!limiter.take('read', 'player')) refused++;
      if (!limiter.take('read', 'player')) refused++;
      if (second % 30 === 0 && !limiter.take('write', 'player')) refused++;
      time.advance(5000);
    }

    expect(refused).toBe(0);
  });
});
