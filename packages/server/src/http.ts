/**
 * HTTP transport: static files, the JSON API, and the event stream.
 *
 * The only interesting decision here is the stream. Turn resolution is an event
 * the client cannot predict — another player locking in can end the turn early
 * — so the server pushes a bare version number over SSE and the client refetches
 * whatever it needs. That keeps exactly one code path for reading state, rather
 * than a fast one over the socket and a slow one over HTTP that can disagree.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { handleApi } from './api.js';
import { GameStore } from './store.js';

export interface ServerOptions {
  store?: GameStore;
  /**
   * Directories of client assets, searched in order. The client is deliberately
   * unbundled — compiled modules live in one directory and hand-written HTML and
   * CSS in another — so serving both is what replaces a build step.
   */
  webRoots?: string[];
  /** How often deadlines are checked. */
  tickMs?: number;
}

export interface RunningServer {
  server: ReturnType<typeof createHttpServer>;
  store: GameStore;
  listen: (port: number, host?: string) => Promise<number>;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 256 * 1024;
const HEARTBEAT_MS = 25_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function createServer(options: ServerOptions = {}): RunningServer {
  const store = options.store ?? new GameStore();
  const webRoots = (options.webRoots ?? []).map((root) => resolve(root));
  const tickMs = options.tickMs ?? 1000;

  const server = createHttpServer((request, response) => {
    handle(store, webRoots, request, response).catch((error: unknown) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : 'server error' });
    });
  });

  const timer = setInterval(() => store.tick(), tickMs);
  // A pending deadline should never be the reason a process refuses to exit.
  timer.unref?.();

  return {
    server,
    store,
    listen: (port, host = '0.0.0.0') =>
      new Promise<number>((resolvePort, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const address = server.address();
          resolvePort(typeof address === 'object' && address ? address.port : port);
        });
      }),
    close: () =>
      new Promise<void>((done) => {
        clearInterval(timer);
        server.closeAllConnections?.();
        server.close(() => done());
      }),
  };
}

async function handle(
  store: GameStore,
  webRoots: string[],
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  if (path.startsWith('/api/')) {
    const apiPath = path.slice('/api'.length);

    const stream = apiPath.match(/^\/games\/([^/]+)\/stream$/);
    if (stream) {
      openStream(store, stream[1], request, response);
      return;
    }

    let body: unknown = null;
    if (request.method === 'POST' || request.method === 'PUT') {
      try {
        body = await readJson(request);
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : 'invalid request body',
        });
        return;
      }
    }

    const result = handleApi(store, {
      method: request.method ?? 'GET',
      path: apiPath,
      query: url.searchParams,
      body,
    });
    sendJson(response, result.status, result.body);
    return;
  }

  if (webRoots.length === 0) {
    sendJson(response, 404, { error: 'not found' });
    return;
  }

  await sendStatic(webRoots, path, request, response);
}

// ─── Server-sent events ──────────────────────────────────────────────────────

function openStream(
  store: GameStore,
  idOrCode: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const game = store.find(idOrCode);
  if (!game) {
    sendJson(response, 404, { error: 'no such game' });
    return;
  }

  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  response.write('retry: 3000\n\n');
  response.write(`event: version\ndata: ${game.version}\n\n`);

  const unsubscribe = store.subscribe(game.id, (version) => {
    response.write(`event: version\ndata: ${version}\n\n`);
  });

  const heartbeat = setInterval(() => response.write(': ping\n\n'), HEARTBEAT_MS);
  heartbeat.unref?.();

  const stop = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  request.on('close', stop);
  response.on('close', stop);
}

// ─── Static files ────────────────────────────────────────────────────────────

async function sendStatic(
  webRoots: string[],
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const candidates: string[] = [];
  for (const root of webRoots) {
    const target = safeJoin(root, path);
    if (target) candidates.push(target, join(target, 'index.html'));
  }

  const file = await firstExisting(candidates);
  // Client-side routing: an unknown path is a route, not a missing file.
  const fallback = file ?? (await firstExisting(webRoots.map((root) => join(root, 'index.html'))));
  if (!fallback) {
    sendJson(response, 404, { error: 'not found' });
    return;
  }

  const type = MIME[extname(fallback).toLowerCase()] ?? 'application/octet-stream';
  response.writeHead(200, {
    'content-type': type,
    // The client is rebuilt on every deploy and served from a bare filename, so
    // caching it would serve yesterday's game to today's server.
    'cache-control': 'no-cache',
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(fallback).pipe(response);
}

function safeJoin(root: string, path: string): string | null {
  const candidate = resolve(join(root, normalize(path)));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      const info = await stat(path);
      if (info.isFile()) return path;
    } catch {
      // Missing is the common case, not an error worth reporting.
    }
  }
  return null;
}

// ─── Wire helpers ────────────────────────────────────────────────────────────

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((done, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        done(null);
        return;
      }
      try {
        done(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });

    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  const payload = JSON.stringify(body ?? null);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}
