/**
 * Entry point: serves the API and the browser client from one origin.
 *
 * Configured entirely through the environment, because the thing running this
 * in production is a systemd unit and the thing running it in development is a
 * bare `node`, and neither should need a config file to disagree about.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileArchive, nullArchive, type GameArchive } from './archive.js';
import { createServer } from './http.js';
import { GameStore } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../../web');

const port = Number(process.env.PORT ?? 8787);
/**
 * Loopback by default. Behind a TLS-terminating proxy the server has no
 * business being reachable from anywhere else, and a deployment that wants to
 * be exposed directly has to say so.
 */
const host = process.env.HOST ?? '127.0.0.1';
const dataDir = process.env.DATA_DIR ?? '';
const trustProxy = process.env.TRUST_PROXY === '1';

const archive: GameArchive = dataDir
  ? new FileArchive(resolve(dataDir), (error) => console.error('archive:', error))
  : nullArchive;

const store = new GameStore(undefined, archive);
const restored = await store.restore();
if (dataDir) console.log(`restored ${restored} game${restored === 1 ? '' : 's'} from ${dataDir}`);
else console.log('running without DATA_DIR — games will not survive a restart');

const app = createServer({
  store,
  trustProxy,
  // Compiled modules first, hand-written HTML and CSS second.
  webRoots: [resolve(web, 'dist'), resolve(web, 'public')],
});

const bound = await app.listen(port, host);
console.log(`World Wide War — http://${host}:${bound}`);

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    console.log(`${signal}: finishing writes before exit`);
    void app
      .close()
      // Stop accepting connections first, then let every queued snapshot land —
      // the whole point of persistence is that a deploy is not a casualty.
      .then(() => store.drain())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error('shutdown:', error);
        process.exit(1);
      });
  });
}
