import { describe, expect, it } from 'vitest';
import { isValidSlug, RESERVED_SLUGS } from '../src/endpoints/slug.js';

describe('isValidSlug', () => {
  it.each(['acme', 'acme-cabin', 'widgets', 'acme2'])('accepts %s', (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each(['', 'ACME', '-acme', 'acme_cabin', 'a/b', 'x'.repeat(64), ...RESERVED_SLUGS])('rejects %s', (slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });
});
