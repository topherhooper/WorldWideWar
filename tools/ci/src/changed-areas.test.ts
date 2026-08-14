import { describe, expect, it } from 'vitest';
import { DOC_GLOBS, RUN_EVERYTHING, isDocPath, selectCiJobs } from './changed-areas.js';

describe('isDocPath', () => {
  it('classifies docs, Markdown anywhere, and agent config as documentation', () => {
    expect(isDocPath('docs/deployment.md')).toBe(true);
    expect(isDocPath('README.md')).toBe(true);
    expect(isDocPath('CLAUDE.md')).toBe(true);
    expect(isDocPath('packages/web/README.md')).toBe(true);
    expect(isDocPath('.claude/settings.json')).toBe(true);
  });

  it('classifies source as source, whatever it contains', () => {
    expect(isDocPath('packages/engine/src/resolve.ts')).toBe(false);
    expect(isDocPath('.github/workflows/ci.yml')).toBe(false);
    expect(isDocPath('pnpm-lock.yaml')).toBe(false);
  });
});

describe('selectCiJobs', () => {
  it('selects nothing for a docs-only changeset', () => {
    expect(
      selectCiJobs(['docs/superpowers/ideas/2026-08-14-tier-list-cues.md', 'README.md']),
    ).toEqual({ test: false, serverTest: false, mapgen: false, balance: false });
  });

  it('selects everything for an engine change', () => {
    expect(selectCiJobs(['packages/engine/src/resolve.ts'])).toEqual(RUN_EVERYTHING);
  });

  it('runs the server suite but no sweeps for a server change', () => {
    expect(selectCiJobs(['packages/server/src/games.ts'])).toEqual({
      test: true,
      serverTest: true,
      mapgen: false,
      balance: false,
    });
  });

  it('runs only the Vitest suite for a web change', () => {
    expect(selectCiJobs(['packages/web/src/pages/Home.tsx'])).toEqual({
      test: true,
      serverTest: false,
      mapgen: false,
      balance: false,
    });
  });

  it('runs the balance sweep when the harness itself changes', () => {
    expect(selectCiJobs(['tools/simulate/src/report.ts'])).toEqual({
      test: true,
      serverTest: false,
      mapgen: false,
      balance: true,
    });
  });

  it('runs everything for anything it does not recognize', () => {
    expect(selectCiJobs(['.github/workflows/ci.yml'])).toEqual(RUN_EVERYTHING);
    expect(selectCiJobs(['pnpm-lock.yaml'])).toEqual(RUN_EVERYTHING);
    expect(selectCiJobs(['packages/newthing/src/index.ts'])).toEqual(RUN_EVERYTHING);
  });

  it('takes the union of a mixed changeset, not the intersection', () => {
    expect(selectCiJobs(['docs/deployment.md', 'packages/engine/src/rng.ts'])).toEqual(
      RUN_EVERYTHING,
    );
  });

  it('selects nothing when nothing changed', () => {
    expect(selectCiJobs([])).toEqual({
      test: false,
      serverTest: false,
      mapgen: false,
      balance: false,
    });
  });
});

describe('the safety net', () => {
  it('RUN_EVERYTHING has every gate on', () => {
    expect(Object.values(RUN_EVERYTHING).every(Boolean)).toBe(true);
  });

  it('DOC_GLOBS is the Cloud Build spelling of isDocPath', () => {
    expect(DOC_GLOBS).toEqual(['docs/**', '*.md', '**/*.md', '.claude/**']);
  });
});
