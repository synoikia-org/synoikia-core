import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { ARCHETYPE_FLAGS, AUTH_FLAGS, PACKAGE_DIR, TSC, VITEST } from '../../support/world.js';
import type { PluginAuthorWorld } from '../../support/world.js';

const versionOf = (pkg: string) =>
  (JSON.parse(readFileSync(path.join(PACKAGE_DIR, '..', pkg, 'package.json'), 'utf8')) as { version: string }).version;

const flag = (map: Record<string, string>, text: string) => {
  const value = map[text];
  if (!value) throw new Error(`The World has no "${text}"`);
  return value;
};

Given('plugin author 3 has an empty folder {string}', (world: PluginAuthorWorld, name: string) => {
  world.repo = path.join(world.dir, name);
  mkdirSync(world.repo);
});

Given('plugin author 3 has a folder {string} with a file', (world: PluginAuthorWorld, name: string) => {
  world.repo = path.join(world.dir, name);
  mkdirSync(world.repo);
  writeFileSync(path.join(world.repo, 'notes.txt'), 'Ideas for Acme Tasks\n');
});

Given('plugin author 3 has the plugin repository {string}', (world: PluginAuthorWorld, name: string) => {
  world.create(name, '--repository', 'acme/plugins', '--no-plugin');
  expect(world.last?.code, world.last?.stderr).toBe(0);
});

When(
  'plugin author 3 creates a plugin repository in {string} for {string} with the assistant files',
  (world: PluginAuthorWorld, name: string, repository: string) => {
    world.create(name, '--repository', repository, '--claude', '--no-plugin');
  },
);

When(
  'plugin author 3 creates a plugin repository in {string} for {string}',
  (world: PluginAuthorWorld, name: string, repository: string) => {
    world.create(name, '--repository', repository, '--no-plugin');
  },
);

Then(
  'the repository has its hidden files, CI, the assistant files and a plugins folder',
  (world: PluginAuthorWorld) => {
    expect(world.last?.code, world.last?.stderr).toBe(0);
    for (const f of [
      '.gitignore',
      '.nvmrc',
      '.github/workflows/ci.yml',
      '.claude/settings.json',
      '.claude/guard-paths.json',
      '.claude/hooks/session-start.sh',
      'CLAUDE.md',
      'plugins',
    ])
      expect(existsSync(world.file(f)), f).toBe(true);
  },
);

Then(
  'the repository package names {string}, the script {string}, and the ranges of core and the plugin tool',
  (world: PluginAuthorWorld, repository: string, script: string) => {
    expect(world.readJson('package.json')).toMatchObject({
      name: path.basename(world.repo),
      scripts: { [script]: `synoikia-plugin ${script}` },
      synoikia: { repository },
      devDependencies: {
        '@synoikia/core': `^${versionOf('core')}`,
        '@synoikia/create-plugin': `^${versionOf('create-plugin')}`,
      },
    });
  },
);

Then('the repository has no release workflow, no workflow checks and no git hooks', (world: PluginAuthorWorld) => {
  for (const f of ['.github/workflows/release.yml', '.github/workflows/workflow.yml', '.githooks', 'docs/workflow.md'])
    expect(existsSync(world.file(f)), f).toBe(false);
  const pkg = world.readJson<{ scripts?: Record<string, string>; synoikia?: Record<string, unknown> }>('package.json');
  expect(Object.values(pkg.scripts ?? {}).join('\n')).not.toContain('workflow');
  expect(pkg.synoikia).not.toHaveProperty('workflow');
});

Then('the repository has no assistant files', (world: PluginAuthorWorld) => {
  expect(world.last?.code, world.last?.stderr).toBe(0);
  for (const f of ['.claude', 'CLAUDE.md']) expect(existsSync(world.file(f)), f).toBe(false);
});

Then('the repository has a secret scan setting that keeps the default rules', (world: PluginAuthorWorld) => {
  expect(world.last?.code, world.last?.stderr).toBe(0);
  expect(existsSync(world.file('.gitleaks.toml')), '.gitleaks.toml').toBe(true);
  expect(world.read('.gitleaks.toml')).toMatch(/^\s*\[extend\][^[]*^\s*useDefault\s*=\s*true\b/m);
  expect(world.read('.gitleaks.toml')).not.toMatch(/^\s*\[+allowlists?\]+/m);
});

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name));

Then(
  'the assistant settings enable the plugin development plugin of the Synoikia dev kit',
  (world: PluginAuthorWorld) => {
    expect(world.last?.code, world.last?.stderr).toBe(0);
    const settings = world.readJson<{ enabledPlugins?: Record<string, boolean> }>('.claude/settings.json');
    expect(settings).toMatchObject({
      extraKnownMarketplaces: {
        'synoikia-dev-kit': { source: { source: 'github', repo: 'synoikia-org/synoikia-dev-kit' } },
      },
    });
    expect(settings.enabledPlugins).toEqual({ 'synoikia-plugin-dev@synoikia-dev-kit': true });
  },
);

Then('a session start hook recommends the plugin when it is not loaded', (world: PluginAuthorWorld) => {
  const settings = world.readJson<{ hooks?: { SessionStart?: { hooks: { command: string }[] }[] } }>(
    '.claude/settings.json',
  );
  expect(settings.hooks?.SessionStart?.[0]?.hooks[0]?.command).toContain('.claude/hooks/session-start.sh');
  world.run(process.execPath, ['.claude/hooks/check-plugins.mjs', 'recommended', 'synoikia-plugin-dev'], {
    env: { CLAUDE_CODE_EXECPATH: process.execPath },
  });
  expect(world.last?.code, world.last?.stderr).toBe(0);
  const out = JSON.parse(world.last?.stdout ?? '') as {
    systemMessage: string;
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart');
  expect(out.systemMessage).toContain('`synoikia-plugin-dev` are recommended');
  expect(out.hookSpecificOutput.additionalContext).not.toContain('Do not change files');
});

Then(
  'the repository has no skills or agents of its own, and no assistant file names e2e tests or golden records',
  (world: PluginAuthorWorld) => {
    for (const f of ['.claude/skills', '.claude/agents']) expect(existsSync(world.file(f)), f).toBe(false);
    for (const f of [...filesUnder(world.file('.claude')), world.file('CLAUDE.md')])
      expect(readFileSync(f, 'utf8'), path.relative(world.repo, f)).not.toMatch(/e2e|__golden__|golden (record|test)/i);
  },
);

Then('the create command fails with {string}', (world: PluginAuthorWorld, message: string) => {
  expect(world.last?.code).toBe(1);
  expect(world.last?.stderr).toContain(message);
});

Then('the new command fails with {string}', (world: PluginAuthorWorld, message: string) => {
  expect(world.last?.code).toBe(1);
  expect(world.last?.stderr).toContain(message);
});

Then('the folder {string} is empty', (world: PluginAuthorWorld, rel: string) => {
  expect(readdirSync(world.file(rel))).toEqual([]);
});

const restPlugin = (world: PluginAuthorWorld, id: string, name: string, header: string) => {
  world.plugin = id;
  return world.newPlugin(
    ...['--id', id, '--name', name, '--archetype', 'static-rest', '--auth', 'api-key', '--api-key-header', header],
  );
};

When(
  'plugin author 3 adds the plugin {string} named {string} for a REST service without a spec, with the key header {string}',
  (world: PluginAuthorWorld, id: string, name: string, header: string) => {
    restPlugin(world, id, name, header);
  },
);

Given('the repository has the plugin {string}', (world: PluginAuthorWorld, id: string) => {
  expect(restPlugin(world, id, 'Acme Tasks', 'X-Token').code, world.last?.stderr).toBe(0);
});

Then(
  'the folder {string} has a manifest, a package, plugin.yaml and the plugin code',
  (world: PluginAuthorWorld, rel: string) => {
    expect(world.last?.code, world.last?.stderr).toBe(0);
    for (const f of ['manifest.json', 'package.json', 'plugin.yaml', 'src/index.ts', 'src/plugin.ts', 'src/auth.ts'])
      expect(existsSync(world.file(path.join(rel, f))), f).toBe(true);
  },
);

Then('the plugin sends the API key in the header {string}', (world: PluginAuthorWorld, header: string) => {
  expect(world.read(`plugins/${world.plugin}/src/auth.ts`)).toContain(`'${header}': apiKey`);
});

const checkIsClean = (world: PluginAuthorWorld) => {
  const check = world.cli('check', `plugins/${world.plugin}`);
  expect(check.stderr).toBe('');
  expect(check.code).toBe(0);
  expect(check.stdout).toContain('checked 1 plugin(s)');
};

Then(
  'the plugin package is {string} and the plugin check reports no problems',
  (world: PluginAuthorWorld, name: string) => {
    expect(world.readJson(`plugins/${world.plugin}/package.json`)).toMatchObject({ name });
    checkIsClean(world);
  },
);

When(
  'plugin author 3 adds the plugin {string} with the namespace {string}',
  (world: PluginAuthorWorld, id: string, namespace: string) => {
    world.newPlugin('--id', id, '--namespace', namespace, '--archetype', 'blank', '--auth', 'none');
  },
);

When(
  'plugin author 3 adds the plugin {string} with the name {string}',
  (world: PluginAuthorWorld, id: string, name: string) => {
    world.newPlugin('--id', id, '--name', name, '--archetype', 'blank', '--auth', 'none');
  },
);

When(
  'plugin author 3 adds the plugin {string} with the description {string}',
  (world: PluginAuthorWorld, id: string, description: string) => {
    world.newPlugin('--id', id, '--description', description, '--archetype', 'blank', '--auth', 'none');
  },
);

When(
  'plugin author 3 adds the plugin {string} with an API key header that holds a line break',
  (world: PluginAuthorWorld, id: string) => {
    restPlugin(world, id, 'Acme Tasks', 'X-Token\r\nX-Other: 1');
  },
);

Then('the manifest of {string} still names {string}', (world: PluginAuthorWorld, id: string, name: string) => {
  expect(world.readJson(`plugins/${id}/manifest.json`)).toMatchObject({ name });
});

When(
  'plugin author 3 adds the plugin {string} for {} that uses {}',
  (world: PluginAuthorWorld, id: string, kind: string, auth: string) => {
    world.plugin = id;
    world.newPlugin('--id', id, '--archetype', flag(ARCHETYPE_FLAGS, kind), '--auth', flag(AUTH_FLAGS, auth));
    expect(world.last?.code, world.last?.stderr).toBe(0);
  },
);

Then('the plugin check reports no problems', (world: PluginAuthorWorld) => {
  checkIsClean(world);
});

Then(
  'the plugin code has no unfilled placeholder, and the manifest still names the host {string}',
  (world: PluginAuthorWorld, host: string) => {
    for (const f of ['src/plugin.ts', 'src/index.ts', 'README.md', 'plugin.yaml'])
      expect(world.read(`plugins/${world.plugin}/${f}`), f).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
    expect(world.readJson(`plugins/${world.plugin}/manifest.json`)).toMatchObject({ network: { hosts: [host] } });
  },
);

Then(
  'the plugin check, the type check, the build and the plugin tests of {string} pass',
  (world: PluginAuthorWorld, id: string) => {
    const dir = world.file(`plugins/${id}`);
    world.must('synoikia-plugin', ['check'], dir);
    world.must(process.execPath, [TSC, '-p', 'tsconfig.json', '--customConditions', 'synoikia-source'], dir);
    world.must('synoikia-plugin', ['build', '--conditions', 'synoikia-source'], dir);
    // The repository's vitest.shared.ts, with the plugin-files loader taken from this checkout.
    writeFileSync(
      world.file('vitest.features.mts'),
      `import { defineConfig } from 'vitest/config';
import { pluginFiles } from ${JSON.stringify(path.join(PACKAGE_DIR, 'src/vitest.ts'))};
const conditions = ['synoikia-source', 'module', 'node', 'development|production'];
export default defineConfig({
  plugins: [pluginFiles()],
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  // The unit tests only: a kind with a fake upstream has none, and the compliance suite has its own scenario.
  test: { include: ['test/**/*.test.ts'], passWithNoTests: true, execArgv: ['--no-node-snapshot'], testTimeout: 60000, hookTimeout: 60000 },
});
`,
    );
    world.must(process.execPath, [VITEST, 'run', '--root', dir, '--config', world.file('vitest.features.mts')], dir);
  },
);

Then(
  'the compliance suite of core certifies {string} {word} for production',
  (world: PluginAuthorWorld, id: string, version: string) => {
    const dir = world.file(`plugins/${id}`);
    world.must('synoikia-plugin', ['build', '--conditions', 'synoikia-source'], dir);
    // The plugin's vitest.config.ts, with core and the plugin-files loader taken from this checkout.
    writeFileSync(
      world.file('vitest.compliance.mts'),
      `import { defineConfig, mergeConfig } from 'vitest/config';
import { complianceConfig } from ${JSON.stringify(path.join(PACKAGE_DIR, '../core/src/testing/compliance/index.ts'))};
import { pluginFiles } from ${JSON.stringify(path.join(PACKAGE_DIR, 'src/vitest.ts'))};
const conditions = ['synoikia-source', 'module', 'node', 'development|production'];
export default mergeConfig(
  defineConfig({ plugins: [pluginFiles()], resolve: { conditions }, ssr: { resolve: { conditions } } }),
  complianceConfig({ pluginDir: ${JSON.stringify(dir)} }),
);
`,
    );
    const r = world.run(
      process.execPath,
      [VITEST, 'run', '--root', dir, '--config', world.file('vitest.compliance.mts')],
      {
        cwd: dir,
        env: { NO_COLOR: '1' },
      },
    );
    const name = (JSON.parse(world.read(`plugins/${id}/manifest.json`)) as { name: string }).name;
    const output = `${r.stdout}\n${r.stderr}`;
    expect(output, output).toContain(`${name} ${version} is fit for production.`);
  },
);
