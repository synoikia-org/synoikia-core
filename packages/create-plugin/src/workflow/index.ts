import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkBranch } from './branch.js';
import { loadConfig } from './config.js';
import type { WorkflowConfig } from './config.js';
import { checkFeatures, checkSlice } from './features.js';
import type { SourceFile } from './features.js';
import {
  addedLines,
  changedSince,
  commitsSince,
  currentBranch,
  git,
  mergeBase,
  showFile,
  stagedFiles,
  trackedFiles,
} from './git.js';
import { matchesAny } from './glob.js';
import { checkPhases } from './phases.js';
import { checkProse } from './prose.js';
import { featuresFailAt } from './red.js';
import { credentialPaths } from './secrets.js';
import { checkSecurityLine } from './security-line.js';
import { syncWorkflow } from './sync.js';
import { unlistedTests } from './tests.js';

export const WORKFLOW_USAGE = `synoikia-plugin workflow <command>   (rules: docs/workflow.md)

  check-branch [name]                    Branch name (default: the PR head or the current branch)
  check-phases --base <ref> [--red-green] [--backfill]
                                         One phase per commit. --red-green runs the scenarios at the test: commit
  check-features [--base <ref>] [--backfill]
                                         Feature files. With --base: the slice size and new test files
  check-prose [--base <ref>] [--pr-body] [files...]
                                         Writing rules on files, on lines added since <ref>, or on the PR description
  check-security-line --base <ref>       A ready PR that changes a security path has a "Security audit:" line
  pre-commit                             Credential file names, then gitleaks on staged changes when installed
  pre-push [--base <ref>]                check-branch, check-features, check-prose and check-phases (default base origin/main)
  hooks install                          Use .githooks for this clone
  sync [--check]                         Write the shared workflow files, or list the ones out of date
`;

const OPTIONS = {
  base: { type: 'string' },
  'red-green': { type: 'boolean' },
  backfill: { type: 'boolean' },
  'pr-body': { type: 'boolean' },
  check: { type: 'boolean' },
} as const;

interface Ctx {
  root: string;
  config: WorkflowConfig;
}

const report = (title: string, issues: readonly string[]) => {
  for (const issue of issues) console.error(`${title}: ${issue}`);
  return issues.length ? 1 : 0;
};

const pullRequest = (): { draft: boolean; body: string | null } | undefined => {
  const file = process.env.GITHUB_EVENT_PATH;
  if (!file) return undefined;
  return (JSON.parse(readFileSync(file, 'utf8')) as { pull_request?: { draft: boolean; body: string | null } })
    .pull_request;
};

function branch({ root, config }: Ctx, name?: string): number {
  const branchName = name ?? currentBranch(root);
  if (!branchName) return report('check-branch', ['no branch (detached HEAD). Pass the name']);
  return report('check-branch', checkBranch(branchName, config.components, config.ignoreBranches));
}

const readFeatures = (root: string, ref: string | undefined, config: WorkflowConfig): SourceFile[] =>
  trackedFiles(root, ref ?? 'HEAD')
    .filter((f) => matchesAny(f, config.features))
    .map((f) => ({ path: f, text: (ref ? showFile(root, ref, f) : readFileSync(path.join(root, f), 'utf8')) ?? '' }));

function features({ root, config }: Ctx, base: string | undefined, backfill: boolean): number {
  const issues = checkFeatures(readFeatures(root, undefined, config));
  if (base) {
    if (!backfill)
      issues.push(
        ...checkSlice(readFeatures(root, mergeBase(root, base), config), readFeatures(root, undefined, config)),
      );
    issues.push(...unlistedTests(changedSince(root, base, 'A'), config.unitTests));
  }
  return report('check-features', issues);
}

function prose({ root, config }: Ctx, base: string | undefined, prBody: boolean, files: string[]): number {
  const issues: string[] = [];
  if (files.length) for (const f of files) issues.push(...checkProse(f, readFileSync(path.join(root, f), 'utf8')));
  else if (base) {
    const changed = changedSince(root, base).filter((f) => matchesAny(f, config.prose));
    const added = addedLines(root, base, changed);
    for (const f of changed)
      issues.push(...checkProse(f, readFileSync(path.join(root, f), 'utf8'), added.get(f) ?? new Set()));
  }
  if (prBody) {
    const pr = pullRequest();
    if (pr?.body) issues.push(...checkProse('PR description', pr.body.replace(/\r\n/g, '\n')));
  }
  return report('check-prose', issues);
}

function phases({ root, config }: Ctx, base: string, redGreen: boolean, backfill: boolean): number {
  const result = checkPhases(commitsSince(root, base), config, { backfill });
  if (result.issues.length || !redGreen || !result.redAt) return report('check-phases', result.issues);
  const sha = result.redAt.sha;
  console.log(
    `check-phases: running ${result.redFeatures.length} feature file(s) at ${sha.slice(0, 7)}, expecting red`,
  );
  if (!featuresFailAt(root, sha, result.redFeatures))
    return report('check-phases', [
      `the scenarios pass at ${sha.slice(0, 7)} ${result.redAt.subject}. Commit the steps before the code, so they fail first`,
    ]);
  console.log('check-phases: red at the test: commit. CI runs them green at the head');
  return 0;
}

function securityLine({ root, config }: Ctx, base: string): number {
  const pr = pullRequest();
  if (!pr) return report('check-security-line', ['no pull request event (GITHUB_EVENT_PATH)']);
  return report('check-security-line', checkSecurityLine(pr, changedSince(root, base, 'ACMRD'), config.securityPaths));
}

function preCommit({ root }: Ctx): number {
  const found = credentialPaths(stagedFiles(root));
  if (found.length)
    return report(
      'pre-commit',
      found.map((f) => `${f} looks like a credential file. If it is tracked already: git rm --cached ${f}`),
    );
  const leaks = spawnSync('gitleaks', ['git', '--staged', '--no-banner', '--redact'], { cwd: root, stdio: 'inherit' });
  if (leaks.error) return 0;
  return leaks.status === 0 ? 0 : report('pre-commit', ['gitleaks found a secret in the staged changes']);
}

export async function runWorkflow(argv: string[], root: string): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: OPTIONS });
  const ctx: Ctx = { root, config: loadConfig(root) };
  const base = values.base;
  const needBase = () => {
    if (!base) throw new Error(`${command} needs --base <ref>`);
    return base;
  };
  switch (command) {
    case 'check-branch':
      return branch(ctx, positionals[0]);
    case 'check-phases':
      return phases(ctx, needBase(), !!values['red-green'], !!values.backfill);
    case 'check-features':
      return features(ctx, base, !!values.backfill);
    case 'check-prose':
      return prose(ctx, base, !!values['pr-body'], positionals);
    case 'check-security-line':
      return securityLine(ctx, needBase());
    case 'pre-commit':
      return preCommit(ctx);
    case 'pre-push': {
      const b = base ?? 'origin/main';
      if (currentBranch(root) === 'main') return 0;
      git(root, 'rev-parse', '--verify', '--quiet', b);
      return branch(ctx) | features(ctx, b, false) | prose(ctx, b, false, []) | phases(ctx, b, false, false);
    }
    case 'hooks':
      if (positionals[0] !== 'install') break;
      git(root, 'config', 'core.hooksPath', '.githooks');
      console.log('git hooks: .githooks');
      return 0;
    case 'sync': {
      const changed = syncWorkflow(root, !!values.check);
      if (values.check)
        return report(
          'sync',
          changed.map((f) => `${f} differs from the template. Run the sync`),
        );
      console.log(changed.length ? `wrote ${changed.join(', ')}` : 'workflow files are current');
      return 0;
    }
  }
  console.error(WORKFLOW_USAGE);
  return 2;
}
