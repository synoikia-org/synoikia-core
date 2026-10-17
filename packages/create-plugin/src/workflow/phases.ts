import type { WorkflowConfig } from './config.js';
import { matchesAny } from './glob.js';

export interface Commit {
  sha: string;
  subject: string;
  files: string[];
}

export const PHASES = ['spec', 'arch', 'test', 'feat', 'fix', 'refactor', 'docs', 'chore', 'ci'] as const;
export type Phase = (typeof PHASES)[number];
const PREFIX = new RegExp(`^(${PHASES.join('|')})(?:\\([a-z0-9-]+\\))?!?: \\S`);

export const phaseOf = (subject: string) => subject.match(PREFIX)?.[1] as Phase | undefined;

type Paths = Pick<WorkflowConfig, 'features' | 'steps' | 'architecture' | 'unitTests' | 'source'>;

const TESTS = ['**/test/**', '**/*.test.ts', '**/*.spec.ts'];

/** What each phase may change. */
function allowed(phase: Phase, file: string, paths: Paths): boolean {
  const feature = matchesAny(file, paths.features);
  const model = matchesAny(file, paths.architecture);
  if (phase === 'spec') return feature;
  if (phase === 'arch') return model;
  if (phase === 'test') return matchesAny(file, [...paths.steps, ...TESTS, ...paths.unitTests]);
  return !feature && !model;
}

export interface PhaseResult {
  issues: string[];
  /** The last `test:` commit before the first code commit: its new scenarios must fail there. */
  redAt?: Commit;
  /** Feature files that the spec and test commits changed. */
  redFeatures: string[];
}

/** Commits of a branch, oldest first: one phase each, and code changes come after a red test commit. */
export function checkPhases(commits: readonly Commit[], paths: Paths, opts: { backfill?: boolean } = {}): PhaseResult {
  const issues: string[] = [];
  const redFeatures = new Set<string>();
  let lastTest: Commit | undefined;
  let redAt: Commit | undefined;
  let needsRed = false;
  for (const c of commits) {
    const short = `${c.sha.slice(0, 7)} ${c.subject}`;
    const phase = phaseOf(c.subject);
    if (!phase) {
      issues.push(`${short}: start the subject with one of ${PHASES.map((p) => `${p}:`).join(' ')}`);
      continue;
    }
    for (const f of c.files) if (!allowed(phase, f, paths)) issues.push(`${short}: ${f} is outside the ${phase} phase`);
    if (phase === 'spec' || phase === 'test')
      for (const f of c.files) if (matchesAny(f, paths.features)) redFeatures.add(f);
    if (phase === 'test') lastTest = c;
    if ((phase === 'feat' || phase === 'fix') && c.files.some((f) => matchesAny(f, paths.source)) && !redAt) {
      needsRed = true;
      redAt = lastTest;
    }
  }
  if (needsRed && !opts.backfill && (!redAt || !redFeatures.size))
    issues.push('a feat: or fix: commit changes code with no test: commit before it. Show the scenarios red first');
  return { issues, redAt: opts.backfill ? undefined : redAt, redFeatures: [...redFeatures] };
}
