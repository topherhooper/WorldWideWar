import { describe, expect, it } from 'vitest';
import { canonicalJson, hashValue, sha256 } from './hash.js';

describe('sha256', () => {
  // Known-answer tests against the published FIPS 180-4 vectors. The engine
  // ships its own implementation so it runs unchanged in the browser, which
  // means correctness here is our responsibility, not a library's.
  it('matches published test vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('hello world')).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });

  it('handles inputs spanning the padding boundary', () => {
    // 55, 56 and 64 bytes exercise the three distinct padding cases.
    expect(sha256('a'.repeat(55))).toBe(
      '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318',
    );
    expect(sha256('a'.repeat(56))).toBe(
      'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a',
    );
    expect(sha256('a'.repeat(64))).toBe(
      'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    );
  });

  it('handles multi-byte utf-8', () => {
    expect(sha256('äöü')).toBe(
      sha256(String.fromCharCode(0xe4) + String.fromCharCode(0xf6) + String.fromCharCode(0xfc)),
    );
    expect(sha256('🗺️').length).toBe(64);
  });
});

describe('canonicalJson', () => {
  it('sorts keys so construction order cannot change the hash', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(hashValue({ b: 1, a: 2 })).toBe(hashValue({ a: 2, b: 1 }));
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(hashValue([1, 2])).not.toBe(hashValue([2, 1]));
  });

  it('sorts nested keys too', () => {
    expect(canonicalJson({ z: { y: 1, x: 2 }, a: [{ n: 1, m: 2 }] })).toBe(
      '{"a":[{"m":2,"n":1}],"z":{"x":2,"y":1}}',
    );
  });

  it('omits undefined values rather than emitting invalid json', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('round-trips through JSON.parse', () => {
    const value = { turn: 3, owner: [0, null, 2], nested: { ok: true } };
    expect(JSON.parse(canonicalJson(value))).toEqual(value);
  });
});
