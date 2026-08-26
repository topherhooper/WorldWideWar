import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Dockerfile copies every workspace manifest before `pnpm install`, and then
 * `COPY . .` brings in the rest of the tree.
 *
 * A package missing from that list installs no `node_modules`, so its
 * `workspace:*` dependency does not resolve -- and since the root tsconfig
 * references every package, `tsc --build` fails and the image build dies at step 0.
 *
 * This is worth a test rather than care, because **every gate in "Before you push"
 * passes while it is broken**: format, lint, typecheck, both test suites and all of
 * CI run against the repo, not against the image. The first sign is a failed
 * production deploy, which is the most expensive place to find out. Adding
 * `tools/sacre` is what proved it.
 */
describe('the Dockerfile', () => {
  it('copies a manifest for every workspace package', () => {
    const root = join(import.meta.dirname, '../../..');
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');

    // The workspace is `packages/*` and `tools/*`; read it off disk rather than
    // hardcoding, so a new package is covered the day it is added.
    const dirs = ['packages', 'tools'].flatMap((group) =>
      readdirSync(join(root, group), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => `${group}/${e.name}`),
    );

    const missing = dirs.filter((dir) => !dockerfile.includes(`COPY ${dir}/package.json`));
    expect(missing, `add a COPY line to the Dockerfile for: ${missing.join(', ')}`).toEqual([]);
  });
});
