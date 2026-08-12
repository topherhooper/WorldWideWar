import Fastify, { type FastifyInstance } from 'fastify';
import type { Firestore } from 'firebase-admin/firestore';

import type {
  CreateGameRequest,
  SubmitLobbyListRequest,
  SubmitOrdersRequest,
  UpdatePrefsRequest,
} from './api-types.js';
import type { Verifiers } from './auth.js';
import {
  createGame,
  deleteGame,
  getView,
  joinGame,
  listGames,
  readReport,
  resolveNow,
  startGame,
  submitLobbyList,
  submitOrders,
  HttpError,
  type AuthedUser,
} from './games.js';
import type { Mailer } from './mailer.js';
import { NOTIFY_KINDS, readPrefs, writePrefs, type NotifyDeps } from './notify.js';
import { runTick } from './tick.js';
import { unsubscribePage, type UnsubSigner } from './unsub.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthedUser;
  }
}

export interface AppDeps {
  db: Firestore;
  mailer: Mailer;
  verifiers: Verifiers;
  baseUrl: string;
  signer: UnsubSigner;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { db, verifiers } = deps;
  const notifyDeps: NotifyDeps = {
    db,
    mailer: deps.mailer,
    signer: deps.signer,
    baseUrl: deps.baseUrl,
  };
  const app = Fastify();

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      void reply.status(err.statusCode).send({ error: err.message });
      return;
    }
    console.error('[http] unhandled error:', err);
    void reply.status(500).send({ error: 'internal error' });
  });

  // The confirm page posts a form, and Gmail's one-click unsubscribe posts
  // `List-Unsubscribe=One-Click` — both form-encoded, which Fastify does not
  // parse out of the box. Without this they 415 before reaching the handler.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    },
  );

  app.get('/healthz', async () => ({ ok: true }));

  app.post('/internal/tick', async (req) => {
    await verifiers.verifyTick(req.headers.authorization);
    return runTick(notifyDeps, new Date());
  });

  // Public by design: reached from a link in an email, where the reader is not
  // signed in and may never have opened the app in this browser.
  const unsubQuery = (req: { query: unknown; body: unknown }): { uid: string; sig: string } => {
    const source = { ...(req.body as object | null), ...(req.query as object) } as {
      u?: string;
      s?: string;
    };
    const { u: uid, s: sig } = source;
    if (typeof uid !== 'string' || typeof sig !== 'string' || uid === '' || sig === '') {
      throw new HttpError(400, 'malformed unsubscribe link');
    }
    if (!deps.signer.verify(uid, sig)) throw new HttpError(400, 'invalid unsubscribe link');
    return { uid, sig };
  };

  app.get('/unsubscribe', async (req, reply) => {
    const { uid, sig } = unsubQuery(req);
    return reply.type('text/html; charset=utf-8').send(
      unsubscribePage({
        uid,
        signature: sig,
        done: false,
        settingsUrl: `${deps.baseUrl}/settings`,
      }),
    );
  });

  app.post('/unsubscribe', async (req, reply) => {
    const { uid, sig } = unsubQuery(req);
    await writePrefs(db, uid, { turnResolved: false, gameOver: false, reminder: false });
    return reply.type('text/html; charset=utf-8').send(
      unsubscribePage({
        uid,
        signature: sig,
        done: true,
        settingsUrl: `${deps.baseUrl}/settings`,
      }),
    );
  });

  app.register(
    async (api) => {
      api.addHook('preHandler', async (req) => {
        req.user = await verifiers.verifyUser(req.headers.authorization);
      });

      api.post('/games', async (req) => {
        const id = await createGame(db, req.user, req.body as CreateGameRequest);
        return { id };
      });

      api.get('/games', async (req) => listGames(db, req.user));

      api.get('/prefs', async (req) => readPrefs(db, req.user.uid));

      api.put('/prefs', async (req) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const patch: UpdatePrefsRequest = {};
        for (const [key, value] of Object.entries(body)) {
          if (!NOTIFY_KINDS.includes(key as never) || typeof value !== 'boolean') {
            throw new HttpError(400, `bad preference: ${key}`);
          }
          patch[key as keyof UpdatePrefsRequest] = value;
        }
        return writePrefs(db, req.user.uid, patch);
      });

      api.get('/games/:id', async (req) => {
        const { id } = req.params as { id: string };
        return getView(db, id, req.user);
      });

      api.delete('/games/:id', async (req) => {
        const { id } = req.params as { id: string };
        await deleteGame(db, id, req.user);
        return { ok: true };
      });

      api.post('/games/:id/join', async (req) => {
        const { id } = req.params as { id: string };
        return joinGame(db, id, req.user);
      });

      api.post('/games/:id/start', async (req) => {
        const { id } = req.params as { id: string };
        return startGame(db, id, req.user);
      });

      api.post('/games/:id/resolve', async (req) => {
        const { id } = req.params as { id: string };
        return resolveNow(notifyDeps, id, req.user);
      });

      api.put('/games/:id/lobby-list', async (req) => {
        const { id } = req.params as { id: string };
        const { list } = req.body as SubmitLobbyListRequest;
        return submitLobbyList(db, id, req.user, list);
      });

      api.put('/games/:id/orders', async (req) => {
        const { id } = req.params as { id: string };
        return submitOrders(notifyDeps, id, req.user, req.body as SubmitOrdersRequest);
      });

      api.get('/games/:id/reports/:turn', async (req) => {
        const { id, turn } = req.params as { id: string; turn: string };
        const report = await readReport(db, id, Number(turn));
        if (report === null) throw new HttpError(404, 'report not found');
        return report;
      });
    },
    { prefix: '/api' },
  );

  return app;
}
