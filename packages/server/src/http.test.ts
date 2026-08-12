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
      await fetch(`${base}/api/games/${code}?token=${token}`)
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
