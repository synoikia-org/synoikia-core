import { describe, expect, it } from 'vitest';
import { applyRegistrySync } from '../src/catalog/registry.js';
import { seedInstance } from './helpers.js';

describe('registry mirror', () => {
  it('rejects malformed plugin output', () => {
    const { db, instanceId } = seedInstance();
    expect(() => applyRegistrySync(db, instanceId, [{ kind: 'area' }])).toThrow();
  });
});
