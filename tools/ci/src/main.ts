/**
 * Publishes the CI job selection for the current changeset.
 *
 *   pnpm exec tsx tools/ci/src/main.ts <base-sha>
 *   pnpm exec tsx tools/ci/src/main.ts --ignored-files
 *
 * Appends `key=value` lines to $GITHUB_OUTPUT when the workflow sets it, and
 * always prints them, so the same command explains itself when run locally.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { DOC_GLOBS, RUN_EVERYTHING, selectCiJobs, type CiSelection } from './changed-areas.js';

const NO_COMMIT = '0000000000000000000000000000000000000000';

/** Null when the base is unusable: a first push, a force-push, or a shallow clone. */
function changedPaths(base: string): string[] | null {
  if (base === '' || base === NO_COMMIT) return null;
  try {
    // Three dots, so a pull request is compared against its merge base rather
    // than a moving `main` — an unrelated merge cannot widen the selection.
    const diff = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
      encoding: 'utf8',
    });
    return diff.split('\n').filter((line) => line !== '');
  } catch {
    return null;
  }
}

function main(): void {
  const arg = process.argv[2] ?? '';
  if (arg === '--ignored-files') {
    console.log(DOC_GLOBS.join(','));
    return;
  }

  const paths = changedPaths(arg);
  const selection: CiSelection = paths === null ? RUN_EVERYTHING : selectCiJobs(paths);
  const lines = Object.entries(selection).map(([gate, run]) => `${gate}=${run}`);

  console.log(
    paths === null
      ? 'base commit unknown — running everything'
      : `${paths.length} changed path(s):\n${paths.join('\n')}`,
  );
  console.log(lines.join('\n'));

  const output = process.env.GITHUB_OUTPUT;
  if (output !== undefined) appendFileSync(output, `${lines.join('\n')}\n`);
}

main();
