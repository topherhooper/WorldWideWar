/** Entry point: serves the API and the browser client from one origin. */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './http.js';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../../web');

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';

const app = createServer({
  // Compiled modules first, hand-written HTML and CSS second.
  webRoots: [resolve(web, 'dist'), resolve(web, 'public')],
});

const bound = await app.listen(port, host);
console.log(`World Wide War — http://localhost:${bound}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
