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
import { buildTale, makeLie } from './tale.mjs';

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
    favour: null,
    /** Pieces of the puzzle this player holds. Never attributed -- you are not told who
     *  a piece came from, only that you got one. */
    pieces: [],
    /** Names this player has confirmably met. Public: the encounter log is the evidence. */
    met: [],
    /** Encounters claimed against this player, awaiting their confirmation.
     *  { from, lie } -- `lie` is the curser's, and never leaves the server. */
    claims: [],
    /** Grown-ups who have played pretend with this child, confirmed by their grown-up. */
    curtsies: [],
    /** Falsehoods this player may still plant. Only ever non-zero for the curser. */
    lies: 0,
    /** Banished players keep playing -- they mingle, collect and argue. They just have
     *  one vote left between here and the end, and cannot be nominated again. */
    banished: false,
    lastVoteSpent: false,
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

/**
 * Vote weight. A grown-up carries one voice, plus one for every grown-up who has knelt
 * to a child of theirs, capped so a popular five-year-old is decisive but not a dictator.
 * This is where the two games meet: playing pretend well is what wins the argument.
 */
const CROWN_CAP = 3;
function weightOf(room, player) {
  const crowns = room.players
    .filter((p) => p.young && allyOf(room, p) === player)
    .reduce((n, child) => n + child.curtsies.length, 0);
  return 1 + Math.min(crowns, CROWN_CAP);
}

/** Grown-ups vote. A banished one has a single voice left for the rest of the night. */
const canVote = (p) => !p.young && !(p.banished && p.lastVoteSpent);

/** The clock is lazy: nothing ticks, but every request notices what time it is. */
function advanceClock(room, now) {
  if (room.phase === 'mingle' && now >= room.endsAt) {
    room.phase = 'vote';
    room.nomination = null;
  }
}

function beginRound(room, now) {
  room.round += 1;
  room.phase = 'mingle';
  room.endsAt = now + room.roundMinutes * 60_000;
  room.nomination = null;
}

/** Settle the nomination on the floor: banish, or let them off. */
function settleVote(room, now) {
  const nom = room.nomination;
  // Who was already a ghost when this vote was cast. Somebody banished *by* this vote
  // was alive when they spoke, so it does not cost them their last voice.
  const wereGhosts = new Set(room.players.filter((p) => p.banished).map((p) => p.name));
  const suspect = room.players.find((p) => p.name === nom.suspect);
  const yes = Object.entries(nom.votes)
    .filter(([, v]) => v.yes)
    .reduce((n, [, v]) => n + v.weight, 0);
  const total = room.players.filter(canVote).reduce((n, p) => n + weightOf(room, p), 0);
  nom.tally = { yes, total, carried: yes * 2 > total };

  if (nom.tally.carried) {
    suspect.banished = true;
    room.banished.push(suspect.name);
    // Banishment does not remove anybody. It spends their voice.
    for (const name of Object.keys(nom.votes)) {
      if (wereGhosts.has(name)) room.players.find((p) => p.name === name).lastVoteSpent = true;
    }
    if (suspect.id === room.tale.culpritId) {
      room.over = true;
      room.phase = 'over';
      room.outcome = 'the christening is saved';
      return;
    }
  }
  beginRound(room, now);
}

/** A child never confirms anything themselves -- their grown-up answers for them. */
function signerFor(room, player) {
  return player.young ? allyOf(room, player) : player;
}

/** Deal one piece the receiver does not already hold. Attribution is never recorded. */
function dealPiece(room, to, lie) {
  if (lie) {
    to.pieces.push({ id: -1, text: lie, fake: true });
    return;
  }
  const held = new Set(to.pieces.map((p) => p.text));
  const fresh = room.tale.deck.filter((c) => !held.has(c.text));
  if (fresh.length === 0) return;
  to.pieces.push({ ...fresh[Math.floor(Math.random() * fresh.length)] });
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
    phase: room.phase,
    round: room.round,
    // Milliseconds left in this round, so the client can count down without a clock of its own.
    msLeft: room.phase === 'mingle' ? Math.max(0, room.endsAt - Date.now()) : 0,
    banished: room.banished,
    outcome: room.outcome,
    lastResult: room.lastResult ?? null,
    nomination:
      room.nomination === null
        ? null
        : {
            suspect: room.nomination.suspect,
            by: room.nomination.by,
            cast: Object.keys(room.nomination.votes).length,
            waitingOn: room.players
              .filter((p) => canVote(p) && !(p.name in room.nomination.votes))
              .map((p) => p.name),
            tally: room.nomination.tally ?? null,
          },
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
      banished: p.banished,
      weight: p.young ? null : weightOf(room, p),
    })),
  };

  if (me === null) return { ...base, me: null };

  const ally = allyOf(room, me);
  const myChildren = room.players.filter((p) => p.young && allyOf(room, p) === me);

  // Everything waiting on this player's word: encounters claimed against them, plus
  // encounters claimed against any child they are the grown-up for.
  const toConfirm = [me, ...myChildren].flatMap((who) =>
    who.claims.map((c) => ({
      claimant: c.from,
      about: who.name,
      isChild: who.young,
      favour: who.young && who.favour !== null ? who.favour.grown : null,
    })),
  );

  // Who you may still go and meet: everyone but yourself, your own children, and
  // anyone you have already met or already claimed.
  const claimedByMe = new Set(
    room.players.flatMap((p) => p.claims.filter((c) => c.from === me.name).map(() => p.name)),
  );
  const canMeet = (room.dealt ? room.players : [])
    .filter((p) => p !== me && !myChildren.includes(p))
    .map((p) => ({
      name: p.name,
      part: p.part,
      young: p.young,
      state: me.met.includes(p.name) ? 'met' : claimedByMe.has(p.name) ? 'pending' : 'open',
      // Meeting a child costs a favour; meeting a grown-up costs nothing but the walk.
      favour: p.young && p.favour !== null ? p.favour.grown : null,
      signer: signerFor(room, p)?.name ?? null,
    }));

  return {
    ...base,
    me: {
      name: me.name,
      young: me.young,
      part: me.part,
      costume: me.costume,
      favour: me.favour === null ? null : me.favour.kid,
      // Your pieces, unattributed and unlabelled. Nothing here says which are true.
      pieces: me.pieces.map((p) => p.text),
      met: me.met,
      curtsies: me.curtsies,
      ally: ally === null ? null : { name: ally.name, part: ally.part },
      canMeet,
      toConfirm,
      mine: myChildren.map((c) => ({ name: c.name, part: c.part, crowns: c.curtsies.length })),
      // Only the curser is ever told they may lie, and only about their own budget.
      lies: me.lies,
      banished: me.banished,
      weight: weightOf(room, me),
      canVote: canVote(me),
      voted: room.nomination === null ? null : (room.nomination.votes[me.name]?.yes ?? null),
      // Anyone still un-banished may be put on the floor. Children never can.
      nominable: room.players.filter((p) => !p.young && !p.banished).map((p) => p.name),
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
      phase: 'lobby',
      round: 0,
      roundMinutes: Number(body.roundMinutes) > 0 ? Number(body.roundMinutes) : 5,
      endsAt: 0,
      nomination: null,
      banished: [],
      lastResult: null,
      outcome: null,
    };
    rooms.set(code, room);
    send(res, 200, { code, token: player.token });
    return;
  }

  const match =
    /^\/api\/rooms\/([A-Z]{4})\/(join|deal|view|meet|confirm|deny|bell|nominate|vote)$/.exec(path);
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

  advanceClock(room, Date.now());

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
    const young = body.young === true;
    const allyName = cleanName(body.allyName);
    // Every child has a grown-up, because the grown-up is who reports their favours.
    if (young) {
      if (allyName === '')
        return send(res, 400, { error: 'a little kid needs a grown-up with them' });
      const ally = byName(room, allyName);
      if (ally === null) return send(res, 404, { error: `nobody here is called ${allyName}` });
      if (ally.young)
        return send(res, 400, { error: `${ally.name} is a kid too -- name a grown-up` });
    }
    const player = newPlayer(name, young, young ? allyName : '');
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
    room.players.forEach((p) => (p.lies = p.id === room.tale.culpritId ? room.tale.lies : 0));
    room.dealt = true;
    beginRound(room, Date.now());
    send(res, 200, viewFor(room, body.token));
    return;
  }

  // You say you met someone. It counts for nothing until they say so too -- and if they
  // are a child, their grown-up says it for them. The curser may ride a falsehood in on
  // the encounter; nobody but the server ever knows which piece was the lie.
  if (action === 'meet' && req.method === 'POST') {
    if (me === null) return send(res, 403, { error: 'not at this party' });
    if (!room.dealt) return send(res, 409, { error: 'nothing dealt yet' });
    if (room.over) return send(res, 409, { error: 'the christening is over' });
    if (room.phase !== 'mingle')
      return send(res, 409, { error: 'the bell has rung -- the hall is voting' });
    const them = byName(room, body.who);
    if (them === null) return send(res, 404, { error: 'nobody here by that name' });
    if (them === me) return send(res, 400, { error: 'you cannot meet yourself' });
    if (them.young && allyOf(room, them) === me) {
      return send(res, 409, { error: 'that is your own child -- you are already a team' });
    }
    if (me.met.includes(them.name))
      return send(res, 409, { error: `you have already met ${them.name}` });
    if (them.claims.some((c) => c.from === me.name))
      return send(res, 409, { error: 'already waiting on them' });

    const wantsLie = body.lie === true;
    if (wantsLie && me.lies <= 0) return send(res, 403, { error: 'you have no falsehoods left' });
    if (wantsLie) me.lies -= 1;
    them.claims.push({ from: me.name, lie: wantsLie ? makeLie(me, room.players) : null });
    return send(res, 200, viewFor(room, body.token));
  }

  if ((action === 'confirm' || action === 'deny') && req.method === 'POST') {
    if (me === null) return send(res, 403, { error: 'not at this party' });
    const about = byName(room, body.about);
    if (about === null) return send(res, 404, { error: 'nobody here by that name' });
    const signer = signerFor(room, about);
    if (signer !== me) {
      return send(res, 403, {
        error:
          signer === null
            ? 'nobody can answer for them'
            : `only ${signer.name} can answer for ${about.name}`,
      });
    }
    const claim = about.claims.find((c) => c.from === body.claimant);
    if (claim === undefined) return send(res, 404, { error: 'no such claim' });
    about.claims = about.claims.filter((c) => c !== claim);

    if (action === 'deny') return send(res, 200, viewFor(room, body.token));

    const claimant = byName(room, claim.from);
    if (!about.met.includes(claimant.name)) about.met.push(claimant.name);
    if (!claimant.met.includes(about.name)) claimant.met.push(about.name);
    // The encounter pays both sides a piece. The claimant's may be a falsehood.
    dealPiece(room, claimant, null);
    dealPiece(room, about, claim.lie);
    if (about.young && !about.curtsies.includes(claimant.name)) about.curtsies.push(claimant.name);
    return send(res, 200, viewFor(room, body.token));
  }

  // The host may ring the bell early rather than waiting out the round.
  if (action === 'bell' && req.method === 'POST') {
    if (body.token !== room.hostToken)
      return send(res, 403, { error: 'only the host rings the bell' });
    if (room.phase !== 'mingle') return send(res, 409, { error: 'the bell has already rung' });
    room.phase = 'vote';
    room.nomination = null;
    return send(res, 200, viewFor(room, body.token));
  }

  if (action === 'nominate' && req.method === 'POST') {
    if (me === null) return send(res, 403, { error: 'not at this party' });
    if (room.phase !== 'vote') return send(res, 409, { error: 'nobody is voting yet' });
    if (room.nomination !== null)
      return send(res, 409, { error: 'somebody is already on the floor' });
    if (me.young) return send(res, 403, { error: 'a grown-up has to say it out loud' });
    const suspect = byName(room, body.suspect);
    if (suspect === null) return send(res, 404, { error: 'nobody here by that name' });
    if (suspect.young) return send(res, 400, { error: 'no child laid that curse' });
    if (suspect.banished)
      return send(res, 409, { error: `${suspect.name} has already been banished` });
    room.nomination = { suspect: suspect.name, by: me.name, votes: {}, tally: null };
    room.lastResult = null;
    return send(res, 200, viewFor(room, body.token));
  }

  if (action === 'vote' && req.method === 'POST') {
    if (me === null) return send(res, 403, { error: 'not at this party' });
    if (room.phase !== 'vote' || room.nomination === null)
      return send(res, 409, { error: 'nothing on the floor' });
    if (!canVote(me)) {
      return send(res, 403, {
        error: me.young ? 'your grown-up carries your voice' : 'you have spent your last voice',
      });
    }
    if (me.name in room.nomination.votes)
      return send(res, 409, { error: 'you have already spoken' });
    room.nomination.votes[me.name] = { yes: body.yes === true, weight: weightOf(room, me) };
    // Everyone who still has a voice has used it: settle.
    if (room.players.filter(canVote).every((p) => p.name in room.nomination.votes)) {
      const nom = room.nomination;
      settleVote(room, Date.now());
      // settleVote writes the tally onto the nomination it settled, and then clears the
      // floor -- so keep the reference, not a copy, or the result reads back empty.
      room.lastResult = { suspect: nom.suspect, by: nom.by, tally: nom.tally };
    }
    return send(res, 200, viewFor(room, body.token));
  }

  send(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, () => console.log(`dinner party prototype on http://localhost:${PORT}`));
