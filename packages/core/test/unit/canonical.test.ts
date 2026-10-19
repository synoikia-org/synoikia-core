import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../../src/gate/canonical.js';

describe('canonicalJson', () => {
  it('is stable across key order and hashes identically', () => {
    const a = canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } });
    const b = canonicalJson({ a: { c: null, d: [3, { x: 2, y: 1 }] }, b: 1 });
    expect(a).toBe(b);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(canonicalJson(undefined)).toBe('null');
  });
});
