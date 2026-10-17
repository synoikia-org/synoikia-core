import { describe, expect, it } from 'vitest';
import { credentialPaths } from '../../src/workflow/secrets.js';
import { checkSecurityLine } from '../../src/workflow/security-line.js';
import { unlistedTests } from '../../src/workflow/tests.js';

describe('credentialPaths', () => {
  it('finds credential files by name', () => {
    expect(
      credentialPaths([
        '.env',
        'packages/core/.env.local',
        '.env.example',
        'keys/minisign.key',
        'tls/server.pem',
        'secrets.yaml',
        'secrets.template.yaml',
        'id_ed25519',
        'minisign.pub',
        'src/env.ts',
      ]),
    ).toEqual([
      '.env',
      'packages/core/.env.local',
      'keys/minisign.key',
      'tls/server.pem',
      'secrets.yaml',
      'id_ed25519',
    ]);
  });
});

describe('checkSecurityLine', () => {
  const paths = ['packages/core/src/gate/**'];
  const changed = ['packages/core/src/gate/index.ts', 'docs/a.md'];

  it('needs the line on a ready PR that changes a security path', () => {
    expect(checkSecurityLine({ draft: false, body: 'Fixes it.' }, changed, paths).join()).toMatch(/Security audit:/);
    expect(checkSecurityLine({ draft: false, body: null }, changed, paths)).toHaveLength(1);
  });

  it('accepts the line, a draft, or no security path', () => {
    expect(checkSecurityLine({ draft: false, body: 'x\nSecurity audit: gate. No finding.' }, changed, paths)).toEqual(
      [],
    );
    expect(checkSecurityLine({ draft: true, body: '' }, changed, paths)).toEqual([]);
    expect(checkSecurityLine({ draft: false, body: '' }, ['docs/a.md'], paths)).toEqual([]);
  });

  it('refuses the line inside other text', () => {
    expect(checkSecurityLine({ draft: false, body: 'See Security audit: none' }, changed, paths)).toHaveLength(1);
  });
});

describe('unlistedTests', () => {
  it('lets only unit tests in', () => {
    expect(
      unlistedTests(
        ['packages/core/test/unit/access.test.ts', 'packages/core/test/gate.test.ts', 'packages/core/src/a.ts'],
        ['**/test/unit/**/*.test.ts'],
      ),
    ).toEqual([expect.stringMatching(/^packages\/core\/test\/gate\.test\.ts: /)]);
  });
});
