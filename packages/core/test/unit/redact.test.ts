import { describe, expect, it } from 'vitest';
import {
  createRedactor,
  GLOBAL_SENSITIVE_KEYS,
  REDACTED,
  redactDiff,
  redactPaths,
  redactResult,
} from '../../src/gate/redact.js';

describe('createRedactor', () => {
  const redact = createRedactor(GLOBAL_SENSITIVE_KEYS, ['vendorToken']);

  it('leaves empty values visible (so "no password set" is still readable) and does not mutate input', () => {
    const input = { password: '', token: null, secret: 's' };
    expect(redact(input)).toEqual({ password: '', token: null, secret: REDACTED });
    expect(input.secret).toBe('s');
  });

  it('redacts keys that contain a sensitive word, keeping flags and counts visible (review L1)', () => {
    expect(
      redact({
        db_password: 'hunter2',
        newPassword: 'n',
        smtp_pass: 's',
        authPass: 'a',
        ssh_private_key: 'pem',
        'X-Api-Key': 'k',
        Authorization: 'Bearer abc',
        headers: { cookie: 'sid=1' },
        password_set: true,
        max_tokens: 4096,
        bypass: 'on',
        passive: 'yes',
        compass: 'north',
      }),
    ).toEqual({
      db_password: REDACTED,
      newPassword: REDACTED,
      smtp_pass: REDACTED,
      authPass: REDACTED,
      ssh_private_key: REDACTED,
      'X-Api-Key': REDACTED,
      Authorization: REDACTED,
      headers: { cookie: REDACTED },
      password_set: true,
      max_tokens: 4096,
      bypass: 'on',
      passive: 'yes',
      compass: 'north',
    });
    // An exact match hides any value, numbers included.
    expect(redact({ password: 1234 })).toEqual({ password: REDACTED });
  });

  it('handles primitives and cycles', () => {
    expect(redact('plain')).toBe('plain');
    const a: Record<string, unknown> = { password: 'x' };
    a.self = a;
    expect(redact(a)).toEqual({ password: REDACTED, self: '[Circular]' });
  });
});

describe('redactPaths', () => {
  it('hides positional and nested values the plugin declared, on a copy', () => {
    const params = ['admin', 'hunter22', { opts: { pin: 1234, keep: 'x' } }];
    expect(redactPaths(params, ['/1', '/2/opts/pin'])).toEqual([
      'admin',
      REDACTED,
      { opts: { pin: REDACTED, keep: 'x' } },
    ]);
    expect(params[1]).toBe('hunter22'); // the input is untouched
  });

  it('ignores missing paths, empty values and inherited keys, and decodes ~1 / ~0', () => {
    expect(redactPaths({ a: '', b: null }, ['/a', '/b', '/c/d', '/__proto__/x'])).toEqual({ a: '', b: null });
    expect(redactPaths({ 'a/b': 's', 'c~d': 't' }, ['/a~1b', '/c~0d'])).toEqual({ 'a/b': REDACTED, 'c~d': REDACTED });
    expect(redactPaths('plain', ['/0'])).toBe('plain');
    expect(redactPaths({ a: 1 }, null)).toEqual({ a: 1 });
  });

  it('matches a declared path in any case, also with folded letters (ADR-0007)', () => {
    expect(redactPaths({ PIN: '1', pin: '2', Pin: '3' }, ['/pin'])).toEqual({
      PIN: REDACTED,
      pin: REDACTED,
      Pin: REDACTED,
    });
    expect(redactPaths({ Settings: { URL: 'u', url: 'v' } }, ['/settings/url'])).toEqual({
      Settings: { URL: REDACTED, url: REDACTED },
    });
    expect(redactPaths({ ſecret: 's', Key: 'k' }, ['/secret', '/key'])).toEqual({
      ſecret: REDACTED,
      Key: REDACTED,
    });
  });
});

describe('redactPaths on a wide object', () => {
  it('folds each key once, however many paths there are', () => {
    const wide = { ...Object.fromEntries(Array.from({ length: 200_000 }, (_, i) => [`k${i}`, i])), PIN: 'x' };
    const paths = Array.from({ length: 32 }, (_, i) => `/K${i}/deep`);
    const time = (p: string[]) => {
      const start = performance.now();
      expect(redactPaths(wide, p).PIN).toBe(REDACTED);
      return performance.now() - start;
    };
    const one = time(['/pin']);
    // The copy costs the same either way; 32 more paths must not multiply the walk.
    expect(time([...paths, '/pin'])).toBeLessThan(one * 3 + 50);
  });
});

describe('redactDiff in any case', () => {
  const redact = createRedactor(GLOBAL_SENSITIVE_KEYS, []);
  it('hides an entry at or above a declared path written in another case', () => {
    expect(
      redactDiff(
        [
          { path: '/LockCode', after: '2468' },
          { path: '/Settings', after: { URL: 'u', name: 'n' } },
        ],
        redact,
        ['/lockCode', '/settings/url'],
      ),
    ).toEqual([
      { path: '/LockCode', after: REDACTED },
      { path: '/Settings', after: { URL: REDACTED, name: 'n' } },
    ]);
  });
});

describe('redactResult', () => {
  it('leaves results without a declaration alone', () => {
    const value = { key: 'k' };
    expect(redactResult(value, undefined)).toBe(value);
    expect(redactResult(value, null)).toBe(value);
  });

  it('masks a whole result that is a secret, whatever its type', () => {
    expect(redactResult('abc', 'whole')).toBe(REDACTED);
    expect(redactResult(123456, 'whole')).toBe(REDACTED);
    expect(redactResult({ token: 'x' }, 'whole')).toBe(REDACTED);
    expect(redactResult('', 'whole')).toBe('');
    expect(redactResult(null, 'whole')).toBeNull();
  });

  it('masks named keys in the result or each row of it', () => {
    const spec = { keys: ['key'] };
    expect(redactResult([{ id: 1, key: 'k' }, { id: 2 }], spec)).toEqual([{ id: 1, key: REDACTED }, { id: 2 }]);
    // Whatever the value under the key: a number, an object.
    expect(redactResult({ key: { nested: 'x' } }, spec)).toEqual({ key: REDACTED });
    expect(redactResult({ key: 1234 }, spec)).toEqual({ key: REDACTED });
    expect(redactResult({ key: '' }, spec)).toEqual({ key: '' });
    // Only the top level (or each row) without `deep`.
    expect(redactResult({ a: { key: 'k' } }, spec)).toEqual({ a: { key: 'k' } });
    // Exact names: `keyId` is not `key`.
    expect(redactResult({ keyId: 7, key: 'k' }, spec)).toEqual({ keyId: 7, key: REDACTED });
  });

  it('never pollutes prototypes and keeps a __proto__ key visible', () => {
    const input = JSON.parse('{"__proto__": {"polluted": true}, "key": "k"}') as unknown;
    for (const spec of [{ keys: ['key'] }, { keys: ['key'], deep: true }]) {
      const out = redactResult(input, spec) as Record<string, unknown>;
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
      expect(Object.hasOwn(out, '__proto__')).toBe(true);
      expect(out.key).toBe(REDACTED);
    }
  });
});

describe('redactDiff', () => {
  const redact = createRedactor(GLOBAL_SENSITIVE_KEYS, ['webhook_id']);
  it('hides both sides of entries whose path names a secret or a sensitive param', () => {
    expect(
      redactDiff(
        [
          { path: '/action/0/data/password', before: 'old', after: 'new' },
          { path: '/trigger/webhook_id', after: 'hook-123' },
          { path: '/pin', before: '1' },
          { path: '/pin/deep', after: '2' },
          { path: '/alias', before: 'Lights', after: 'Lamps' },
          { path: '/data', after: { token: 'abc', keep: 1 } },
        ],
        redact,
        ['/pin'],
      ),
    ).toEqual([
      { path: '/action/0/data/password', before: REDACTED, after: REDACTED },
      { path: '/trigger/webhook_id', after: REDACTED },
      { path: '/pin', before: REDACTED },
      { path: '/pin/deep', after: REDACTED },
      { path: '/alias', before: 'Lights', after: 'Lamps' },
      { path: '/data', after: { token: REDACTED, keep: 1 } },
    ]);
    expect(redactDiff(undefined, redact)).toBeUndefined();
  });

  it('catches dotted and bare paths, hides declared parts inside a parent entry, and fails closed', () => {
    expect(
      redactDiff(
        [
          { path: 'password', after: 'p1' },
          { path: 'smtp.password', before: 'p2' },
          { path: '/args', before: ['u', 'old-secret'], after: ['u', 'new-secret'] },
        ],
        redact,
        ['/args/1'],
      ),
    ).toEqual([
      { path: 'password', after: REDACTED },
      { path: 'smtp.password', before: REDACTED },
      { path: '/args', before: ['u', REDACTED], after: ['u', REDACTED] },
    ]);
    const bare = (<T>(v: T) => v) as Parameters<typeof redactDiff>[1];
    expect(redactDiff([{ path: '/alias', after: 'x' }], bare)).toEqual([{ path: '/alias', after: REDACTED }]);
  });
});
