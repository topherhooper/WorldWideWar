import Fastify, { type FastifyInstance } from 'fastify';
import type { Firestore } from 'firebase-admin/firestore';

import type { CreateGameRequest, SubmitOrdersRequest } from './api-types.js';
import type { Verifiers } from './auth.js';
import {
  createGame,
  getView,
  joinGame,
  listGames,
  readReport,
  startGame,
  submitOrders,
  HttpError,
  type AuthedUser,
} from './games.js';
import type { Mailer } from './mailer.js';
import { runTick } from './tick.js';

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
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { db, mailer, verifiers, baseUrl } = deps;
  const app = Fastify();

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      void reply.status(err.statusCode).send({ error: err.message });
      return;
    }
    console.error('[http] unhandled error:', err);
    void reply.status(500).send({ error: 'internal error' });
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.post('/internal/tick', async (req) => {
    await verifiers.verifyTick(req.headers.authorization);
    return runTick(db, mailer, baseUrl, new Date());
  });

  app.register(async (api) => {
    api.addHook('preHandler', async (req) => {
      req.user = await verifiers.verifyUser(req.headers.authorization);
    });

    api.post('/games', async (req) => {
      const id = await createGame(db, req.user, req.body as CreateGameRequest);
      return { id };
    });

    api.get('/games', async (req) => listGames(db, req.user));

    api.get('/games/:id', async (req) => {
      const { id } = req.params as { id: string };
      return getView(db, id, req.user);
    });

    api.post('/games/:id/join', async (req) => {
      const { id } = req.params as { id: string };
      return joinGame(db, id, req.user);
    });

    api.post('/games/:id/start', async (req) => {
      const { id } = req.params as { id: string };
      return startGame(db, id, req.user);
    });

    api.put('/games/:id/orders', async (req) => {
      const { id } = req.params as { id: string };
      return submitOrders(db, mailer, baseUrl, id, req.user, req.body as SubmitOrdersRequest);
    });

    api.get('/games/:id/reports/:turn', async (req) => {
      const { id, turn } = req.params as { id: string; turn: string };
      const report = await readReport(db, id, Number(turn));
      if (report === null) throw new HttpError(404, 'report not found');
      return report;
    });
  }, { prefix: '/api' });

  return app;
}
