import { describe, expect, it } from 'vitest';
import { DEFAULT_PLUGIN_REPO } from '../../src/plugins/default-repo.js';
import { parsePublicKey } from '../../src/plugins/minisign.js';

describe('DEFAULT_PLUGIN_REPO', () => {
  it('ships a valid pre-configured repository key', () => {
    expect(parsePublicKey(DEFAULT_PLUGIN_REPO.publicKey).keyId).toBe('89B25CCABB076D83');
  });
});
