# Build plan: the push channel (scheduler phase 1)

A handoff plan for `tasks/web-push-reaches-a-phone.md`, written so a cheaper model can execute
it without the brainstorm in its context. The why lives in
[group-scheduler.md](group-scheduler.md); this file is only the how. When the task resolves,
the PR that deletes the task deletes this file too — a step list that outlives its work is a
stale one.

## The goal, in one paragraph

A push notification sent through the server's existing `notify()` arrives on a real iPhone
that has added the site to its home screen, and on a real Android phone. Nothing about polls is
built here. The push channel is general: once it exists, the game's turn reminders and "turn
resolved" messages arrive as pushes as well as email, gated by the same per-kind preferences.

## Settled before building

Questions asked and answered on PR #44 before this plan was executed; the rest of the file
already reflects them.

- **Game pushes are wanted now.** `turnResolved`, `gameOver` and `reminder` all leave through
  the two `notify()` call sites in step 2, so no further code is needed. They go out as pushes
  under the same per-kind switches as email, live at the next relight.
- **Both phones, both must work.** An iPhone on iOS 16.4 or later and an Android phone are
  available, and "done when" stays as the task states it: the push arrives on both.
- **If Android works and the iPhone does not**, hold the phase 1 PR unmerged until Q2 in
  [group-scheduler.md](group-scheduler.md) is decided. A channel that only reaches Android
  is a result, not a deliverable.
- **Icons** are the generated solid-colour squares of step 5. A real icon is a later job.

## Rules for the executor

- Read `CLAUDE.md` first. Its invariants and its "Before you push" gate apply in full.
- Branch from `origin/main` as `web/push-channel`. Commit after each numbered step below with a conventional commit
  scoped by package: `feat(server): …`, `feat(web): …`, `test(server): …`, `chore(deploy): …`.
  Push after every commit, and open a draft PR after the first push.
- **Stop at the second surprise.** Work around the first unexpected blocker and write it down
  in the PR body; the second one ends the run with a written account of where it stopped.
- Do not widen scope: no poll code, no scheduler UI, no refactors of code this plan does not
  name, no new dependencies beyond what is listed here.
- Everything marked **[human]** needs Topher: console clicks, credentials, a physical phone.
  Do everything else first, then hand back the [human] list in the PR body as a checklist of
  exact values and commands, rather than guessing at them.
- Invalid input degrades, never throws: a push failure must never fail the request or the tick
  that triggered it, exactly like `resendMailer` in `packages/server/src/mailer.ts:25`.
- Stored documents predate the change: every reader of the new user-doc field must tolerate
  its absence (`?? []`).

## How it fits together

Firebase Cloud Messaging (FCM) is the transport, because the project already runs on Firebase
and FCM is free. The browser subscribes through our **own** service worker at `/sw.js` rather
than Firebase's `firebase-messaging-sw.js`, because a file in `public/` is not processed by
Vite and so cannot read the `VITE_*` config; our worker needs no config at all. It receives the
push, shows the notification (iOS requires one for every push — there is no silent push), and
opens a link when tapped. The page registers the worker, asks permission from a button press,
gets an FCM token with `getToken(..., { serviceWorkerRegistration })`, and sends the token to
the server, which stores it on the user doc. `notify()` then sends each message to every token
of every opted-in recipient, and prunes tokens FCM reports as dead.

## Step 1 — server: a `Pusher` beside the `Mailer`

New file `packages/server/src/pusher.ts`, modelled on `mailer.ts`:

```ts
import { getMessaging } from 'firebase-admin/messaging';

export interface PushMessage {
  title: string;
  body: string;
  /** Absolute URL opened when the notification is tapped. */
  link: string;
}

export interface Pusher {
  /** Never throws. Returns the tokens FCM says are gone, so the caller can prune them. */
  send(tokens: string[], msg: PushMessage): Promise<{ deadTokens: string[] }>;
}

export class LogPusher implements Pusher {
  sent: { tokens: string[]; msg: PushMessage }[] = [];
  /** Tests set this to simulate FCM reporting tokens as unregistered. */
  dead = new Set<string>();
  async send(tokens: string[], msg: PushMessage) {
    /* record, log, return dead ∩ tokens */
  }
}

export function fcmPusher(): Pusher {
  // getMessaging().sendEachForMulticast({ tokens, webpush: { notification: { title, body,
  //   icon: '/icon-192.png' }, data: { link }, fcmOptions: { link } } })
  // Dead = responses whose error.code is 'messaging/registration-token-not-registered'
  //   or 'messaging/invalid-registration-token'. Any other error: console.error, not dead.
  // Wrap the whole call in try/catch; on throw, log and return { deadTokens: [] }.
  // sendEachForMulticast accepts at most 500 tokens; slice if ever needed (it won't be).
}
```

Put `link` in `data` as well as `fcmOptions`: our own worker reads it from `data`, because the
`fcmOptions` field is only honoured by Firebase's worker.

## Step 2 — server: tokens on the user doc, and `notify()` sends pushes

- `packages/server/src/store.ts:34` `UserDoc`: add `pushTokens?: string[]` with a one-line
  comment that absence means no devices.
- `packages/server/src/notify.ts`:
  - `NotifyDeps` gains `pusher?: Pusher` — **optional**, so the many existing test literals and
    `testDeps` keep compiling; absent means email only.
  - `notify()`'s `mail` argument gains an optional `link?: string`.
  - Inside the existing loop, after the prefs check and the email send, if `deps.pusher` is set
    and the recipient's snapshot has a non-empty `pushTokens`, send
    `{ title: mail.subject, body: firstParagraph(mail.text), link: mail.link ?? deps.baseUrl }`
    where `firstParagraph` takes text up to the first blank line, trimmed, capped at 180
    characters. Strip any leading bracketed tag such as `[WWW] ` from the title (regex
    `^\[[^\]]*\]\s*`) — it exists for inbox filters and is noise on a lock screen; the
    scheduler's emails will use `[Quorum] ` the same way.
  - Prune: if `deadTokens` is non-empty, `usersCol(db).doc(uid).update({ pushTokens:
FieldValue.arrayRemove(...deadTokens) })`, inside a try/catch that only logs.
  - Update the doc comment above `notify()` ("The one door mail leaves by") to say pushes leave
    by the same door and the same preferences gate both.
- The two call sites pass a link: `packages/server/src/tick.ts:151` and
  `packages/server/src/resolve.ts:140` both add `link: \`${deps.baseUrl}/g/${gameId}\``.
- `packages/server/src/app.ts:62` `AppDeps` gains `pusher?: Pusher`, and `buildApp` copies it
  into `notifyDeps` at `app.ts:83`.
- `packages/server/src/main.ts`: `const pusher = process.env.PUSH_TRANSPORT === 'fcm' ?
fcmPusher() : new LogPusher();` and pass it to `buildApp`. Locally and under the emulator
  there is no FCM, so the default must be the log transport.
- `cloudbuild.yaml`: append `,PUSH_TRANSPORT=fcm` to the `--update-env-vars` line of the
  `deploy-run` step. This only takes effect on the next production deploy; the site is
  mothballed, so nothing ships until relight.

## Step 3 — server: three routes

Inside the authenticated `app.register` block in `packages/server/src/app.ts`, beside
`/prefs`. Validate the body by hand the way `PUT /prefs` does (`app.ts:193`): `token` must be a
non-empty string of at most 4096 characters, else `HttpError(400, 'bad push token')`.

- `POST /push/register` `{ token }` → `usersCol(db).doc(uid).set({ pushTokens:
FieldValue.arrayUnion(token) }, { merge: true })`; returns `{ ok: true }`. Idempotent.
- `POST /push/unregister` `{ token }` → `arrayRemove`; returns `{ ok: true }`. POST rather than
  DELETE-with-body, to avoid any proxy that drops DELETE bodies.
- `POST /push/test` → read the caller's `pushTokens ?? []`; if empty, `HttpError(409, 'no
devices registered')`; else call `deps.pusher.send` directly (deliberately **not** through
  `notify()`, since the person just asked for it and a preference must not swallow a test) with
  `{ title: 'Notifications are on', body: 'This is what a nudge will look like.', link:
\`${deps.baseUrl}/settings\` }`, prune dead tokens, and return `{ sent: tokens.length -
  deadTokens.length }`. If `deps.pusher`is absent, treat it as`new LogPusher()`.

Add the request/response types to `packages/server/src/api-types.ts` (`PushTokenRequest`,
`PushTestResponse`) and the client calls to `packages/web/src/api.ts`: `registerPush`,
`unregisterPush`, `testPush`.

## Step 4 — server tests

Both need the emulator (`pnpm test:server`); Java is present in the cloud sandbox.

- `packages/server/src/notify.test.ts`, new cases using a `LogPusher` in `deps`: pushes go to
  every token of an opted-in recipient; nothing is pushed to a recipient who turned that kind
  off; a recipient with no `pushTokens` field still gets email and no push; tokens the pusher
  reports dead are removed from the user doc; with no `pusher` in deps, behaviour is exactly as
  before; a leading `[WWW] ` tag is stripped from the push title.
- Route tests in the existing route-test style (`packages/server/src/app.test.ts` with
  `stubVerifiers` from `testing.ts`): register twice stores one token; unregister removes it;
  register with `{}`, `{ token: 3 }` and a 5000-character token each return 400; test with no
  devices returns 409; test with one device returns `{ sent: 1 }` and records one push.

## Step 5 — web: installable app shell

- `packages/web/public/manifest.webmanifest`: `name` "World Wide War", `short_name` "WWW",
  `start_url` "/", `scope` "/", `display` "standalone", `background_color` and `theme_color`
  matching `styles.css`'s page background, icons `/icon-192.png` (192×192) and `/icon-512.png`
  (512×512), both `"purpose": "any"`.
- The two PNGs: generate solid-colour squares with a throwaway Node script using only
  `node:zlib` (a PNG is a signature, an IHDR chunk, one zlib-compressed IDAT of filtered rows,
  and an IEND chunk, each with a CRC32). Commit the PNGs, not the script. A real icon is a
  later, human job; for this task, any icon that is not a screenshot will do.
- `packages/web/index.html` `<head>`: `<link rel="manifest" href="/manifest.webmanifest" />`,
  `<link rel="apple-touch-icon" href="/icon-192.png" />`, `<meta name="theme-color"
content="…" />`.
- `firebase.json`: add a `headers` entry so `/sw.js` is served with `Cache-Control: no-cache`;
  a cached worker is how a fixed bug stays unfixed on a phone for a day. Do not touch
  `firebase.paused.json`.

## Step 6 — web: the service worker

`packages/web/public/sw.js`, plain JavaScript, no imports. ESLint's flat config ignores
`eslint-env` comments, so start the file with `/* global self, clients */`. Run
`pnpm exec eslint packages/web/public/sw.js` to confirm it lints clean.

```js
/* global self, clients */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON: show defaults */
  }
  const n = payload.notification ?? {};
  const link = payload.data?.link ?? '/';
  // iOS revokes push permission from a site that receives a push without showing one,
  // so this must always show something, even for a malformed payload.
  event.waitUntil(
    self.registration.showNotification(n.title ?? 'World Wide War', {
      body: n.body ?? '',
      icon: n.icon ?? '/icon-192.png',
      data: { link },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
      return open ? open.navigate(link).then((w) => w?.focus()) : clients.openWindow(link);
    }),
  );
});
```

Register it in `packages/web/src/main.tsx` only in production builds
(`if (import.meta.env.PROD && 'serviceWorker' in navigator) void
navigator.serviceWorker.register('/sw.js');`). A worker under the Vite dev server makes stale
bundles confusing, and the emulators have no FCM anyway.

## Step 7 — web: Firebase config and `push.ts`

- `packages/web/src/auth.tsx:18` `initializeApp` (non-emulator branch) gains
  `messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID` and
  `appId: import.meta.env.VITE_FIREBASE_APP_ID`. FCM's `getToken` fails without both. Export
  the app (`export const firebaseApp = app;`) so `push.ts` does not re-initialize.
- `packages/web/.env.production` gains `VITE_FIREBASE_MESSAGING_SENDER_ID`,
  `VITE_FIREBASE_APP_ID` and `VITE_FIREBASE_VAPID_KEY`. All three are public identifiers, like
  the API key already there. The sender ID is the project number, `614936797883` (it is the
  `projects/614936797883/…` segment of the API key's resource path in `docs/deployment.md`),
  so commit it for real. **[human]** supplies the app ID and the VAPID key: commit those two
  as clearly marked placeholders (`REPLACE_ME_…`) with a comment naming where each value comes
  from, and say in the PR body that the phone test cannot start until they are filled in.

New file `packages/web/src/push.ts`:

```ts
export type PushStatus =
  | 'unsupported' // this browser cannot receive web push at all
  | 'needs-install' // iPhone/iPad Safari tab: only a home-screen app can get push
  | 'blocked' // the person (or the OS) denied permission
  | 'off' // supported, not yet enabled on this device
  | 'on'; // a token is registered with the server from this device

export async function pushStatus(): Promise<PushStatus>;
/** Must be called from a click handler: iOS only shows the prompt for a user gesture. */
export async function enablePush(): Promise<PushStatus>;
export async function disablePush(): Promise<PushStatus>;
```

- `pushStatus`: return `'unsupported'` under `VITE_USE_EMULATORS=1` or when
  `VITE_FIREBASE_VAPID_KEY` is empty. Check iOS **before** feature detection, because a Safari
  tab on an iPhone has no `PushManager` at all: if the user agent matches `/iPhone|iPad|iPod/`
  (or `navigator.maxTouchPoints > 1` with `/Macintosh/`, which is iPadOS) and the app is not
  standalone (`matchMedia('(display-mode: standalone)').matches` false and
  `navigator.standalone !== true`), return `'needs-install'`. Then `'unsupported'` if
  `!('serviceWorker' in navigator) || !('PushManager' in window) || !(await isSupported())`
  (`isSupported` from `firebase/messaging`). Then `'blocked'` if
  `Notification.permission === 'denied'`, `'on'` if `localStorage` holds a token under
  `www.pushToken`, else `'off'`.
- `enablePush`: `await Notification.requestPermission()`; if not `'granted'` return
  `pushStatus()`. Then `const reg = await navigator.serviceWorker.ready`, `const token = await
getToken(getMessaging(firebaseApp), { vapidKey, serviceWorkerRegistration: reg })`,
  `await api.registerPush(token)`, store the token in `localStorage`, return `'on'`. Wrap
  `localStorage` access in try/catch — private modes throw.
- `disablePush`: read the stored token; `deleteToken(getMessaging(firebaseApp))`;
  `api.unregisterPush(token)`; clear storage; return `pushStatus()`. Best-effort: errors in
  any one of those must not stop the others.
- In `packages/web/src/auth.tsx`'s `signOut`, call `disablePush()` first (ignoring errors), so
  a shared phone stops receiving the previous person's nudges.

## Step 8 — web: Settings section and the iPhone walkthrough

In `packages/web/src/pages/Settings.tsx`, add a section **above** the email one, titled "Phone
notifications", driven by `pushStatus()`:

- `unsupported`: "This browser can't receive notifications. On a phone, use Safari (iPhone)
  or Chrome (Android)."
- `needs-install`: a short numbered walkthrough, in this wording unless it is wrong for the
  current iOS: "1. Tap the Share button (the square with an arrow) at the bottom of Safari. 2. Scroll down and tap **Add to Home Screen**, then **Add**. 3. Open World Wide War from your
  home screen, come back to Settings, and tap **Turn on notifications**." Put it in its own
  component at `packages/web/src/InstallHelp.tsx` (not under `game/`), since the scheduler
  will reuse it.
- `off`: a button "Turn on notifications on this device" that calls `enablePush()`.
- `on`: "Notifications are on for this device", a "Send a test" button calling
  `api.testPush()` and reporting "Sent — it should arrive in a few seconds" or the error, and
  a "Turn off on this device" button.
- `blocked`: "Notifications are blocked for this site. Turn them on in your phone's settings,
  then reload."

Rename the existing heading "Email notifications" to "What to notify me about" and add one
muted line under it: "Each switch covers email and phone notifications." Keep the existing
unsubscribe sentence.

Tests in `packages/web/src/pages/Settings.test.tsx`, mocking `../push.js` the same way the file
already mocks `../api.js`: each of the five statuses renders its text; clicking the enable
button calls `enablePush`; "Send a test" calls `api.testPush`. Existing assertions that match
the old heading must be updated, not deleted. Add `packages/web/src/push.test.ts` for
`pushStatus` alone: iPhone user agent and not standalone gives `needs-install`; iPhone and
standalone does not; emulator mode gives `unsupported`.

## Step 9 — the local gate

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm test:server
pnpm exec prettier --check --end-of-line auto .
pnpm --filter @www/web build && ls packages/web/dist/{sw.js,manifest.webmanifest,icon-192.png}
```

Report the real output. If `pnpm test:server` cannot run, say so in the PR body rather than
reporting green. Then stop and write the PR body: what was built, the gate output, and the
[human] list below with every value the executor could not supply.

## Step 10 — a stable test host, without waking the mothballed site

The live site serves a paused card and must stay paused. Two pieces make a private test
possible at $0, and neither is a throwaway: a Cloud Run revision that takes **no** traffic
but has a tag URL, and a second Firebase Hosting site in the same project, served at
`test.topherhooper.com`, whose `/api/**` rewrite points at that tag. Firebase Hosting rewrites
accept a `tag` field for exactly this. A custom subdomain rather than a preview channel,
because a channel expires and takes its three sign-in allow-list entries with it, and every
later scheduler phase tests on the same host.

Commit two files the executor writes, for reuse by every later phase:

- `cloudbuild.preview.yaml`: the `build-image` and `push-image` steps of `cloudbuild.yaml`
  verbatim, then a `deploy-run` step with `gcloud run deploy www-api --image=… --region=
us-central1 --no-traffic --tag=$_TAG --update-env-vars=PUSH_TRANSPORT=fcm,BASE_URL=$_BASE_URL`.
  No hosting step. Substitutions `_TAG: preview` and `_BASE_URL: https://test.topherhooper.com`.
  Same `timeout` and `options` block as `cloudbuild.yaml`, including its comment about the
  free tier — copy it, do not reword it.
- `firebase.preview.json`: a copy of `firebase.json` whose `hosting` block adds
  `"site": "www-test"` and whose two Cloud Run rewrites add `"tag": "preview"`.

Then **[human]**, in order (the executor writes these commands into the PR body):

```bash
# 1. The second Hosting site, then its custom domain in the console (Hosting → www-test →
#    Add custom domain → test.topherhooper.com). The console shows the record to create.
pnpm exec firebase hosting:sites:create www-test --project fluted-citizen-269819

# 2. DNS, in the existing Cloud DNS zone. Hosting may ask for a TXT ownership record first;
#    create whatever the console shows. Then wait for the certificate (see the "Not Secure
#    for a few hours" note in docs/deployment.md).
gcloud dns record-sets create test.topherhooper.com. --zone topherhooper-com \
  --type CNAME --ttl 300 --rrdatas www-test.web.app. --project fluted-citizen-269819

# 3. Allow the host in all three sign-in places (the [human] list, item 4).

# 4. Build the test bundle with the test host as auth domain, so the redirect sign-in stays
#    same-origin inside the iPhone home-screen app (see the comment in
#    packages/web/.env.production), and deploy it to the test site only.
VITE_FIREBASE_AUTH_DOMAIN=test.topherhooper.com pnpm --filter @www/web build
pnpm exec firebase deploy --only hosting --config firebase.preview.json \
  --project fluted-citizen-269819

# 5. Server: a tagged, zero-traffic revision. The live revision is untouched.
gcloud builds submit --config cloudbuild.preview.yaml --project fluted-citizen-269819 \
  --service-account projects/fluted-citizen-269819/serviceAccounts/cloudbuilder@fluted-citizen-269819.iam.gserviceaccount.com \
  --gcs-source-staging-dir gs://fluted-citizen-269819_cloudbuild/gha-source \
  --substitutions COMMIT_SHA=$(git rev-parse HEAD) .
```

The executor does not know the exact `firebase deploy` target syntax for a second site on this
CLI version; if `--config` plus `"site"` does not select `www-test`, that is a first surprise,
not something to guess around. The live site's `firebase.json` and `firebase.paused.json` are
never deployed by these commands.

One trap to state in the PR: `--update-env-vars` merges from the latest revision, so after
this the preview revision carries the test `BASE_URL`. That is harmless only because
`cloudbuild.yaml` sets `BASE_URL` explicitly on every production deploy — do not remove that.

## The [human] list

0. **Hosting site and DNS.** Step 10's commands 1 and 2.
1. **VAPID key.** Firebase Console → Project settings → Cloud Messaging → Web Push
   certificates → Generate key pair. The public key goes in `VITE_FIREBASE_VAPID_KEY`.
2. **App ID.** Firebase Console → Project settings → General → the `www-web` app's config:
   `appId`. Replace the placeholder in `packages/web/.env.production`. The sender ID is already
   committed (it is the project number, `614936797883`).
3. **FCM API.** `gcloud services enable fcm.googleapis.com --project fluted-citizen-269819`,
   and confirm the service account `www-api` runs as can send messages (it needs
   `cloudmessaging.messages.create`, which the Editor role and `roles/firebasecloudmessaging.admin`
   both grant): `gcloud run services describe www-api --region us-central1 --format
'value(spec.template.spec.serviceAccountName)'`.
4. **Sign-in on the test host**, in all three places `docs/deployment.md` ("Sign-in origins")
   lists; the first is the one the original plan missed, and the key must also be widened for
   FCM, which calls two more APIs with it. Every flag below replaces its list, so restate
   everything that is there now:

   ```bash
   gcloud services api-keys update projects/614936797883/locations/global/keys/29962844-cd3c-4761-9395-6e4a6d612afe \
     --project fluted-citizen-269819 \
     --allowed-referrers="https://play.topherhooper.com/*,https://fluted-citizen-269819.web.app/*,https://fluted-citizen-269819.firebaseapp.com/*,https://test.topherhooper.com/*" \
     --api-target=service=identitytoolkit.googleapis.com \
     --api-target=service=securetoken.googleapis.com \
     --api-target=service=firebaseinstallations.googleapis.com \
     --api-target=service=fcmregistrations.googleapis.com
   ```

   Then Firebase Auth authorized domains (the `curl` PATCH in the same section, with
   `test.topherhooper.com` added to the existing list), and Cloud Console → Credentials →
   OAuth client `614936797883-c24n36s0orbm3s0ff6pgu1lt725imip7` → add
   `https://test.topherhooper.com/__/auth/handler` as an authorized redirect URI. Also confirm
   the Firebase Installations and FCM Registration APIs are enabled on the project; if the key
   is rejected after widening, that is the cause.

5. **The phone test**, which is the task's "done when":
   - **iPhone (iOS 16.4 or later).** Open `https://test.topherhooper.com` in Safari, sign in, go to Settings:
     it should show the walkthrough. Add to Home Screen, open from the icon, sign in again
     (the home-screen app has its own storage), Settings → Turn on notifications → Allow →
     Send a test. Lock the phone first if you can; the push should still arrive.
   - **Android.** Same in Chrome, without the walkthrough.
   - Record in the PR: whether each push arrived, roughly how long it took, and whether
     tapping it opened the app on Settings. "Arrived on Android, not on iPhone" is a result,
     and it reopens decision Q2 in [group-scheduler.md](group-scheduler.md) before anything
     else is built.

## Known risks, so they are not surprises

- **Sign-in inside the iPhone home-screen app** is the likeliest failure, and it is not
  incidental: decision Q5 puts sign-in in front of everything. The popup flow does not work in
  standalone mode; the redirect fallback in `auth.tsx` needs the auth domain to be the same
  origin as the page, which is what step 10's rebuild with `VITE_FIREBASE_AUTH_DOMAIN=test.topherhooper.com` is for. If sign-in fails there, that is
  the first surprise; write down exactly what the phone showed.
- **FCM and Safari.** FCM has supported Safari web push since iOS 16.4, but only through a
  service worker whose push handler always shows a notification. That is why `sw.js` shows one
  even for a malformed payload.
- **Preferences are shared between email and push** for now. A person who used an email's
  one-click unsubscribe has also turned off pushes for those kinds. That is accepted for this
  phase; separate channels are a later decision if anyone asks for them.
