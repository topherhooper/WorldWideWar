import { describe, expect, it } from 'vitest';
import { allRunRewritesTagged, withRunTag } from './hosting-retag.js';

// The shape the Hosting API returns for firebase.preview.json after firebase-tools has
// dropped the tag: run rewrites with serviceId and region only.
const deployed = {
  headers: [{ glob: '/sw.js', headers: { 'Cache-Control': 'no-cache' } }],
  rewrites: [
    { glob: '/api/**', run: { serviceId: 'www-api', region: 'us-central1' } },
    { glob: '/unsubscribe', run: { serviceId: 'www-api', region: 'us-central1' } },
    { glob: '**', path: '/index.html' },
  ],
};

describe('withRunTag', () => {
  it('tags every run rewrite and leaves the rest alone', () => {
    const tagged = withRunTag(deployed, 'preview');
    expect(tagged.rewrites).toEqual([
      { glob: '/api/**', run: { serviceId: 'www-api', region: 'us-central1', tag: 'preview' } },
      {
        glob: '/unsubscribe',
        run: { serviceId: 'www-api', region: 'us-central1', tag: 'preview' },
      },
      { glob: '**', path: '/index.html' },
    ]);
    expect(tagged.headers).toBe(deployed.headers);
  });

  it('does not mutate its input', () => {
    withRunTag(deployed, 'preview');
    expect(deployed.rewrites[0].run).toEqual({ serviceId: 'www-api', region: 'us-central1' });
  });

  it('tolerates a config with no rewrites', () => {
    expect(withRunTag({}, 'preview')).toEqual({});
  });
});

describe('allRunRewritesTagged', () => {
  it('is false for what firebase deploy leaves behind and true after retagging', () => {
    expect(allRunRewritesTagged(deployed, 'preview')).toBe(false);
    expect(allRunRewritesTagged(withRunTag(deployed, 'preview'), 'preview')).toBe(true);
  });

  it('is false when a rewrite carries a different tag', () => {
    expect(allRunRewritesTagged(withRunTag(deployed, 'old'), 'preview')).toBe(false);
  });
});
