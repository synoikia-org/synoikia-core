import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkManifest } from '@synoikia/plugin-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPlugin } from '../src/build.js';
import { checkPlugin } from '../src/check.js';
import { loadYamlModule, moduleSource } from '../src/files.js';
import { createRepoTool, repositoryFromRemote } from '../src/repo.js';
import { dependencyRange, findRepoRoot, PACKAGE_DIR } from '../src/repo-root.js';
import { createRepo, fill, manifestFor, newPlugin, validateId, validateNamespace } from '../src/scaffold.js';
import { pluginFiles } from '../src/vitest.js';
import { runWorkflow } from '../src/workflow/index.js';
import { syncWorkflow } from '../src/workflow/sync.js';

const RANGES = { sdk: '^0.3.0', core: '^0.5.0', cli: '^0.1.0' };
const tmp: string[] = [];
const work = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'synoikia-cli-'));
  tmp.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The smallest manifest `synoikia-plugin check` accepts, for packing tests. */
const packManifest = (id: string, version: string) => ({
  id,
  name: id,
  version,
  sdk: '^0.2.2',
  entry: 'dist/index.js',
  binding: { namespace: id, functions: ['call'] },
  connection: { schema: { type: 'object', properties: {} }, ui: {} },
  sensitiveKeys: [],
  network: { hosts: ['example.com'] },
});

describe('templates', () => {
  it('fills only known placeholders', () => {
    expect(fill('{{name}} at {{connection.baseUrl}} {{other}}', { name: 'Acme' })).toBe(
      'Acme at {{connection.baseUrl}} {{other}}',
    );
    expect(fill('{{constructor}}', {})).toBe('{{constructor}}');
  });

  it('refuses names that would break out of generated code', () => {
    const root = path.join(work(), 'r');
    createRepo({ dir: root, ranges: RANGES });
    for (const name of ["A'; process.exit(1); '", 'A"b', 'line\nbreak', 'back\\slash'])
      expect(
        () => newPlugin({ root, id: 'acme', name, archetype: 'blank', auth: 'none', ranges: RANGES }),
        name,
      ).toThrow(/Name/);
    expect(() =>
      newPlugin({
        root,
        id: 'acme',
        name: 'Acme',
        description: 'x`y',
        archetype: 'blank',
        auth: 'none',
        ranges: RANGES,
      }),
    ).toThrow(/Description/);
    expect(() => createRepo({ dir: path.join(work(), 'Bad"Name'), ranges: RANGES })).toThrow(/directory name/);
  });

  it('validates ids and namespaces', () => {
    expect(validateId('acme-box')).toBeUndefined();
    expect(validateId('Acme')).toBeDefined();
    expect(validateId('a')).toBeDefined();
    expect(validateNamespace('acmeBox')).toBeUndefined();
    expect(validateNamespace('catalog')).toMatch(/reserved/);
    expect(validateNamespace('acme-box')).toBeDefined();
  });

  it('generates manifests that pass the secret-field checks for every auth kind', () => {
    for (const auth of ['bearer', 'api-key', 'basic', 'none'] as const) {
      const m = manifestFor({ root: '', id: 'acme', name: 'Acme', archetype: 'openapi-rest', auth }, 'acme');
      expect(checkManifest(m), auth).toEqual([]);
    }
  });

  it('writes a repository with dotfiles, optional parts, and refuses a non-empty directory', () => {
    const dir = path.join(work(), 'my-plugins');
    createRepo({ dir, repository: 'me/my-plugins', claude: true, ranges: RANGES });
    for (const f of [
      '.gitignore',
      '.github/workflows/ci.yml',
      '.github/workflows/workflow.yml',
      '.githooks/pre-push',
      'docs/workflow.md',
      '.claude/settings.json',
      '.claude/skills/change-workflow/SKILL.md',
      '.claude/hooks/guard-branch.mjs',
      'CLAUDE.md',
      'plugins',
    ])
      expect(existsSync(path.join(dir, f)), f).toBe(true);
    expect(syncWorkflow(dir, true)).toEqual([]);
    expect(existsSync(path.join(dir, '.github/workflows/release.yml'))).toBe(false);
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg).toMatchObject({
      name: 'my-plugins',
      scripts: { new: 'synoikia-plugin new', workflow: 'synoikia-plugin workflow' },
      synoikia: { repository: 'me/my-plugins' },
      devDependencies: { '@synoikia/core': '^0.5.0', '@synoikia/create-plugin': '^0.1.0' },
    });
    expect(() => createRepo({ dir, ranges: RANGES })).toThrow(/not empty/);
    expect(() => createRepo({ dir: path.join(work(), 'x'), repository: 'bad repo', ranges: RANGES })).toThrow();
  });

  it('adds a plugin and refuses an existing or invalid one', () => {
    const root = path.join(work(), 'r');
    createRepo({ dir: root, ranges: RANGES });
    newPlugin({
      root,
      id: 'acme',
      name: 'Acme',
      archetype: 'static-rest',
      auth: 'api-key',
      apiKeyHeader: 'X-Token',
      ranges: RANGES,
    });
    const dir = path.join(root, 'plugins', 'acme');
    expect(readFileSync(path.join(dir, 'src/auth.ts'), 'utf8')).toContain("'x-token': apiKey");
    expect(JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))).toMatchObject({
      name: '@synoikia/plugin-acme',
      dependencies: { '@synoikia/plugin-sdk': '^0.3.0' },
    });
    expect(checkPlugin(dir)).toEqual([]);
    expect(findRepoRoot(dir)).toBe(root);
    expect(() => newPlugin({ root, id: 'acme', name: 'A', archetype: 'blank', auth: 'none', ranges: RANGES })).toThrow(
      /already exists/,
    );
    expect(() => newPlugin({ root, id: 'x', name: 'X', archetype: 'blank', auth: 'none', ranges: RANGES })).toThrow(
      /id/,
    );
    expect(() =>
      newPlugin({
        root,
        id: 'ok-id',
        name: 'X',
        namespace: 'registry',
        archetype: 'blank',
        auth: 'none',
        ranges: RANGES,
      }),
    ).toThrow(/reserved/);
    expect(() =>
      newPlugin({
        root,
        id: 'hdr',
        name: 'X',
        archetype: 'blank',
        auth: 'api-key',
        apiKeyHeader: 'x\r\ny',
        ranges: RANGES,
      }),
    ).toThrow(/header/);
  });

  it('resolves dependency ranges for generated packages', () => {
    expect(dependencyRange('@synoikia/create-plugin')).toMatch(/^\^\d/);
    expect(dependencyRange('@synoikia/plugin-sdk')).toMatch(/^\^\d/);
    expect(dependencyRange('yaml')).toBe('^2.9.1');
  });
});

describe('check', () => {
  it('reports version, id, plugin.yaml and manifest problems', () => {
    const root = path.join(work(), 'r');
    createRepo({ dir: root, ranges: RANGES });
    newPlugin({ root, id: 'acme', name: 'Acme', archetype: 'blank', auth: 'bearer', ranges: RANGES });
    const dir = path.join(root, 'plugins', 'acme');
    const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ ...manifest, version: '0.2.0', sensitiveKeys: [] }),
    );
    writeFileSync(path.join(dir, 'plugin.yaml'), 'rules:\n  - match: x\n    matchProfile: nope\n');
    expect(checkPlugin(dir)).toEqual([
      'connection.token: a secret field must be listed in sensitiveKeys',
      'plugin.yaml rules[0]: matchProfile "nope" is not in the manifest',
      'package.json version 0.1.0 and manifest.json version 0.2.0 differ',
    ]);
    writeFileSync(path.join(dir, 'plugin.yaml'), 'rules: [{ match: x, lockd: true }]\n');
    expect(checkPlugin(dir)[0]).toMatch(/^plugin.yaml: /);
    rmSync(path.join(dir, 'plugin.yaml'));
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, instructions: 'instructions.md' }));
    expect(checkPlugin(dir)).toEqual(['manifest.json: instructions instructions.md: not found']);
    writeFileSync(path.join(dir, 'instructions.md'), 'x'.repeat(4097));
    expect(checkPlugin(dir)).toEqual(['manifest.json: instructions instructions.md: is over 4096 bytes']);
    writeFileSync(path.join(dir, 'instructions.md'), 'Keys are `GET /path`.\n');
    expect(checkPlugin(dir)).toEqual([]);
    writeFileSync(path.join(dir, 'notes.md'), 'Keys are verbs.\n');
    rmSync(path.join(dir, 'instructions.md'));
    symlinkSync(path.join(dir, 'notes.md'), path.join(dir, 'instructions.md'));
    expect(checkPlugin(dir)).toEqual(['manifest.json: instructions instructions.md: is a symbolic link']);
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, instructions: '../x.md' }));
    expect(checkPlugin(dir)[0]).toMatch(/^manifest: instructions: /);
    expect(checkPlugin(path.join(root, 'nope'))[0]).toMatch(/^manifest.json: /);
  });
});

describe('data files', () => {
  it('inlines YAML and Markdown, and validates plugin.yaml', () => {
    const dir = work();
    writeFileSync(path.join(dir, 'guide.md'), '# Hi\n');
    writeFileSync(path.join(dir, 'data.yaml'), 'a: [1, 2]\n');
    writeFileSync(path.join(dir, 'plugin.yaml'), 'rules: [{ match: x, locked: true }]\n');
    expect(moduleSource(path.join(dir, 'guide.md'))).toBe('export default "# Hi\\n";\n');
    expect(moduleSource(path.join(dir, 'data.yaml'))).toBe('export default {"a":[1,2]};\n');
    expect(moduleSource(path.join(dir, 'x.ts'))).toBeUndefined();
    expect(loadYamlModule(path.join(dir, 'plugin.yaml'))).toEqual({ rules: [{ match: 'x', locked: true }] });
    writeFileSync(path.join(dir, 'plugin.yaml'), 'rule: []\n');
    expect(() => loadYamlModule(path.join(dir, 'plugin.yaml'))).toThrow(/not valid plugin settings/);
    writeFileSync(path.join(dir, 'bad.yaml'), 'a: [');
    expect(() => loadYamlModule(path.join(dir, 'bad.yaml'))).toThrow(/bad.yaml/);
    const bomb = [
      'a: &a [x,x,x,x,x,x,x,x,x,x]',
      ...Array.from(
        { length: 10 },
        (_, i) =>
          `${'b'.repeat(i + 1)}: &${'b'.repeat(i + 1)} [${Array(10)
            .fill(i ? `*${'b'.repeat(i)}` : '*a')
            .join(',')}]`,
      ),
    ].join('\n');
    writeFileSync(path.join(dir, 'bomb.yaml'), bomb);
    expect(() => loadYamlModule(path.join(dir, 'bomb.yaml'))).toThrow();
  });

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

  it('bundles plugin.yaml into a self-contained bundle', async () => {
    const dir = work();
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'plugin.yaml'), 'plugin: { greeting: hello }\n');
    writeFileSync(path.join(dir, 'src/index.ts'), "import s from '../plugin.yaml';\nconsole.log(JSON.stringify(s));\n");
    const out = await buildPlugin({ dir });
    const bundle = readFileSync(out, 'utf8');
    expect(bundle).toContain('createRequire');
    expect(bundle).not.toContain("from '../plugin.yaml'");
    expect(execFileSync(process.execPath, [out], { encoding: 'utf8' }).trim()).toBe('{"plugin":{"greeting":"hello"}}');
  });
});

describe('repo', () => {
  it('reads the repository from a GitHub remote', () => {
    expect(repositoryFromRemote('git@github.com:acme/plugins.git')).toBe('acme/plugins');
    expect(repositoryFromRemote('https://github.com/acme/plugins\n')).toBe('acme/plugins');
    expect(repositoryFromRemote('http://local_proxy@127.0.0.1:1/git/acme/plugins')).toBeUndefined();
  });

  it('packs deterministically, skips released versions and indexes signed tarballs', () => {
    const root = work();
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ synoikia: { repository: 'acme/plugins', name: 'Acme' } }),
    );
    writeFileSync(path.join(root, 'minisign.pub'), 'untrusted comment: minisign public key\nRWTESTKEY\n');
    for (const [id, version] of [
      ['one', '1.0.0'],
      ['two', '2.0.0'],
    ]) {
      const dir = path.join(root, 'plugins', id!);
      mkdirSync(path.join(dir, 'dist'), { recursive: true });
      const instructions = id === 'two' ? { instructions: 'docs/agent.md' } : {};
      writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify({ ...packManifest(id!, version!), ...instructions }),
      );
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `@acme/plugin-${id}`, version }));
      writeFileSync(path.join(dir, 'dist/index.js'), `// ${id}\n`);
      writeFileSync(path.join(dir, 'README.md'), 'not shipped\n');
    }
    mkdirSync(path.join(root, 'plugins/two/docs'));
    writeFileSync(path.join(root, 'plugins/two/docs/agent.md'), 'Keys are verbs.\n');
    const built: string[] = [];
    const logs: string[] = [];
    const tool = createRepoTool({ root, buildPlugin: (d) => built.push(path.basename(d)), log: (l) => logs.push(l) });
    expect(tool.repository).toBe('acme/plugins');
    const first = tool.pack();
    expect(first.map((r) => r.file)).toEqual(['one-1.0.0.tgz', 'two-2.0.0.tgz']);
    expect(built).toEqual(['one', 'two']);
    const listing = (file: string) =>
      execFileSync('tar', ['-tzf', path.join(tool.out, file)], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .sort();
    expect(listing('one-1.0.0.tgz')).toEqual(['dist/', 'dist/index.js', 'manifest.json', 'package.json']);
    expect(listing('two-2.0.0.tgz')).toEqual([
      'dist/',
      'dist/index.js',
      'docs/agent.md',
      'manifest.json',
      'package.json',
    ]);
    const again = tool.pack();
    expect(again.map((r) => r.sha256)).toEqual(first.map((r) => r.sha256));

    expect(() => tool.index()).toThrow(/not signed/);
    for (const r of first) writeFileSync(path.join(tool.out, `${r.file}.minisig`), 'sig');
    const idx = tool.index();
    expect(idx).toMatchObject({ name: 'Acme', homepage: 'https://github.com/acme/plugins', publicKey: 'RWTESTKEY' });
    expect(idx.plugins[0]!.versions[0]).toMatchObject({
      url: 'https://github.com/acme/plugins/releases/download/one-v1.0.0/one-1.0.0.tgz',
      signature: 'sig',
    });

    // Released versions are skipped; a mismatched key is refused.
    mkdirSync(path.join(root, '.repo-current'));
    writeFileSync(path.join(root, '.repo-current/index.json'), JSON.stringify(idx));
    expect(tool.pack()).toEqual([]);
    writeFileSync(path.join(root, '.repo-current/index.json'), JSON.stringify({ ...idx, publicKey: 'OTHER' }));
    expect(() => tool.pack()).toThrow(/different public key/);
    writeFileSync(path.join(root, 'plugins/one/package.json'), JSON.stringify({ version: '9.9.9' }));
    rmSync(path.join(root, '.repo-current'), { recursive: true });
    expect(() => tool.pack()).toThrow(/differ/);
  });

  it('refuses to pack a plugin that fails its checks', () => {
    const root = work();
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ synoikia: { repository: 'acme/plugins', name: 'Acme' } }),
    );
    writeFileSync(path.join(root, 'minisign.pub'), 'untrusted comment: minisign public key\nRWTESTKEY\n');
    const dir = path.join(root, 'plugins', 'one');
    mkdirSync(path.join(dir, 'dist'), { recursive: true });
    // Result secrets core masks only from contract 0.2.2, under a range older cores accept.
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...packManifest('one', '1.0.0'), sdk: '^0.2.1' }));
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@acme/plugin-one', version: '1.0.0' }));
    writeFileSync(path.join(dir, 'plugin.yaml'), 'rules:\n  - match: token.make\n    sensitiveResult: whole\n');
    const built: string[] = [];
    const tool = createRepoTool({ root, buildPlugin: (d) => built.push(d), log: () => undefined });
    expect(() => tool.pack()).toThrow(/plugins\/one: .*sensitiveResult/);
    expect(built).toEqual([]);
  });

  it('refuses an invalid repository name', () => {
    const root = work();
    writeFileSync(path.join(root, 'package.json'), '{}');
    expect(() => createRepoTool({ root, repository: 'not a repo' })).toThrow(/Invalid repository/);
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

  it('accepts a slice built spec, test, code', async () => {
    const root = repo();
    commit(root, 'spec: deny writes for viewers', { 'packages/core/features/gate/deny.feature': FEATURE });
    commit(root, 'test: steps for deny writes', { 'packages/core/features/gate/steps/deny.ts': 'export {};\n' });
    commit(root, 'feat: deny writes for viewers', { 'packages/core/src/index.ts': 'export const deny = true;\n' });
    for (const cmd of ['check-branch', 'check-features', 'check-prose', 'check-phases'])
      expect(await quiet([cmd, '--base', 'main'], root), cmd).toEqual({ code: 0, errors: [] });
    expect(await quiet(['pre-push', '--base', 'main'], root)).toEqual({ code: 0, errors: [] });
  });

  it('refuses a bad branch, mixed phases, new behavior tests and prose on added lines', async () => {
    const root = repo();
    sh(root, 'checkout', '-q', '-b', 'claude/serene-dijkstra-abei82');
    commit(root, 'feat: deny writes', {
      'packages/core/features/gate/deny.feature': FEATURE,
      'packages/core/src/index.ts': 'export const deny = true;\n',
      'packages/core/test/gate.test.ts': 'export {};\n',
      'docs/a.md': 'Old text; untouched.\n\nNew text; added.\n',
    });
    const branch = await quiet(['check-branch'], root);
    expect(branch.code).toBe(1);
    expect(branch.errors.join()).toMatch(/"claude" is not a component/);
    expect((await quiet(['check-phases', '--base', 'main'], root)).errors.join()).toMatch(
      /deny\.feature is outside the feat phase/,
    );
    expect((await quiet(['check-features', '--base', 'main'], root)).errors.join()).toMatch(
      /gate\.test\.ts: a new test file must be a pure-function unit test/,
    );
    expect((await quiet(['check-prose', '--base', 'main'], root)).errors).toEqual([
      'check-prose: docs/a.md:3: no semicolons. Write two sentences',
    ]);
  });

  it('checks the security line from the pull request event', async () => {
    const root = repo();
    commit(root, 'fix: tighten', { 'packages/core/src/index.ts': 'export const x = 1;\n' });
    const event = path.join(work(), 'event.json');
    const run = async (body: string) => {
      writeFileSync(event, JSON.stringify({ pull_request: { draft: false, body } }));
      process.env.GITHUB_EVENT_PATH = event;
      try {
        return (await quiet(['check-security-line', '--base', 'main'], root)).code;
      } finally {
        delete process.env.GITHUB_EVENT_PATH;
      }
    };
    expect(await run('Tightens it.')).toBe(1);
    expect(await run('Tightens it.\nSecurity audit: gate. No finding.')).toBe(0);
  });

  it('syncs the shared files and installs the hooks', async () => {
    const root = repo();
    expect((await quiet(['sync', '--check'], root)).code).toBe(1);
    expect((await quiet(['sync'], root)).code).toBe(0);
    expect(existsSync(path.join(root, 'docs/workflow.md'))).toBe(true);
    expect(existsSync(path.join(root, '.claude'))).toBe(false);
    expect(await quiet(['sync', '--check'], root)).toEqual({ code: 0, errors: [] });
    expect((await quiet(['hooks', 'install'], root)).code).toBe(0);
    expect(execFileSync('git', ['config', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).trim()).toBe('.githooks');
  });

  it('refuses to sync through a symlink', async () => {
    const root = repo();
    const outside = path.join(work(), 'outside.md');
    writeFileSync(outside, 'keep\n');
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    symlinkSync(outside, path.join(root, 'docs/workflow.md'));
    await expect(runWorkflow(['sync'], root)).rejects.toThrow(/symlink/);
    expect(readFileSync(outside, 'utf8')).toBe('keep\n');
  });

  it('reads branch names past pipes and redirects', () => {
    const hook = path.join(PACKAGE_DIR, 'templates/workflow/claude/_claude/hooks/guard-branch.mjs');
    const root = work();
    const decide = (command: string) =>
      execFileSync(process.execPath, [hook], {
        input: JSON.stringify({ tool_input: { command }, cwd: root }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        encoding: 'utf8',
      });
    for (const command of ['git push origin a$b 2>&1 | tail -1', 'git checkout -b x$y > /dev/null'])
      expect(JSON.parse(decide(command)), command).toMatchObject({
        hookSpecificOutput: { permissionDecision: 'deny' },
      });
    for (const command of [
      'git push origin HEAD 2>&1 | tail -1',
      'git push origin HEAD > /dev/null',
      'git diff | grep x',
      'git commit -m "fix: a\nA git push piped into tail, or redirected"',
    ])
      expect(decide(command), command).toBe('');
  });

  it('denies a branch name with shell characters before it runs a check', () => {
    const hook = path.join(PACKAGE_DIR, 'templates/workflow/claude/_claude/hooks/guard-branch.mjs');
    const root = work();
    for (const name of ['a"&calc&"b', 'a$(id)b', 'a`id`b']) {
      const out = execFileSync(process.execPath, [hook], {
        input: JSON.stringify({ tool_input: { command: `git checkout -b ${name}` }, cwd: root }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        encoding: 'utf8',
      });
      expect(JSON.parse(out), name).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    }
  });

  it('refuses credential files at commit time', async () => {
    const root = repo();
    put(root, '.env', 'TOKEN=x\n');
    sh(root, 'add', '.env');
    expect((await quiet(['pre-commit'], root)).errors.join()).toMatch(/\.env looks like a credential file/);
  });
});
