import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePublicKey, verifySignature } from '../../src/plugins/minisign.js';
import { testKey } from '../minisign-keys.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

describe('minisign', () => {
  const pub = parsePublicKey(readFileSync(path.join(FIXTURES, 'minisign/k.pub'), 'utf8'));
  const data = readFileSync(path.join(FIXTURES, 'minisign/data.txt'));
  const sig = (name: string) => readFileSync(path.join(FIXTURES, 'minisign', name), 'utf8');

  it('verifies signatures made by the reference minisign tool (prehashed and legacy)', () => {
    expect(pub.keyId).toMatch(/^[0-9A-F]{16}$/);
    // minisign prints the id without leading zeros.
    expect(readFileSync(path.join(FIXTURES, 'minisign/k.pub'), 'utf8')).toContain(pub.keyId.replace(/^0+/, ''));
    expect(verifySignature(data, sig('data.txt.minisig'), pub)).toMatchObject({
      prehashed: true,
      trustedComment: 'fixture',
    });
    expect(verifySignature(data, sig('data.txt.legacy.minisig'), pub)).toMatchObject({ prehashed: false });
  });

  it('rejects tampered files, tampered trusted comments and other keys', () => {
    expect(() => verifySignature(Buffer.concat([data, Buffer.from('x')]), sig('data.txt.minisig'), pub)).toThrow(
      /does not match/,
    );
    expect(() =>
      verifySignature(data, sig('data.txt.minisig').replace('trusted comment: fixture', 'trusted comment: evil'), pub),
    ).toThrow(/Trusted comment/);
    const other = testKey();
    expect(() => verifySignature(data, sig('data.txt.minisig'), parsePublicKey(other.publicKey))).toThrow(
      /Signed by key/,
    );
    expect(() => parsePublicKey('not a key')).toThrow();
  });
});
