import { describe, expect, it } from 'vitest';
import { queryString } from '../../src/index.js';

describe('queryString', () => {
  it('encodes arrays, objects and drops nulls', () => {
    expect(queryString(undefined)).toBe('');
    expect(queryString({ a: [1, 2], b: { x: 1 }, c: undefined, d: 'é' })).toBe('?a=1&a=2&b=%7B%22x%22%3A1%7D&d=%C3%A9');
  });
});
