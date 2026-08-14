import { describe, expect, it } from 'vitest';

import { unsubSigner } from './unsub.js';

describe('unsubSigner', () => {
  const signer = unsubSigner('secret-one');

  it('verifies a signature it produced', () => {
    expect(signer.verify('u-alice', signer.sign('u-alice'))).toBe(true);
  });

  it('rejects a signature for a different uid', () => {
    expect(signer.verify('u-bob', signer.sign('u-alice'))).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const sig = signer.sign('u-alice');
    const tampered = `${sig.slice(0, -1)}${sig.endsWith('a') ? 'b' : 'a'}`;
    expect(signer.verify('u-alice', tampered)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    expect(signer.verify('u-alice', unsubSigner('secret-two').sign('u-alice'))).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    expect(signer.verify('u-alice', '')).toBe(false);
    expect(signer.verify('u-alice', `${signer.sign('u-alice')}extra`)).toBe(false);
  });

  it('produces url-safe signatures', () => {
    expect(signer.sign('u-alice')).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
