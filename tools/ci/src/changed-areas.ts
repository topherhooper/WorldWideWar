/**
 * Which CI jobs a changeset can plausibly break.
 *
 * Every pull request used to run all three jobs: the check job with its Java-
 * and-emulator server suite, a 300-seed mapgen sweep, and an 800-game balance
 * run. A changeset that only edits `docs/` cannot break any of them.
 *
 * The mapping is deliberately coarse, and it fails open — an unrecognized path
 * turns every gate back on. Getting this table wrong should cost a wasted
 * sweep, never a missed regression.
 */

export interface CiSelection {
  /** `pnpm test` — the whole Vitest run. */
  test: boolean;
  /** `pnpm test:server` — Java 21 plus the Firestore and Auth emulators. */
  serverTest: boolean;
  /** The 300-seed map generator sweep. */
  mapgen: boolean;
  /** The 800-game balance and social gates. */
  balance: boolean;
}

/** What runs when we cannot tell what changed. Not knowing is never a reason to run less. */
export const RUN_EVERYTHING: CiSelection = {
  test: true,
  serverTest: true,
  mapgen: true,
  balance: true,
};

/**
 * `isDocPath` in Cloud Build's glob spelling, for the deploy trigger's
 * `ignoredFiles`. Keep the two in step: `main.ts --ignored-files` prints this
 * list and `docs/deployment.md` tells you to paste it into `gcloud`.
 *
 * `*.md` and `**\/*.md` are both listed on purpose. Whether `**` matches zero
 * leading segments is exactly the kind of thing glob implementations disagree
 * about, and being wrong here means a README-only push redeploys.
 */
export const DOC_GLOBS: readonly string[] = ['docs/**', '*.md', '**/*.md', '.claude/**'];

/** Package prefixes the selection knows about; anything else counts as root. */
const AREAS = ['packages/engine/', 'packages/server/', 'packages/web/', 'tools/'] as const;

/**
 * Documentation, decided by path alone. A comment-only edit inside a source
 * file is not a doc change: telling the difference means parsing diff hunks per
 * language, and being wrong there skips the tests that mattered.
 */
export function isDocPath(path: string): boolean {
  return path.startsWith('docs/') || path.startsWith('.claude/') || path.endsWith('.md');
}

export function selectCiJobs(changedPaths: readonly string[]): CiSelection {
  const code = changedPaths.filter((path) => !isDocPath(path));
  const touches = (prefix: string): boolean => code.some((path) => path.startsWith(prefix));

  const engine = touches('packages/engine/');
  const server = touches('packages/server/');
  const tools = touches('tools/');
  // The workflow itself, the lockfile, tsconfig, the Dockerfile, cloudbuild.yaml
  // — anything outside the known packages is assumed to change how the whole
  // tree builds.
  const root = code.some((path) => !AREAS.some((prefix) => path.startsWith(prefix)));

  return {
    test: code.length > 0,
    serverTest: engine || server || root,
    mapgen: engine || root,
    balance: engine || tools || root,
  };
}
