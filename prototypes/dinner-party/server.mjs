// PROTOTYPE. Notebook code for ideas/dinner-party-murder-mystery.md -- expected to be
// thrown away. In-memory, no deps, no persistence, no auth worth the name.
//
//   node prototypes/dinner-party/server.mjs      # then open http://localhost:8787
//
// Two games in one room (decision 6). The grown-ups assemble the tale from clues; the
// children hold clues that are sealed until a grown-up plays pretend with them. Neither
// half can finish alone.
//
// The one thing here that is trying to be right is `viewFor` -- the single function a
// secret can pass through on its way to a client, the way `packages/engine/src/redact.ts`
// is the single exit for game state.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
import { buildTale } from './tale.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_PLAYERS = 20;

/** code -> room */
const rooms = new Map();

function makeCode() {
  const alphabet = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels, no I/O/0/1 -- read aloud at a table
  let code = '';
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return rooms.has(code) ? makeCode() : code;
}

function newPlayer(name, young, allyName) {
  return {
    id: randomUUID(),
    token: randomUUID(),
    name,
    young,
    allyName: allyName || null,
    part: null,
    costume: null,
    clue: null,
    favour: null,
    /** ids of players whose sealed clue this player has unlocked. */
    unsealed: [],
    /** names of grown-ups who have played pretend with this child. */
    curtsies: [],
    accusedName: null,
    correct: null,
  };
}

const byName = (room, name) =>
  room.players.find((p) => p.name.toLowerCase() === String(name ?? '').toLowerCase()) ?? null;

/** Pairs are mutual: a child names their grown-up, and the link points both ways. */
function allyOf(room, player) {
  if (player.allyName) return byName(room, player.allyName);
  return (
    room.players.find(
      (p) => p.allyName && p.allyName.toLowerCase() === player.name.toLowerCase(),
    ) ?? null
  );
}

// ─── The choke point ─────────────────────────────────────────────────────────
//
// Every byte a client receives about parts, clues and the culprit comes from here. A
// caller identifies itself with a token; anything not addressed to that token is never
// assembled, not filtered out afterwards.

function viewFor(room, token) {
  const me = room.players.find((p) => p.token === token) ?? null;
  const isHost = token === room.hostToken;

  const base = {
    code: room.code,
    dealt: room.dealt,
    over: room.over,
    isHost,
    seated: me !== null,
    tale: room.tale === null ? null : { title: room.tale.title, prompt: room.tale.prompt },
    // Costumes are public on purpose: the puzzle is the culprit's costume, so the guests
    // have to be readable or there is nothing to deduce.
    roster: room.players.map((p) => ({
      name: p.name,
      young: p.young,
      part: p.part,
      costume: p.costume,
      // How many grown-ups have knelt to this child. The child's whole scoreboard.
      curtsies: p.young ? p.curtsies.length : null,
    })),
  };

  if (me === null) return { ...base, me: null };

  const ally = allyOf(room, me);
  const sealed = room.players
    .filter((p) => p.young && p.clue !== null && p !== me)
    .map((p) => ({
      holder: p.name,
      part: p.part,
      favour: p.favour.grown,
      open: me.unsealed.includes(p.id),
      clue: me.unsealed.includes(p.id) ? p.clue.text : null,
    }));

  return {
    ...base,
    me: {
      name: me.name,
      young: me.young,
      part: me.part,
      costume: me.costume,
      clue: me.clue === null ? null : me.clue.text,
      favour: me.favour === null ? null : me.favour.kid,
      curtsies: me.curtsies,
      // Your ally, and only yours. The rest of the table is not told you are a pair.
      ally: ally === null ? null : { name: ally.name, part: ally.part },
      sealed,
      accusedName: me.accusedName,
      correct: me.correct,
    },
    // Revealed to everyone only once the game is over.
    culprit: room.over ? room.players.find((p) => p.id === room.tale.culpritId).name : null,
  };
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
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

const cleanName = (raw) =>
  String(raw ?? '')
    .trim()
    .slice(0, 24);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/' || path.startsWith('/r/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }

  if (path === '/api/rooms' && req.method === 'POST') {
    const body = await readBody(req);
    const code = makeCode();
    // The host is a player too, so one token carries both capabilities: authority to
    // deal, and a seat to be dealt to.
    const player = newPlayer(cleanName(body.name) || 'The Host', body.young === true, null);
    const room = {
      code,
      hostToken: player.token,
      dealt: false,
      over: false,
      tale: null,
      players: [player],
    };
    rooms.set(code, room);
    send(res, 200, { code, token: player.token });
    return;
  }

  const match = /^\/api\/rooms\/([A-Z]{4})\/(join|deal|view|unseal|accuse)$/.exec(path);
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

  if (action === 'view' && req.method === 'GET') {
    send(res, 200, viewFor(room, url.searchParams.get('token') ?? ''));
    return;
  }

  const body = await readBody(req);

  if (action === 'join' && req.method === 'POST') {
    if (room.dealt) return send(res, 409, { error: 'the christening has already begun' });
    if (room.players.length >= MAX_PLAYERS)
      return send(res, 409, { error: `${MAX_PLAYERS} guests is a full hall` });
    const name = cleanName(body.name);
    if (name === '') return send(res, 400, { error: 'need a name' });
    if (byName(room, name) !== null)
      return send(res, 409, { error: 'somebody here is already called that' });
    const player = newPlayer(name, body.young === true, cleanName(body.allyName));
    room.players.push(player);
    send(res, 200, { token: player.token, view: viewFor(room, player.token) });
    return;
  }

  const me = room.players.find((p) => p.token === body.token) ?? null;

  if (action === 'deal' && req.method === 'POST') {
    if (body.token !== room.hostToken) return send(res, 403, { error: 'only the host deals' });
    if (room.dealt) return send(res, 409, { error: 'already dealt' });
    const grownups = room.players.filter((p) => !p.young).length;
    if (grownups < 2)
      return send(res, 400, { error: 'need at least two grown-ups -- one of them did it' });
    room.tale = buildTale(room.players);
    room.dealt = true;
    send(res, 200, viewFor(room, body.token));
    return;
  }

  if (action === 'unseal' && req.method === 'POST') {
    if (me === null) return send(res, 403, { error: 'not at this party' });
    if (!room.dealt) return send(res, 409, { error: 'nothing dealt yet' });
    const child = byName(room, body.holder);
    if (child === null || !child.young) return send(res, 404, { error: 'no such child' });
    if (!me.unsealed.includes(child.id)) me.unsealed.push(child.id);
    // The child's scoreboard: the grown-ups who played along.
    if (!child.curtsies.includes(me.name)) child.curtsies.push(me.name);
    send(res, 200, viewFor(room, body.token));
    return;
  }

  if (action === 'accuse' && req.method === 'POST') {
    if (me === null) return send(res, 403, { error: 'not at this party' });
    if (!room.dealt) return send(res, 409, { error: 'nothing dealt yet' });
    if (me.accusedName !== null)
      return send(res, 409, { error: 'you have already accused someone' });
    const suspect = byName(room, body.suspect);
    if (suspect === null) return send(res, 404, { error: 'nobody here by that name' });
    me.accusedName = suspect.name;
    me.correct = suspect.id === room.tale.culpritId;
    // One correct accusation ends the christening.
    if (me.correct) room.over = true;
    send(res, 200, viewFor(room, body.token));
    return;
  }

  send(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, () => console.log(`dinner party prototype on http://localhost:${PORT}`));
