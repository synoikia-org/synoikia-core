import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPlugin } from '../src/check.js';
import { dependencyRange, PACKAGE_DIR } from '../src/repo-root.js';
import { pluginFiles } from '../src/vitest.js';
import { runWorkflow } from '../src/workflow/index.js';

const tmp: string[] = [];
const work = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'synoikia-cli-'));
  tmp.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('templates', () => {
  it('resolves dependency ranges for generated packages', () => {
    expect(dependencyRange('yaml')).toBe('^2.9.1');
  });
});

describe('check', () => {
  it('reports a plugin folder without a manifest', () => {
    expect(checkPlugin(path.join(work(), 'nope'))[0]).toMatch(/^manifest.json: /);
  });
});

describe('data files', () => {
  it('gives vitest the same modules', () => {
    const dir = work();
    writeFileSync(path.join(dir, 'd.yaml'), 'n: 1\n');
    const plugin = pluginFiles();
    expect(plugin.transform('ignored', path.join(dir, 'd.yaml'))).toEqual({
      code: 'export default {"n":1};\n',
      map: null,
    });
    expect(plugin.transform('# x', '/a/guide.md?raw')).toEqual({ code: 'export default "# x";\n', map: null });
    expect(plugin.transform('code', '/a/x.ts')).toBeUndefined();
  });
});

describe('workflow', () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const put = (root: string, file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  const commit = (root: string, subject: string, files: Record<string, string>) => {
    for (const [f, t] of Object.entries(files)) put(root, f, t);
    sh(root, 'add', '-A');
    sh(root, 'commit', '-q', '-m', subject);
  };
  const FEATURE = `@id:deny-writes
Feature: Deny writes
  Rule: A read-only role cannot write
    Scenario: An agent with a read-only role tries to delete a pool
      Given agent 7 has the role "viewer" on instance "nas-01"
      When agent 7 deletes the pool "tank"
      Then agent 7 is told the role "viewer" cannot delete pools
`;
  const repo = () => {
    const root = work();
    sh(root, 'init', '-q', '-b', 'main');
    sh(root, 'config', 'user.email', 'a@b.c');
    sh(root, 'config', 'user.name', 'a');
    commit(root, 'chore: start', {
      'package.json': JSON.stringify({ name: 'r', synoikia: { workflow: { securityPaths: ['packages/*/src/**'] } } }),
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'packages/core/src/index.ts': 'export {};\n',
      'docs/a.md': 'Old text; untouched.\n',
    });
    sh(root, 'checkout', '-q', '-b', 'core/deny-writes');
    return root;
  };
  const quiet = async (argv: string[], root: string) => {
    const errors: string[] = [];
    const error = console.error;
    const log = console.log;
    const headRef = process.env.GITHUB_HEAD_REF;
    console.error = (m: string) => errors.push(m);
    console.log = () => undefined;
    delete process.env.GITHUB_HEAD_REF;
    try {
      return { code: await runWorkflow(argv, root), errors };
    } finally {
      console.error = error;
      console.log = log;
      if (headRef !== undefined) process.env.GITHUB_HEAD_REF = headRef;
    }
  };

  it('accepts a slice built spec, test, code at pre-push', async () => {
    const root = repo();
    commit(root, 'spec: deny writes for viewers', { 'packages/core/features/gate/deny.feature': FEATURE });
    commit(root, 'test: steps for deny writes', { 'packages/core/features/gate/steps/deny.ts': 'export {};\n' });
    commit(root, 'feat: deny writes for viewers', { 'packages/core/src/index.ts': 'export const deny = true;\n' });
    expect(await quiet(['pre-push', '--base', 'main'], root)).toEqual({ code: 0, errors: [] });
  });

  it('reports missing shared files and syncs only the base ones', async () => {
    const root = repo();
    expect((await quiet(['sync', '--check'], root)).code).toBe(1);
    expect((await quiet(['sync'], root)).code).toBe(0);
    expect(existsSync(path.join(root, 'docs/workflow.md'))).toBe(true);
    expect(existsSync(path.join(root, '.claude'))).toBe(false);
  });

  it('reads branch names past redirects and commit messages', () => {
    const hook = path.join(PACKAGE_DIR, 'templates/workflow/claude/_claude/hooks/guard-branch.mjs');
    const root = work();
    const decide = (command: string) =>
      execFileSync(process.execPath, [hook], {
        input: JSON.stringify({ tool_input: { command }, cwd: root }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        encoding: 'utf8',
      });
    for (const command of [
      'git push origin HEAD > /dev/null',
      'git commit -m "fix: a\nA git push piped into tail, or redirected"',
    ])
      expect(decide(command), command).toBe('');
  });
});
