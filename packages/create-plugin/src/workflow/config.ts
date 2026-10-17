import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** `synoikia.workflow` in the root package.json; every key is optional. */
export interface WorkflowConfig {
  /** First segment of a branch name. Default: the directories under packages/ and plugins/, plus SHARED_COMPONENTS. */
  components: string[];
  /** Branches no name rule applies to. */
  ignoreBranches: string[];
  /** Feature files. */
  features: string[];
  /** Step definitions and the World: what a `test:` commit adds. */
  steps: string[];
  /** The architecture model: what an `arch:` commit changes. */
  architecture: string[];
  /** Test files that may be added: pure-function unit tests only. */
  unitTests: string[];
  /** Product code: a PR that changes it must show its scenarios red before green. */
  source: string[];
  /** Paths whose change needs a `Security audit:` line in the PR description. */
  securityPaths: string[];
  /** Prose the writing rules apply to. */
  prose: string[];
}

export const SHARED_COMPONENTS = ['ci', 'docs', 'skills', 'deps'];

export const DEFAULTS: Omit<WorkflowConfig, 'components'> = {
  ignoreBranches: ['main', 'dependabot/**', 'renovate/**', 'gh-readonly-queue/**'],
  features: ['**/features/**/*.feature'],
  steps: ['**/features/**/*.ts', '**/features/**/*.js'],
  architecture: ['docs/architecture/**'],
  unitTests: ['**/test/unit/**/*.test.ts'],
  source: ['packages/*/src/**', 'plugins/*/src/**', 'plugins/*/plugin.yaml'],
  securityPaths: [],
  prose: ['**/*.md', '**/*.feature'],
};

const subdirs = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((d) => statSync(path.join(dir, d)).isDirectory()) : [];

export function loadConfig(root: string): WorkflowConfig {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    synoikia?: { workflow?: Partial<WorkflowConfig> };
  };
  const own = pkg.synoikia?.workflow ?? {};
  const components = own.components ?? [
    ...subdirs(path.join(root, 'packages')),
    ...subdirs(path.join(root, 'plugins')),
    ...SHARED_COMPONENTS,
  ];
  return { ...DEFAULTS, ...own, components };
}
