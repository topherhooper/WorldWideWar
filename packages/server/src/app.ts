import Fastify, { type FastifyInstance } from 'fastify';
import type { Firestore } from 'firebase-admin/firestore';

import type {
  CreateGameRequest,
  PartyActionRequest,
  SacreActionRequest,
  SubmitLobbyListRequest,
  SubmitOrdersRequest,
  TakePartySeatRequest,
  UpdateConfigRequest,
  UpdatePartyConfigRequest,
  UpdateSacreConfigRequest,
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
  updateConfig,
  HttpError,
  type AuthedUser,
} from './games.js';
import type { Mailer } from './mailer.js';
import { NOTIFY_KINDS, readPrefs, writePrefs, type NotifyDeps } from './notify.js';
import { runTick } from './tick.js';
import {
  actOnParty,
  createPartyGame,
  dropPartySeat,
  getPartyView,
  takePartySeat,
  updatePartyConfig,
} from './party.js';
import {
  actOnSacre,
  createSacreGame,
  getSacreView,
  takeSacreSeat,
  updateSacreConfig,
} from './sacre.js';
import { games, isPartyDoc, isSacreDoc, type GameDoc } from './store.js';
import { unsubscribeErrorPage, unsubscribePage, type UnsubSigner } from './unsub.js';

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

/**
 * One extra read on the shared `GET /games/:id`, so the route can dispatch to
 * the right view builder. Cheap against a document Firestore has cached, and it
 * keeps `kind` out of the URL — an invite link is the same shape for both games,
 * which is the entire point of this mode living behind `/g/:id`.
 */
async function peekKind(db: FirebaseFirestore.Firestore, gameId: string): Promise<GameDoc | null> {
  const snap = await games(db).doc(gameId).get();
  return snap.exists ? (snap.data() as GameDoc) : null;
}

const isParty = (doc: GameDoc | null): boolean => doc !== null && isPartyDoc(doc);
const isSacre = (doc: GameDoc | null): boolean => doc !== null && isSacreDoc(doc);

export function buildApp(deps: AppDeps): FastifyInstance {
  const { db, verifiers } = deps;
  const notifyDeps: NotifyDeps = {
    db,
    mailer: deps.mailer,
    signer: deps.signer,
    baseUrl: deps.baseUrl,
  };
  const app = Fastify();

  app.setErrorHandler((err, req, reply) => {
    // /unsubscribe is read by a person in a browser, not by the client app, so
    // it gets a page. Everything else is an API and gets JSON.
    if (req.url.startsWith('/unsubscribe')) {
      const status = err instanceof HttpError ? err.statusCode : 500;
      if (status >= 500) console.error('[http] unhandled error:', err);
      void reply
        .status(status)
        .type('text/html; charset=utf-8')
        .send(unsubscribeErrorPage(`${deps.baseUrl}/settings`));
      return;
    }
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
        const body = (req.body ?? {}) as CreateGameRequest;
        // Absent `kind` still means war: a web bundle cached across a deploy
        // sends none, and that must keep creating the game it always did.
        const id =
          body.kind === 'party'
            ? await createPartyGame(db, req.user, body)
            : body.kind === 'cards'
              ? await createSacreGame(db, req.user, body)
              : await createGame(db, req.user, body);
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

      // The one read both games share. It dispatches rather than branching
      // inside `getView`, because a party's view is assembled from a different
      // redactor and never touches the orders collection.
      api.get('/games/:id', async (req) => {
        const { id } = req.params as { id: string };
        const doc = await peekKind(db, id);
        if (isParty(doc)) return getPartyView(db, id, req.user);
        if (isSacre(doc)) return getSacreView(db, id, req.user);
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

      api.post('/games/:id/party/seat', async (req) => {
        const { id } = req.params as { id: string };
        return takePartySeat(db, id, req.user, (req.body ?? {}) as TakePartySeatRequest);
      });

      api.delete('/games/:id/party/seat/:slot', async (req) => {
        const { id, slot } = req.params as { id: string; slot: string };
        return dropPartySeat(db, id, req.user, Number(slot));
      });

      api.post('/games/:id/party/config', async (req) => {
        const { id } = req.params as { id: string };
        return updatePartyConfig(db, id, req.user, (req.body ?? {}) as UpdatePartyConfigRequest);
      });

      // Deal, bell, meet, confirm, deny, sniff, nominate and vote all arrive
      // here. The prototype gave each its own route and its own validation; the
      // rules live in the engine now, so the server needs one door.
      api.post('/games/:id/party/act', async (req) => {
        const { id } = req.params as { id: string };
        return actOnParty(db, id, req.user, (req.body ?? {}) as PartyActionRequest);
      });

      api.post('/games/:id/cards/seat', async (req) => {
        const { id } = req.params as { id: string };
        return takeSacreSeat(db, id, req.user);
      });

      api.post('/games/:id/cards/config', async (req) => {
        const { id } = req.params as { id: string };
        return updateSacreConfig(db, id, req.user, (req.body ?? {}) as UpdateSacreConfigRequest);
      });

      // Deal, score, advertise, cycle, return, exchange, respond and pass all
      // arrive here. The rules live in the engine, so the server needs one door.
      api.post('/games/:id/cards/act', async (req) => {
        const { id } = req.params as { id: string };
        return actOnSacre(db, id, req.user, (req.body ?? {}) as SacreActionRequest);
      });

      api.post('/games/:id/config', async (req) => {
        const { id } = req.params as { id: string };
        return updateConfig(db, id, req.user, req.body as UpdateConfigRequest);
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
