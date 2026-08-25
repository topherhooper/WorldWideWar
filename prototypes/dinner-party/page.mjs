// PROTOTYPE. The whole client, as one string. Notebook code -- see server.mjs.
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dinner Party</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font:16px/1.5 system-ui,sans-serif; background:#14110f; color:#f3ece4;
         display:flex; justify-content:center; }
  main { width:min(420px,100vw); padding:24px 20px 64px; }
  h1 { font-size:22px; margin:0 0 4px; letter-spacing:.02em; }
  p.sub { margin:0 0 24px; color:#a2968a; font-size:14px; }
  button { font:inherit; padding:12px 16px; border-radius:10px; border:0; width:100%;
           background:#c8613a; color:#fff; margin-top:10px; cursor:pointer; }
  button.ghost { background:#2a2320; color:#f3ece4; }
  button:disabled { opacity:.45; cursor:default; }
  input[type=text] { font:inherit; padding:12px; width:100%; box-sizing:border-box;
    border-radius:10px; border:1px solid #3a312c; background:#1d1815; color:inherit; }
  label.check { display:flex; gap:10px; align-items:center; margin:14px 0; font-size:15px; }
  .code { font-size:44px; letter-spacing:.22em; font-weight:700; text-align:center;
          margin:18px 0 4px; }
  ul { list-style:none; padding:0; margin:16px 0; }
  li { padding:10px 12px; background:#1d1815; border-radius:8px; margin-bottom:6px;
       display:flex; justify-content:space-between; }
  .kid { color:#8fb98f; font-size:13px; }
  .card { border-radius:14px; padding:22px; margin-top:20px; }
  .card.secret { background:#3a1c1c; border:1px solid #6b2f2f; }
  .card.public { background:#1c2f22; border:1px solid #2f6b45; }
  .card h2 { margin:0 0 10px; font-size:26px; }
  .banner { font-size:13px; text-transform:uppercase; letter-spacing:.12em; color:#c9a; }
  .err { color:#e88; font-size:14px; margin-top:10px; }
</style>
</head>
<body><main id="app"></main>
<script>
const app = document.getElementById('app');
let token = sessionStorage.getItem('tok') || '';
let code = location.pathname.startsWith('/r/') ? location.pathname.slice(3).toUpperCase() : (sessionStorage.getItem('code') || '');
let err = '';

const api = async (path, opts) => {
  const r = await fetch(path, opts);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || 'something broke');
  return body;
};

async function host(name) {
  const r = await api('/api/rooms', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  code = r.code; token = r.token;
  sessionStorage.setItem('tok', token); sessionStorage.setItem('code', code);
  tick();
}

async function join(name, young) {
  const r = await api('/api/rooms/' + code + '/join', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, young }),
  });
  token = r.token;
  sessionStorage.setItem('tok', token); sessionStorage.setItem('code', code);
  render(r.view);
}

const deal = () => api('/api/rooms/' + code + '/deal', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token }),
});

function landing() {
  app.innerHTML = \`<h1>Dinner Party</h1><p class="sub">A murder over pudding.</p>
    <input type="text" id="hn" placeholder="Your name" />
    <button id="h">I'm hosting</button>
    <p class="sub" style="margin:22px 0 8px">or type the code the host read out</p>
    <input type="text" id="c" maxlength="4" placeholder="ABCD" style="text-transform:uppercase" />
    <button class="ghost" id="j">Join</button>\`;
  document.getElementById('h').onclick = () => host(document.getElementById('hn').value);
  document.getElementById('j').onclick = () => {
    code = document.getElementById('c').value.toUpperCase();
    if (code.length === 4) { sessionStorage.setItem('code', code); tick(); }
  };
}

function nameForm() {
  app.innerHTML = \`<h1>Room \${code}</h1><p class="sub">Who's at the table?</p>
    <input type="text" id="n" placeholder="Your name" />
    <label class="check"><input type="checkbox" id="y" /> I'm a little kid</label>
    <button id="go">I'm in</button><div class="err" id="e">\${err}</div>\`;
  document.getElementById('go').onclick = () => {
    const n = document.getElementById('n').value;
    join(n, document.getElementById('y').checked).catch((x) => { err = x.message; nameForm(); });
  };
}

function render(v) {
  if (v.me) {
    const kind = v.me.secret ? 'secret' : 'public';
    app.innerHTML = \`<h1>\${v.me.name}</h1>
      <p class="sub">\${v.me.secret ? 'Nobody else can see this. Not even the host.' : 'You can show this to anyone.'}</p>
      <div class="card \${kind}">
        <div class="banner">\${v.me.secret ? 'your secret' : 'your job'}</div>
        <h2>\${v.me.role}</h2><div>\${v.me.card}</div>
      </div>\`;
    return;
  }
  const seats = v.roster.map((p) =>
    \`<li><span>\${p.name}</span>\${p.young ? '<span class="kid">little kid</span>' : ''}</li>\`).join('');
  app.innerHTML = \`<h1>\${v.isHost ? 'You are hosting' : 'Waiting for the host'}</h1>
    <p class="sub">\${v.isHost ? 'Read this out loud:' : 'Room'}</p>
    <div class="code">\${v.code}</div>
    <ul>\${seats || '<li><span class="kid">nobody yet</span></li>'}</ul>
    \${v.isHost ? '<button id="d">Deal the roles</button><div class="err" id="e">' + err + '</div>' : ''}\`;
  const d = document.getElementById('d');
  if (d) d.onclick = () => { err = ''; deal().then(render).catch((x) => { err = x.message; tick(); }); };
}

async function tick() {
  if (!code) return landing();
  let v;
  try { v = await api('/api/rooms/' + code + '/view?token=' + encodeURIComponent(token)); }
  catch { sessionStorage.clear(); code = ''; token = ''; return landing(); }
  if (!v.isHost && !v.seated) return nameForm();
  render(v);
}

tick();
setInterval(() => { if (code) tick(); }, 1500);
</script></body></html>`;
