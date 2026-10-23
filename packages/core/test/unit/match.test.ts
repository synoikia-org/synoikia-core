import { describe, expect, it } from 'vitest';
import { getPointer, hasDotPart, matches, MatchSchema } from '../../src/gate/match.js';

describe('getPointer', () => {
  it('follows RFC 6901 pointers', () => {
    const doc = { a: { 'b/c': [10, 20], 'm~n': null } };
    expect(getPointer(doc, '/a/b~1c/1')).toBe(20);
    expect(getPointer(doc, '/a/m~0n')).toBeNull();
    expect(typeof getPointer(doc, '/a/missing')).toBe('symbol');
    expect(typeof getPointer(doc, '/a/b~1c/1/x')).toBe('symbol');
  });
});

describe('matches', () => {
  const call = (params: unknown, targets: { id: string; scopes?: Record<string, string> }[] = []) => ({
    params,
    targets: targets.map((t) => ({ kind: 'entity', name: t.id, scopes: {}, ...t })),
  });

  it('is strict: every parameter must be covered by a condition or accepted with `any`', () => {
    const rule = [{ field: '/name', op: 'prefix', value: 'vol/media' }] as const;
    expect(matches(rule, call({ name: 'vol/media/tv' }))).toBe(true);
    expect(matches(rule, call({ name: 'vol/media/tv', quota: 1 }))).toBe(false);
    const withQuota = [...rule, { field: '/quota', op: 'any' }] as const;
    expect(matches(withQuota, call({ name: 'vol/media/tv', quota: 1 }))).toBe(true);
    expect(matches(withQuota, call({ name: 'vol/media/tv' }))).toBe(true); // `any` also allows absence
    // A condition deeper in an object only covers that key; its siblings still need one.
    const deep = [{ field: '/body/is4k', op: 'bool', value: false }] as const;
    expect(matches(deep, call({ body: { is4k: false } }))).toBe(true);
    expect(matches(deep, call({ body: { is4k: false, userId: 7 } }))).toBe(false);
    expect(matches([...deep, { field: '/body/userId', op: 'any' }], call({ body: { is4k: false, userId: 7 } }))).toBe(
      true,
    );
  });

  it('counts an empty object or list as a parameter the rule must name (ADR-0003)', () => {
    const rule = [{ field: '/name', op: 'prefix', value: 'vol/media' }] as const;
    expect(matches(rule, call({ name: 'vol/media/tv', filters: {} }))).toBe(false);
    expect(matches(rule, call({ name: 'vol/media/tv', tags: [] }))).toBe(false);
    expect(matches([...rule, { field: '/filters', op: 'any' }], call({ name: 'vol/media/tv', filters: {} }))).toBe(
      true,
    );
    expect(matches([], call({}))).toBe(true);
  });

  it('covers positional (array) params by index, and whole arrays by their own path', () => {
    const rule = [{ field: '/0/name', op: 'prefix', value: 'vol/media' }] as const;
    expect(matches(rule, call([{ name: 'vol/media/tv' }]))).toBe(true);
    expect(matches(rule, call([{ name: 'vol/media/tv', quota: 1 }]))).toBe(false);
    expect(matches(rule, call([{ name: 'vol/media/tv' }, { recursive: true }]))).toBe(false);
    expect(matches([...rule, { field: '/1', op: 'any' }], call([{ name: 'vol/media/tv' }, { a: 1 }]))).toBe(true);
    expect(matches([{ field: '/0', op: 'in', value: ['alpha'] }], call(['alpha']))).toBe(true);
    expect(matches([{ field: '/0', op: 'in', value: ['alpha'] }], call(['alpha', { force: true }]))).toBe(false);
    // An array covered at its own path is covered whole, as before.
    expect(matches([{ field: '/apps', op: 'in', value: ['a', 'b'] }], call({ apps: ['a', 'b'] }))).toBe(true);
    expect(matches([], call([]))).toBe(true);
  });

  it.each([
    ['prefix hit', { field: '/name', op: 'prefix', value: 'vol/media/' }, { name: 'vol/media/tv' }, true],
    ['prefix miss', { field: '/name', op: 'prefix', value: 'vol/media/' }, { name: 'vol/other' }, false],
    ['prefix on non-string', { field: '/name', op: 'prefix', value: 'vol/' }, { name: 5 }, false],
    ['empty prefix never matches', { field: '/name', op: 'prefix', value: '' }, { name: 'x' }, false],
    ['in scalar', { field: '/app_name', op: 'in', value: ['alpha', 'beta'] }, { app_name: 'alpha' }, true],
    ['in scalar miss', { field: '/app_name', op: 'in', value: ['alpha'] }, { app_name: 'gamma' }, false],
    ['in empty array', { field: '/apps', op: 'in', value: ['a'] }, { apps: [] }, false],
    ['eq deep', { field: '/o', op: 'eq', value: { a: 1, b: 2 } }, { o: { b: 2, a: 1 } }, true],
    ['range without bounds', { field: '/t', op: 'range', value: {} }, { t: 70 }, false],
  ] as const)('%s', (_name, condition, params, expected) => {
    expect(matches([condition], call(params))).toBe(expected);
  });

  it('requires every resolved target to satisfy every target selector, on whatever scopes the plugin declares', () => {
    const cond = { field: '$targets' as const, scopes: { zone: ['zone_a'], type: ['widget'] } };
    const inZone = { id: 'widget.one', scopes: { zone: 'zone_a', type: 'widget' } };
    const elsewhere = { id: 'widget.two', scopes: { zone: 'zone_b', type: 'widget' } };
    const unscoped = { id: 'widget.three', scopes: { type: 'widget' } };
    expect(matches([cond], call({}, [inZone]))).toBe(true);
    expect(matches([cond], call({}, [inZone, elsewhere]))).toBe(false);
    // A target that reports no value for a selected scope never matches it.
    expect(matches([cond], call({}, [inZone, unscoped]))).toBe(false);
    expect(matches([cond], call({}, []))).toBe(false);
    expect(matches([{ field: '$targets', ids: ['widget.one'] }], call({}, [inZone]))).toBe(true);
    expect(matches([{ field: '$targets', ids: ['widget.one'] }], call({}, [inZone, unscoped]))).toBe(false);
  });

  it('rejects $targets conditions that select nothing or use unknown keys', () => {
    expect(MatchSchema.safeParse([{ field: '$targets' }]).success).toBe(false);
    expect(MatchSchema.safeParse([{ field: '$targets', scopes: {} }]).success).toBe(false);
    expect(MatchSchema.safeParse([{ field: '$targets', scopes: { zone: [] } }]).success).toBe(false);
    expect(MatchSchema.safeParse([{ field: '$targets', areas: ['zone_a'] }]).success).toBe(false);
  });

  it('validates rule shapes', () => {
    expect(MatchSchema.safeParse([{ field: '/n', op: 'prefix', value: 'x' }]).success).toBe(true);
    expect(MatchSchema.safeParse([{ field: '$targets' }]).success).toBe(false);
    expect(MatchSchema.safeParse([{ field: 'name', op: 'prefix', value: 'x' }]).success).toBe(false);
    expect(MatchSchema.safeParse([{ field: '/n', op: 'regex', value: '.*' }]).success).toBe(false);
    expect(MatchSchema.safeParse([{ field: '', op: 'any' }]).success).toBe(true);
    expect(MatchSchema.safeParse([{ field: '', op: 'eq', value: 1 }]).success).toBe(false);
  });
});

describe('hasDotPart (ADR-0003)', () => {
  it.each([
    'vol/media/../private',
    'vol/media/./tv',
    'vol/media/..',
    'vol/media\\..\\private',
    'vol/media/%2e%2e/x',
    'vol/media/%2E%2e/x',
    'vol/media/..%2fx',
    'vol/media%2f..%2fx',
    'vol/media/%252e%252e/x',
    'vol/media/..%5cx',
    'vol/media/\uff0e\uff0e/x',
    'vol/media/..\uff0fx',
    'vol/media/...',
    'vol/media/.. /x',
    'vol/media/%25252e%25252e/x',
    'vol/media/..%20/x%zz',
    'vol/media/%EF%BC%8E%EF%BC%8E/x%zz',
    'vol/media/..%09/x%',
    'vol/media/%c0%ae%c0%ae/x',
  ])('finds a dot part in %s', (value) => {
    expect(hasDotPart(value)).toBe(true);
  });

  it.each([
    'vol/media/..config',
    'vol/media/a//b',
    'vol/media/light.kitchen',
    'vol/media/100%',
    'v1.2..3',
    'https://acme.example/a',
  ])('finds none in %s', (value) => {
    expect(hasDotPart(value)).toBe(false);
  });

  it('keeps a value with a dot part from matching a prefix', () => {
    const rule = [{ field: '/name', op: 'prefix', value: 'vol/media' }] as const;
    expect(matches(rule, { params: { name: 'vol/media/../private' }, targets: [] })).toBe(false);
    expect(matches(rule, { params: { name: 'vol/media/..config' }, targets: [] })).toBe(true);
    // A malformed escape elsewhere does not stop the decoding of the dot part.
    expect(matches(rule, { params: { name: 'vol/media/..%20/x%zz' }, targets: [] })).toBe(false);
  });
});
