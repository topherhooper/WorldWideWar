// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'tools/mapviz/out/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // ENGINE PURITY.
  //
  // `resolveTurn` must be a pure function of (state, orders, ctx). That single
  // property is what gives us exact replays, crash-safe resolution (the resolver
  // can re-run a turn after a crash and get bit-identical output), and the
  // ability to run the same code in the browser for order previews.
  //
  // Ambient nondeterminism is therefore a build error, not a code-review note.
  // ────────────────────────────────────────────────────────────────────────────
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Engine must be pure: pass timestamps in via ctx.' },
        { name: 'process', message: 'Engine must be pure: no process access.' },
        { name: 'crypto', message: 'Engine must be pure: use the seeded PRNG in rng.ts.' },
        { name: 'performance', message: 'Engine must be pure: no clock access.' },
        { name: 'setTimeout', message: 'Engine must be pure: no timers.' },
        { name: 'setInterval', message: 'Engine must be pure: no timers.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Engine must be pure and reproducible: use the seeded PRNG in rng.ts.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Engine must be pure: pass timestamps in via ctx.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Engine must be pure: pass timestamps in via ctx.',
        },
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // BROWSER PURITY.
  //
  // The client is served straight from `tsc` output with no bundler, so a bare
  // specifier like `@www/engine` is a module the browser cannot resolve — the
  // page dies on load. Type-only imports erase at compile time and are fine;
  // value imports are not, and are caught here rather than by a blank screen.
  // ────────────────────────────────────────────────────────────────────────────
  {
    files: ['packages/web/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@www/engine',
              message: 'The unbundled client can only import types from @www/engine.',
              allowTypeImports: true,
            },
            {
              name: '@www/server',
              message: 'The unbundled client can only import types from @www/server.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },

  // Tests and fixtures may use wall-clock and unseeded randomness freely.
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
