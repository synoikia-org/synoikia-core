import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signPayload, verifyPayload } from '../../src/auth/tokens.js';

describe('signed payloads', () => {
  it('round-trips and rejects tampering and expiry', () => {
    const key = randomBytes(32);
    const token = signPayload(key, { a: 1 }, 1000, 0);
    expect(verifyPayload(key, token, 500)).toMatchObject({ a: 1 });
    expect(verifyPayload(key, token, 1500)).toBeNull();
    expect(verifyPayload(randomBytes(32), token, 500)).toBeNull();
    expect(verifyPayload(key, token.replace(/^./, 'x'), 500)).toBeNull();
    expect(verifyPayload(key, undefined)).toBeNull();
  });
});
