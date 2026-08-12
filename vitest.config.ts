import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'tools/*/src/**/*.test.ts'],
    // The property tests (order-independence, determinism, map symmetry) sweep
    // hundreds of seeds, so they need more than the 5s default.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
