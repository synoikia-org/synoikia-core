import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { aad, DecryptionError, SecretBox } from '../../src/crypto/index.js';

const box = SecretBox.fromKey(randomBytes(32));
const binding = aad('plugin_instances', 'secrets_enc', 'inst-1');

describe('SecretBox', () => {
  it('round-trips strings and JSON', () => {
    expect(box.decrypt(box.encrypt('s3cret', binding), binding).toString()).toBe('s3cret');
    expect(box.decryptJson(box.encryptJson({ apiKey: 'k' }, binding), binding)).toEqual({ apiKey: 'k' });
  });

  it('uses a fresh nonce per value', () => {
    expect(box.encrypt('same', binding).equals(box.encrypt('same', binding))).toBe(false);
  });

  it('refuses a ciphertext copied to another row', () => {
    const blob = box.encrypt('s3cret', binding);
    expect(() => box.decrypt(blob, aad('plugin_instances', 'secrets_enc', 'inst-2'))).toThrow(DecryptionError);
  });

  it('refuses tampered data and the wrong key', () => {
    const blob = box.encrypt('s3cret', binding);
    const tampered = Buffer.from(blob);
    tampered[20] = (tampered[20] ?? 0) ^ 0xff;
    expect(() => box.decrypt(tampered, binding)).toThrow(DecryptionError);
    expect(() => SecretBox.fromKey(randomBytes(32)).decrypt(blob, binding)).toThrow(DecryptionError);
    expect(() => box.decrypt(Buffer.from('short'), binding)).toThrow(DecryptionError);
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => SecretBox.fromKey(randomBytes(16))).toThrow(/32 bytes/);
  });

  it('derives distinct, stable subkeys per purpose', () => {
    expect(box.deriveKey('approval-links').equals(box.deriveKey('approval-links'))).toBe(true);
    expect(box.deriveKey('approval-links').equals(box.deriveKey('attestation'))).toBe(false);
  });
});
