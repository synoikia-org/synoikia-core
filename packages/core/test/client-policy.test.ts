import { describe, expect, it } from 'vitest';
import { clientAllowed, SeenClients } from '../src/auth/client-policy.js';

describe('client policy matching', () => {
  const long = 'c'.repeat(150);

  it('trims and clips a client name the way it is recorded', () => {
    const allow = { mode: 'allow' as const, names: ['listed', long.slice(0, 100)] };
    expect(clientAllowed(allow, '  LISTED ')).toBe(true);
    expect(clientAllowed(allow, long)).toBe(true);
    expect(clientAllowed(allow, '   ')).toBe(false);
    expect(clientAllowed(allow, undefined)).toBe(false);
    const deny = { mode: 'deny' as const, names: ['listed'] };
    expect(clientAllowed(deny, ' listed ')).toBe(false);
    expect(clientAllowed(deny, 'other')).toBe(true);
    expect(clientAllowed({ mode: 'off', names: ['listed'] }, 'listed')).toBe(true);

    const seen = new SeenClients(() => new Date(0));
    seen.record(`  ${long}  `, '1', 'token:a');
    seen.record('   ');
    expect(seen.list()).toEqual([
      { name: long.slice(0, 100), version: '1', client: 'token:a', lastSeen: '1970-01-01T00:00:00.000Z' },
    ]);
  });
});
