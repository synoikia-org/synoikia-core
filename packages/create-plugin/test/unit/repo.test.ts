import { describe, expect, it } from 'vitest';
import { repositoryFromRemote } from '../../src/repo.js';

describe('repo', () => {
  it('reads the repository from a GitHub remote', () => {
    expect(repositoryFromRemote('git@github.com:acme/plugins.git')).toBe('acme/plugins');
    expect(repositoryFromRemote('https://github.com/acme/plugins\n')).toBe('acme/plugins');
    expect(repositoryFromRemote('http://local_proxy@127.0.0.1:1/git/acme/plugins')).toBeUndefined();
  });
});
