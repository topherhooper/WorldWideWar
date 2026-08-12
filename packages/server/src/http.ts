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
import { bucketFor, DEFAULT_LIMITS, RateLimiter, type RateLimits } from './limits.js';
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
  /**
   * Trust `X-Forwarded-For` for the client address. On behind a reverse proxy
   * that sets it, off when the socket is the only thing that cannot lie —
   * a directly exposed server that trusted the header would let any client
   * claim a fresh rate-limit allowance per request.
   */
  trustProxy?: boolean;
  rateLimits?: RateLimits;
}

export interface RunningServer {
  server: ReturnType<typeof createHttpServer>;
  store: GameStore;
  listen: (port: number, host?: string) => Promise<number>;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 256 * 1024;
const HEARTBEAT_MS = 25_000;

/**
 * The client loads no third-party anything, and has no inline script or style,
 * so the policy can be about as tight as a policy gets. `data:` is open for
 * images only, for the inline favicon.
 *
 * Strict-Transport-Security is deliberately absent: the server does not know
 * whether it is being reached over TLS, and the terminating proxy does.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'geolocation=(), camera=(), microphone=(), payment=()',
};

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
  const trustProxy = options.trustProxy ?? false;
  const limiter = new RateLimiter(store.deps.now, options.rateLimits ?? DEFAULT_LIMITS);

  const server = createHttpServer((request, response) => {
    handle({ store, webRoots, limiter, trustProxy }, request, response).catch((error: unknown) => {
      // Whatever went wrong, the client learns that something did and nothing
      // else: an internal message is for the log, not for the wire.
      console.error('request failed:', error);
      sendJson(response, 500, { error: 'server error' });
    });
  });

  const timer = setInterval(() => {
    store.tick();
    limiter.sweep();
  }, tickMs);
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

interface Context {
  store: GameStore;
  webRoots: string[];
  limiter: RateLimiter;
  trustProxy: boolean;
}

async function handle(
  context: Context,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const { store, webRoots, limiter, trustProxy } = context;
  const url = new URL(request.url ?? '/', 'http://localhost');

  // A path that is not valid percent-encoding is the client's mistake, not an
  // internal failure — say so rather than logging a stack trace for it.
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    sendJson(response, 400, { error: 'malformed URL' });
    return;
  }

  if (path.startsWith('/api/')) {
    const apiPath = path.slice('/api'.length);
    const method = request.method ?? 'GET';
    const bucket = bucketFor(method, apiPath);

    if (!limiter.take(bucket, clientAddress(request, trustProxy))) {
      response.setHeader('retry-after', String(limiter.retryAfter(bucket)));
      sendJson(response, 429, { error: 'too many requests — slow down' });
      return;
    }

    const stream = apiPath.match(/^\/games\/([^/]+)\/stream$/);
    if (stream) {
      // The stream carries nothing but a version number, so it needs no seat
      // token — which is what keeps credentials out of URLs entirely, since an
      // EventSource cannot send a header.
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
      method,
      path: apiPath,
      query: url.searchParams,
      body,
      headers: request.headers as Record<string, string | undefined>,
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

/**
 * Who to charge a request to.
 *
 * `X-Forwarded-For` is a list the client can prepend to, so only the last entry
 * — the one the trusted proxy appended — is worth anything.
 */
function clientAddress(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const chain = Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '');
    const hops = chain
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return request.socket.remoteAddress ?? 'unknown';
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
    ...SECURITY_HEADERS,
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
    ...SECURITY_HEADERS,
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
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}
