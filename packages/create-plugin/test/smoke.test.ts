import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPlugin } from '../src/build.js';
import { checkPlugin } from '../src/check.js';
import { PACKAGE_DIR } from '../src/repo-root.js';
import { createRepo, newPlugin } from '../src/scaffold.js';
import type { Archetype, AuthKind } from '../src/scaffold.js';

// The pairs that no @long-running scaffold scenario builds. Every template scaffolded fresh passes check, typecheck, build and the compliance suite.

const SMOKE = path.join(PACKAGE_DIR, '.smoke');
const require = createRequire(import.meta.url);
const TSC = require.resolve('typescript/bin/tsc');
const VITEST = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const RANGES = { sdk: 'workspace:*', core: 'workspace:*', cli: 'workspace:*' };

const CASES: [Archetype, AuthKind][] = [
  ['openapi-rest', 'api-key'],
  ['openapi-rest', 'basic'],
  ['openapi-rest', 'none'],
];

const only = process.env.SMOKE_ONLY;

describe.each(CASES.filter(([a, auth]) => !only || only === `${a}-${auth}`))('%s with %s auth', (archetype, auth) => {
  it('checks, typechecks, builds and passes its own tests', async () => {
    const root = path.join(SMOKE, `${archetype}-${auth}`);
    rmSync(root, { recursive: true, force: true });
    createRepo({ dir: root, repository: 'acme/plugins', release: true, claude: true, ranges: RANGES });
    newPlugin({ root, id: 'acme-box', name: 'Acme Box', archetype, auth, ranges: RANGES });
    const dir = path.join(root, 'plugins', 'acme-box');

    expect(checkPlugin(dir)).toEqual([]);
    for (const f of ['manifest.json', 'plugin.yaml', 'src/plugin.ts', 'src/auth.ts', 'README.md']) {
      expect(existsSync(path.join(dir, f)), f).toBe(true);
    }
    expect(readFileSync(path.join(dir, 'src/plugin.ts'), 'utf8')).not.toMatch(/\{\{[a-zA-Z]+\}\}/);

    execFileSync(
      process.execPath,
      [TSC, '-p', path.join(dir, 'tsconfig.json'), '--customConditions', 'synoikia-source'],
      {
        stdio: 'pipe',
      },
    );
    await buildPlugin({ dir, conditions: ['synoikia-source'] });

    // The plugin's vitest.config.ts: the compliance suite, with core and the plugin-files loader from this checkout.
    const config = path.join(root, 'vitest.smoke.mts');
    writeFileSync(
      config,
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
    let output: string;
    try {
      output = execFileSync(process.execPath, [VITEST, 'run', '--root', dir, '--config', config], {
        stdio: 'pipe',
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      throw new Error(`generated tests failed:\n${e.stdout ?? ''}\n${e.stderr ?? ''}`, { cause: err });
    }
    expect(output).toContain('Acme Box 0.1.0 is fit for production.');
  });
});
