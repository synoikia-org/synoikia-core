import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, totpAt } from '../../src/auth/totp.js';

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vector', () => {
    // RFC 6238 appendix B: secret "12345678901234567890", T = 59 s → 94287082 (8 digits) → 287082.
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(totpAt(secret, 1)).toBe('287082');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });
});
