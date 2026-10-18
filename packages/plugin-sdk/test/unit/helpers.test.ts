import { describe, expect, it } from 'vitest';
import {
  baseKey,
  ErrorCodes,
  isPlainObject,
  requireString,
  splitSuffix,
  statusKind,
  stringOr,
  toGroup,
  truncate,
  tryOr,
  upstreamError,
  withSplit,
} from '../../src/index.js';

describe('upstream errors', () => {
  it('maps HTTP statuses to kinds', () => {
    expect([401, 403, 400, 422, 404, 500].map(statusKind)).toEqual([
      'denied',
      'denied',
      'invalid',
      'invalid',
      'failed',
      'failed',
    ]);
  });

  it('builds the standard messages and codes', () => {
    const denied = upstreamError('Acme', 'denied', 'GET /x', 'nope');
    expect(denied).toMatchObject({
      code: ErrorCodes.UpstreamDenied,
      message: 'Acme denied GET /x: insufficient permission (nope)',
    });
    expect(upstreamError('Acme', 'invalid', 'GET /x', 'bad', { status: 400 })).toMatchObject({
      code: ErrorCodes.InvalidParams,
      message: 'GET /x: bad',
      data: { status: 400 },
    });
    expect(upstreamError('Acme', 'failed', 'GET /x', 'boom').code).toBe(ErrorCodes.UpstreamError);
  });
});

describe('catalog helpers', () => {
  it('makes valid group names', () => {
    expect(toGroup('Pool.Dataset')).toBe('pool.dataset');
    expect(toGroup('Media Requests!')).toBe('media_requests_');
    expect(toGroup('__x')).toBe('x');
    expect(toGroup('!!!', 'other')).toBe('other');
  });

  it('handles split keys', () => {
    expect(baseKey('cover.open_cover#garage')).toBe('cover.open_cover');
    expect(splitSuffix('cover.open_cover#garage')).toBe('garage');
    expect(splitSuffix('cover.open_cover')).toBeUndefined();
    expect(withSplit('a.b#x', 'y')).toBe('a.b#y');
  });
});

describe('small helpers', () => {
  it('works', async () => {
    expect(requireString({ a: 'x' }, 'a')).toBe('x');
    expect(() => requireString({ a: '' }, 'a')).toThrow('a is required');
    expect(truncate('abcdef', 3)).toBe('abc…');
    expect(truncate('abc', 3)).toBe('abc');
    expect(await tryOr(() => Promise.reject(new Error('x')))).toBeUndefined();
    expect(await tryOr(() => 1)).toBe(1);
    expect([isPlainObject({}), isPlainObject([]), isPlainObject(null)]).toEqual([true, false, false]);
    expect([stringOr('a'), stringOr(3), stringOr(''), stringOr({})]).toEqual(['a', '3', undefined, undefined]);
  });
});
