import { defineConfig } from 'vitest/config';

// Smoke suites run against a deployed stack, so they are kept out of `pnpm test` and run
// only by `pnpm test:smoke` — from cloudbuild.preview.yaml after a test-host deploy.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.smoke.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
