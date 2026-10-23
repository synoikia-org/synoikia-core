import { describe, expect, it } from 'vitest';
import { matchMisfit } from '../../src/catalog/rules.js';

const manifest = { matchProfiles: { list: [{ field: '/list', op: 'prefix' }] } } as unknown as Parameters<
  typeof matchMisfit
>[0];
const op = { key: 'tasks.add', matchProfile: 'list' };

describe('matchMisfit', () => {
  it('refuses a prefix with a dot part (ADR-0003)', () => {
    expect(matchMisfit(manifest, op, [{ field: '/list', op: 'prefix', value: 'Groceries/..' }])?.code).toBe(
      'prefix_dot_part',
    );
  });

  it('reports a field the profile lacks before a dot part', () => {
    expect(matchMisfit(manifest, op, [{ field: '/other', op: 'prefix', value: 'Groceries/..' }])?.code).toBe(
      'unknown_match_field',
    );
  });
});
