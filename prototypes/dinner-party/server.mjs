// PROTOTYPE. Notebook code for ideas/dinner-party-murder-mystery.md -- expected to be
// thrown away. In-memory, no deps, no persistence, no auth worth the name.
//
//   node prototypes/dinner-party/server.mjs      # then open http://localhost:8787
//
// The one thing here that is trying to be right is `viewFor` -- the single function a
// role can pass through on its way to a client, the way `packages/engine/src/redact.ts`
// is the single exit for game state.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import { PAGE } from './page.mjs';

const PORT = Number(process.env.PORT ?? 8787);

// ─── The cast ────────────────────────────────────────────────────────────────
//
// Two pools, and which one you are dealt from depends on age, not luck. A player who
// cannot hold a secret for an hour is never dealt one: the kid pool is all public jobs
// with something concrete to DO, and every kid card is safe to read aloud.

const SECRET_ROLES = [
  {
    name: 'The Murderer',
    secret: true,
    card: 'You did it. The pudding was yours. Do not get caught.',
  },
  {
    name: 'The Detective',
    secret: true,
    card: 'You are on the case. You may ask one person a direct question each course.',
  },
  {
    name: 'The Heir',
    secret: true,
    card: 'You needed the money. You are innocent, and it looks terrible.',
  },
  {
    name: 'The Old Friend',
    secret: true,
    card: 'You know a secret about the Heir. You are innocent.',
  },
  {
    name: 'The Rival',
    secret: true,
    card: 'You argued with the victim tonight. You are innocent.',
  },
  { name: 'The Neighbour', secret: true, card: 'You saw someone in the garden. You are innocent.' },
];

const KID_ROLES = [
  {
    name: 'The Bell-Ringer',
    secret: false,
    card: 'Your job: ring the bell whenever you want. Everyone must stop and say where they were. Tell people your job -- it is not a secret.',
  },
  {
    name: 'The Dog',
    secret: false,
    card: 'Your job: you saw everything, but you can only bark. Bark twice when someone says something untrue. Tell people your job -- it is not a secret.',
  },
  {
    name: 'The Waiter',
    secret: false,
    card: 'Your job: bring one person a napkin whenever you like. That person must then say one true thing. Tell people your job -- it is not a secret.',
  },
];

// ─── State ───────────────────────────────────────────────────────────────────

/** code -> { hostToken, dealt, players: [{ id, token, name, young, role }] } */
const rooms = new Map();

function makeCode() {
  const alphabet = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels, no I/O/0/1 -- read aloud at a table
  let code = '';
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return rooms.has(code) ? makeCode() : code;
}

function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function deal(room) {
  const kids = room.players.filter((p) => p.young);
  const grownups = room.players.filter((p) => !p.young);
  if (grownups.length < 2)
    return { error: 'need at least two grown-ups -- somebody has to be the murderer' };

  const kidPool = shuffled(KID_ROLES);
  kids.forEach((p, i) => (p.role = kidPool[i % kidPool.length]));

  // The murderer is always dealt to a grown-up. That is the whole age rule.
  const grownPool = shuffled(SECRET_ROLES.slice(1)); // everything but the murderer
  const cast = [SECRET_ROLES[0], ...grownPool].slice(0, grownups.length);
  shuffled(cast).forEach((role, i) => (grownups[i].role = role));

  room.dealt = true;
  return { ok: true };
}

// ─── The choke point ─────────────────────────────────────────────────────────
//
// Every byte a client receives about roles comes from here. A caller identifies itself
// with a token; anything not addressed to that token is never assembled, not filtered
// out later. Nothing else in this file serialises a `role`.

function viewFor(room, token) {
  const me = room.players.find((p) => p.token === token) ?? null;
  const isHost = token === room.hostToken;

  return {
    code: room.code,
    dealt: room.dealt,
    isHost,
    // Whether this token belongs to somebody at the table. The client needs to know
    // before roles exist, so it cannot infer it from `me` alone.
    seated: me !== null,
    // The roster is public: names, and who is playing as a kid. Never roles.
    roster: room.players.map((p) => ({ name: p.name, young: p.young, ready: p.role !== null })),
    // Your own card, and only if you are a seated player who has been dealt one.
    me:
      me === null || me.role === null
        ? null
        : { name: me.name, role: me.role.name, card: me.role.card, secret: me.role.secret },
  };
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(json);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/' || path.startsWith('/r/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }

  // POST /api/rooms -- the host, before anyone has arrived
  if (path === '/api/rooms' && req.method === 'POST') {
    const body = await readBody(req);
    const code = makeCode();
    // SURPRISE 1, worked around: the host is a player too, so one token has to carry both
    // capabilities -- authority to deal, and a seat that gets dealt to. Splitting them
    // made the host a game master who sits out their own dinner.
    const token = randomUUID();
    const name =
      String(body.name ?? '')
        .trim()
        .slice(0, 24) || 'The Host';
    const room = { code, hostToken: token, dealt: false, players: [] };
    room.players.push({ id: randomUUID(), token, name, young: body.young === true, role: null });
    rooms.set(code, room);
    send(res, 200, { code, token });
    return;
  }

  const match = /^\/api\/rooms\/([A-Z]{4})\/(join|deal|view)$/.exec(path);
  if (match === null) {
    send(res, 404, { error: 'not found' });
    return;
  }
  const [, code, action] = match;
  const room = rooms.get(code);
  if (room === undefined) {
    send(res, 404, { error: 'no such room' });
    return;
  }

  if (action === 'join' && req.method === 'POST') {
    if (room.dealt) {
      send(res, 409, { error: 'roles are already out' });
      return;
    }
    const body = await readBody(req);
    const name = String(body.name ?? '')
      .trim()
      .slice(0, 24);
    if (name === '') {
      send(res, 400, { error: 'need a name' });
      return;
    }
    const player = {
      id: randomUUID(),
      token: randomUUID(),
      name,
      young: body.young === true,
      role: null,
    };
    room.players.push(player);
    send(res, 200, { token: player.token, view: viewFor(room, player.token) });
    return;
  }

  if (action === 'deal' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.token !== room.hostToken) {
      send(res, 403, { error: 'only the host deals' });
      return;
    }
    if (room.dealt) {
      send(res, 409, { error: 'already dealt' });
      return;
    }
    const result = deal(room);
    if (result.error) {
      send(res, 400, result);
      return;
    }
    send(res, 200, viewFor(room, body.token));
    return;
  }

  if (action === 'view' && req.method === 'GET') {
    send(res, 200, viewFor(room, url.searchParams.get('token') ?? ''));
    return;
  }

  send(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, () => console.log(`dinner party prototype on http://localhost:${PORT}`));
