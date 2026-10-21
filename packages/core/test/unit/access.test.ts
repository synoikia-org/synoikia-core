import { describe, expect, it } from 'vitest';
import { capLevel, effectiveAccess, levelInForce, normalizeLevel } from '../../src/gate/access.js';
import type { AccessLevel, AccessOperation } from '../../src/gate/access.js';

const read: AccessOperation = { classification: 'read', locked: false, levelOverride: null, writeAcknowledged: false };
const write: AccessOperation = { ...read, classification: 'write', writeAcknowledged: true };
const locked: AccessOperation = { ...write, locked: true };

const at = (level: AccessLevel) => ({ level });

describe('effectiveAccess', () => {
  it.each([
    // [name, op, group level, expected]
    ['read op, write', read, 'write', { reachable: true, mode: 'run', level: 'read' }],
    ['locked op, none', locked, 'none', { reachable: false, reason: 'level_none' }],
    ['locked op, read', locked, 'read', { reachable: false, reason: 'locked_not_opted_in' }],
    ['locked op, ask (group only)', locked, 'ask', { reachable: false, reason: 'locked_not_opted_in' }],
  ] as const)('%s', (_name, op, level, expected) => {
    expect(effectiveAccess(op, at(level))).toEqual(expected);
  });

  it('fails closed when the group row is missing or has an unknown level', () => {
    expect(effectiveAccess(read, undefined)).toEqual({ reachable: false, reason: 'group_missing' });
    expect(effectiveAccess(read, { level: 'admin' as AccessLevel })).toEqual({
      reachable: false,
      reason: 'group_missing',
    });
    // An unknown override is treated as None, never as "follow the group".
    expect(effectiveAccess({ ...read, levelOverride: 'admin' as AccessLevel }, at('write'))).toEqual({
      reachable: false,
      reason: 'level_none',
    });
  });

  it('opens a locked op only with its own Ask, and always asks', () => {
    // The operation's own level wins, even over a group at None.
    expect(effectiveAccess({ ...locked, levelOverride: 'ask' }, at('none'))).toEqual({
      reachable: true,
      mode: 'approve',
      level: 'ask',
    });
    expect(effectiveAccess({ ...locked, levelOverride: 'ask' }, at('read'))).toEqual({
      reachable: true,
      mode: 'approve',
      level: 'ask',
    });
    // `write` is refused at the API; even if a row carried it, a locked op never auto-approves.
    expect(effectiveAccess({ ...locked, levelOverride: 'write' }, at('write'))).toEqual({
      reachable: true,
      mode: 'approve',
      level: 'ask',
    });
    // A stored Read doesn't fit a locked op: it is None.
    expect(effectiveAccess({ ...locked, levelOverride: 'read' }, at('write'))).toEqual({
      reachable: false,
      reason: 'level_none',
    });
  });

  it('narrows a stored level that does not fit, never widening it', () => {
    expect(normalizeLevel(read, 'write')).toBe('read');
    expect(normalizeLevel(write, 'read')).toBe('none');
    expect(normalizeLevel(locked, 'read')).toBe('none');
    expect(normalizeLevel(locked, 'write')).toBe('ask');
    expect(normalizeLevel(write, 'bogus')).toBe('none');
    expect(normalizeLevel(write, 'ask')).toBe('ask');
  });

  it('reports the level in force in the operation’s own terms', () => {
    expect(levelInForce(read, at('ask'))).toBe('read');
    expect(levelInForce(write, at('read'))).toBe('none');
    expect(levelInForce(write, at('write'))).toBe('write');
    expect(levelInForce(locked, at('write'))).toBe('none');
    expect(levelInForce({ ...locked, levelOverride: 'ask' }, at('none'))).toBe('ask');
    expect(levelInForce(read, undefined)).toBe('none');
  });

  it('treats a locked op as a write even if its row says read', () => {
    expect(effectiveAccess({ ...locked, classification: 'read' }, at('write'))).toEqual({
      reachable: false,
      reason: 'locked_not_opted_in',
    });
  });
});

describe('role caps (ADR-0004)', () => {
  it.each([
    // [name, op, endpoint level, role layer, own layer, expected level]
    ['own level never widens the role', write, 'write', { group: 'ask' }, { op: 'write' }, 'ask'],
    ['an unset own level follows the role', write, 'write', { group: 'write' }, {}, 'write'],
    ['a locked op needs its own Ask everywhere', locked, 'ask', { group: 'write' }, undefined, 'none'],
  ] as const)('%s', (_name, op, endpoint, role, own, expected) => {
    expect(capLevel(op, endpoint, role, own)).toBe(expected);
  });
});
