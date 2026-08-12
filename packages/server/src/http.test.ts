/**
 * The transport, exercised over a real socket.
 *
 * `api.test`-style calls prove the routing; these prove the parts only a real
 * request can: body limits, path traversal, the SPA fallback, and that the
 * event stream actually delivers a version bump to a listening client.
 */

import { get as httpGet } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type RunningServer } from './http.js';
import type { GameView, JoinResponse } from './protocol.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../../web/public');

let app: RunningServer;
let base: string;

beforeAll(async () => {
  app = createServer({ webRoots: [publicDir], tickMs: 50 });
  const port = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app.close();
});

async function createGame(): Promise<JoinResponse> {
  const response = await fetch(`${base}/api/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Ada',
      playerCount: 4,
      humanSeats: 1,
      turnSeconds: 60,
      seed: 'http-test',
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as JoinResponse;
}

describe('static files', () => {
  it('serves the client', async () => {
    const response = await fetch(base);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('World Wide War');
  });

  it('serves the stylesheet with its own type', async () => {
    const response = await fetch(`${base}/style.css`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');
  });

  it('treats an unknown path as a client route, not a missing file', async () => {
    const response = await fetch(`${base}/g/ABC123`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('refuses to walk out of the web root', async () => {
    // Encoded so the server, not the HTTP client, is the thing being tested.
    const response = await fetch(`${base}/%2e%2e/%2e%2e/package.json`);
    const body = await response.text();
    expect(body).not.toContain('"packageManager"');
    expect(body).toContain('<!doctype html>');
  });
});

describe('the JSON API over HTTP', () => {
  it('creates, reads and orders a game', async () => {
    const { code, token } = await createGame();

    const view = (await (
      await fetch(`${base}/api/games/${code}`, { headers: { 'x-seat-token': token } })
    ).json()) as GameView;
    expect(view.phase).toBe('active');
    expect(view.you?.slot).toBe(0);

    const map = (await (await fetch(`${base}/api/games/${code}/map`)).json()) as {
      territories: unknown[];
    };
    expect(map.territories.length).toBeGreaterThan(0);

    const ordered = await fetch(`${base}/api/games/${code}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, locked: true, orders: { pledge: 1, deploys: [], units: [] } }),
    });
    expect(ordered.status).toBe(200);
    expect(((await ordered.json()) as GameView).turn).toBe(2);
  });

  it('answers a malformed body with 400 rather than a stack trace', async () => {
    const response = await fetch(`${base}/api/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toHaveProperty('error');
  });

  it('refuses a body larger than the limit', async () => {
    const response = await fetch(`${base}/api/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(400 * 1024) }),
    }).catch(() => null);

    // Either the server answered 400 or it hung up mid-upload; both are refusals.
    expect(response === null || response.status === 400).toBe(true);
  });

  it('404s an unknown game and an unknown endpoint', async () => {
    expect((await fetch(`${base}/api/games/NOPE01`)).status).toBe(404);
    expect((await fetch(`${base}/api/nonsense`)).status).toBe(404);
  });
});

/**
 * Read an event stream with the raw client rather than `fetch`, which is free
 * to buffer a response that never ends — exactly the case here.
 */
function openStream(url: string): {
  seen: () => string;
  waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<string>;
  close: () => void;
  contentType: Promise<string>;
} {
  let buffer = '';
  const waiters: (() => void)[] = [];
  const request = httpGet(url);

  const contentType = new Promise<string>((done, fail) => {
    request.on('response', (response) => {
      done(response.headers['content-type'] ?? '');
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        buffer += chunk;
        for (const wake of waiters.splice(0)) wake();
      });
    });
    request.on('error', fail);
  });

  return {
    contentType,
    seen: () => buffer,
    close: () => request.destroy(),
    waitFor: async (pattern, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      while (!pattern.test(buffer)) {
        if (Date.now() > deadline) throw new Error(`never saw ${pattern} in: ${buffer}`);
        await new Promise<void>((wake) => {
          waiters.push(wake);
          setTimeout(wake, 100);
        });
      }
      return buffer;
    },
  };
}

describe('hardening', () => {
  it('sends a strict policy with every kind of response', async () => {
    const { code } = await createGame();

    for (const url of [base, `${base}/style.css`, `${base}/api/games`]) {
      const response = await fetch(url);
      const policy = response.headers.get('content-security-policy') ?? '';
      expect(policy, url).toContain("default-src 'self'");
      // The client has no inline script or style, so nothing needs unsafe-*.
      expect(policy, url).not.toContain('unsafe-inline');
      expect(policy, url).not.toContain('unsafe-eval');
      expect(policy, url).toContain("frame-ancestors 'none'");
      expect(response.headers.get('x-content-type-options'), url).toBe('nosniff');
      expect(response.headers.get('referrer-policy'), url).toBe('no-referrer');
      await response.text();
    }

    const stream = await fetch(`${base}/api/games/${code}/stream`);
    expect(stream.headers.get('content-security-policy')).toContain("default-src 'self'");
    await stream.body?.cancel();
  });

  it('answers a malformed URL without a stack trace', async () => {
    // Valid as a URL, but not valid percent-encoding.
    const response = await fetch(`${base}/%E0%A4%A`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'malformed URL' });
  });

  it('refuses a flood of game creation, with a Retry-After', async () => {
    const tight = createServer({
      webRoots: [publicDir],
      tickMs: 1000,
      rateLimits: {
        create: { capacity: 2, perHour: 2 },
        join: { capacity: 50, perHour: 500 },
        write: { capacity: 50, perHour: 500 },
        read: { capacity: 50, perHour: 500 },
      },
    });
    const port = await tight.listen(0, '127.0.0.1');
    const origin = `http://127.0.0.1:${port}`;

    const create = (): Promise<Response> =>
      fetch(`${origin}/api/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Flood',
          playerCount: 3,
          humanSeats: 1,
          turnSeconds: 60,
        }),
      });

    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(201);

    const refused = await create();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    await refused.text();

    // Being throttled for creating games must not stop you playing one.
    const reading = await fetch(`${origin}/api/games`);
    expect(reading.status).toBe(200);
    await reading.text();

    await tight.close();
  });

  it('only believes X-Forwarded-For when told to trust a proxy', async () => {
    const limits = {
      create: { capacity: 1, perHour: 1 },
      join: { capacity: 50, perHour: 500 },
      write: { capacity: 50, perHour: 500 },
      read: { capacity: 50, perHour: 500 },
    };

    const body = JSON.stringify({
      name: 'Proxy',
      playerCount: 3,
      humanSeats: 1,
      turnSeconds: 60,
    });

    const attempt = async (origin: string, forwarded: string): Promise<number> => {
      const response = await fetch(`${origin}/api/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': forwarded },
        body,
      });
      await response.text();
      return response.status;
    };

    const untrusting = createServer({ webRoots: [publicDir], rateLimits: limits });
    const a = `http://127.0.0.1:${await untrusting.listen(0, '127.0.0.1')}`;
    expect(await attempt(a, '10.0.0.1')).toBe(201);
    // Same socket, new claimed address — and it buys nothing.
    expect(await attempt(a, '10.0.0.2')).toBe(429);
    await untrusting.close();

    const trusting = createServer({
      webRoots: [publicDir],
      rateLimits: limits,
      trustProxy: true,
    });
    const b = `http://127.0.0.1:${await trusting.listen(0, '127.0.0.1')}`;
    expect(await attempt(b, '10.0.0.1')).toBe(201);
    expect(await attempt(b, '10.0.0.2')).toBe(201);
    expect(await attempt(b, '10.0.0.2')).toBe(429);
    // A client prepending its own hop cannot dodge the limit: only the entry
    // the trusted proxy appended counts.
    expect(await attempt(b, 'fake, 10.0.0.2')).toBe(429);
    await trusting.close();
  });
});

describe('the event stream', () => {
  it('pushes a version bump to a listening client', async () => {
    const { code, token } = await createGame();
    const stream = openStream(`${base}/api/games/${code}/stream`);

    expect(await stream.contentType).toContain('text/event-stream');
    // The stream opens by stating where the client is starting from.
    await stream.waitFor(/event: version/);
    const opening = stream.seen();

    await fetch(`${base}/api/games/${code}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, locked: false, orders: { pledge: 2, deploys: [], units: [] } }),
    });

    const after = await stream.waitFor(/(event: version[\s\S]*){2}/);
    expect(after.length).toBeGreaterThan(opening.length);
    stream.close();
  });

  it('404s a stream for a game that does not exist', async () => {
    const response = await fetch(`${base}/api/games/NOPE01/stream`);
    expect(response.status).toBe(404);
    await response.text();
  });
});
