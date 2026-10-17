import { describe, expect, it } from 'vitest';
import { checkBranch } from '../../src/workflow/branch.js';
import { globToRegExp } from '../../src/workflow/glob.js';

const COMPONENTS = ['core', 'admin-ui', 'ci', 'docs'];

describe('checkBranch', () => {
  it.each(['core/auth-refactoring', 'admin-ui/add-backups', 'ci/run-red-check-early', 'docs/fix-oauth2-guide'])(
    'accepts %s',
    (name) => expect(checkBranch(name, COMPONENTS)).toEqual([]),
  );

  it.each([
    ['claude/serene-dijkstra-abei82', /not a component/],
    ['core/serene-dijkstra-abei82', /looks generated/],
    ['core/fix', /1 word\./],
    ['core/one-two-three-four-five', /5 words/],
    ['core/Fix-Auth', /kebab-case/],
    ['core/release-2026-10-17', /date/],
    ['core/auth/refactoring', /<component>\/<summary>/],
    ['auth-refactoring', /<component>\/<summary>/],
  ])('refuses %s', (name, issue) => expect(checkBranch(name, COMPONENTS).join('\n')).toMatch(issue));

  it('skips ignored branches', () => {
    expect(checkBranch('dependabot/npm_and_yarn/vite-8.3.2', COMPONENTS, ['dependabot/**'])).toEqual([]);
    expect(checkBranch('main', COMPONENTS, ['main'])).toEqual([]);
  });
});

describe('globToRegExp', () => {
  it.each([
    ['**/features/**/*.feature', 'packages/core/features/gate/deny.feature', true],
    ['**/features/**/*.feature', 'features/deny.feature', true],
    ['**/features/**/*.feature', 'packages/core/features/gate/steps/deny.ts', false],
    ['packages/*/src/**', 'packages/core/src/gate/index.ts', true],
    ['packages/*/src/**', 'packages/core/test/gate.test.ts', false],
    ['docs/architecture/**', 'docs/architecture/models/base-model.c4', true],
    ['**/test/unit/**/*.test.ts', 'packages/core/test/unit/access.test.ts', true],
    ['**/test/unit/**/*.test.ts', 'packages/core/test/access.test.ts', false],
    ['a.b', 'axb', false],
  ])('%s matches %s: %s', (glob, file, match) => expect(globToRegExp(glob).test(file)).toBe(match));
});
