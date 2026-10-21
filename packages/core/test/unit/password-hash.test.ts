import { hash } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import { PASSWORD_HASH } from '../../src/auth/users.js';

describe('PASSWORD_HASH', () => {
  it('is argon2id with 64 MiB, 3 passes and 1 lane (ADR-0008)', async () => {
    expect(PASSWORD_HASH).toEqual({ memoryCost: 65536, timeCost: 3, parallelism: 1 });
    expect(await hash('a pinned passphrase', PASSWORD_HASH)).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  });
});
