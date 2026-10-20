import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quickpickle } from 'quickpickle';
import type { ViteUserConfig } from 'vitest/config';
import { VerdictReporter } from './verdict.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The shipped compliance suite: the feature files of core's rules for plugins. */
export const SUITE_DIR = path.join(HERE, 'suite');
const STEPS = path.join(HERE, `steps${path.extname(fileURLToPath(import.meta.url))}`);

export interface ComplianceOptions {
  /** The plugin package directory, holding `manifest.json`, the built entry and `test/compliance.yaml`. */
  pluginDir: string;
  /** The plugin's own feature files, relative to `pluginDir`. */
  features?: string[];
  /** Step files for the plugin's own feature files, relative to `pluginDir`. */
  steps?: string[];
}

declare module 'vitest' {
  interface ProvidedContext {
    synoikiaPluginDir: string;
    synoikiaFeatureFiles: number;
  }
}

/** The vitest config that runs the compliance suite and the plugin's own feature files, and prints core's verdict. */
export function complianceConfig(opts: ComplianceOptions): ViteUserConfig {
  const pluginDir = path.resolve(opts.pluginDir);
  const features = opts.features ?? ['features/**/*.feature'];
  const files = [
    ...globSync('*.feature', { cwd: SUITE_DIR }),
    ...globSync(features, { cwd: pluginDir, exclude: (f) => f === 'node_modules' }),
  ];
  return {
    plugins: [quickpickle({ todoTags: ['@todo', '@wip', '@backlog'], stepTimeout: 60_000 })],
    test: {
      reporters: ['default', new VerdictReporter(pluginDir, SUITE_DIR)],
      projects: [
        {
          extends: true,
          test: {
            name: 'compliance',
            root: pluginDir,
            include: [path.join(SUITE_DIR, '*.feature'), ...features],
            exclude: [],
            setupFiles: [STEPS, ...(opts.steps ?? []).map((s) => path.resolve(pluginDir, s))],
            provide: { synoikiaPluginDir: pluginDir, synoikiaFeatureFiles: files.length },
            // One process runs the feature files one after another, so the plugin boots once for the run.
            isolate: false,
            fileParallelism: false,
            // isolated-vm requires --no-node-snapshot on Node >= 20.
            execArgv: ['--no-node-snapshot'],
            testTimeout: 120_000,
            hookTimeout: 120_000,
          },
        },
      ],
    },
  };
}
