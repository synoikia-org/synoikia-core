import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMasterKey } from '../src/crypto/index.js';

describe('loadMasterKey', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(path.join(tmpdir(), 'synoikia-key-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('rejects a malformed MASTER_KEY', () => {
    expect(() => loadMasterKey({ envKey: 'dG9vIHNob3J0', dataDir: tmp() })).toThrow(/MASTER_KEY/);
  });
});
