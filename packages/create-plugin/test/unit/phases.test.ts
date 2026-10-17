import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../../src/workflow/config.js';
import { checkPhases, phaseOf } from '../../src/workflow/phases.js';
import type { Commit } from '../../src/workflow/phases.js';

let n = 0;
const commit = (subject: string, ...files: string[]): Commit => ({ sha: `${++n}`.padStart(7, '0'), subject, files });
const FEATURE = 'packages/core/features/gate/deny.feature';
const STEPS = 'packages/core/features/gate/steps/deny.ts';
const SRC = 'packages/core/src/gate/index.ts';

describe('phaseOf', () => {
  it.each([
    ['spec: deny a write', 'spec'],
    ['feat(core): deny a write', 'feat'],
    ['fix!: break it', 'fix'],
    ['Spec: deny', undefined],
    ['spec:deny', undefined],
    ['wip', undefined],
  ])('%s → %s', (subject, phase) => expect(phaseOf(subject)).toBe(phase));
});

describe('checkPhases', () => {
  it('accepts spec, test, feat and refactor in order and asks for red at the test commit', () => {
    const test = commit('test: steps for deny', STEPS);
    const r = checkPhases(
      [commit('spec: deny a write', FEATURE), test, commit('feat: deny writes', SRC), commit('refactor: tidy', SRC)],
      DEFAULTS,
    );
    expect(r.issues).toEqual([]);
    expect(r.redAt).toBe(test);
    expect(r.redFeatures).toEqual([FEATURE]);
  });

  it('refuses a commit without a phase prefix', () => {
    expect(checkPhases([commit('deny writes', SRC)], DEFAULTS).issues.join()).toMatch(/start the subject/);
  });

  it('refuses files outside the phase', () => {
    const issues = checkPhases(
      [commit('spec: deny', FEATURE, SRC), commit('test: steps', STEPS, SRC), commit('feat: x', FEATURE)],
      DEFAULTS,
    ).issues;
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => /outside the (spec|test|feat) phase/.test(i))).toBe(true);
  });

  it('refuses code with no test commit before it', () => {
    expect(
      checkPhases([commit('feat: deny writes', SRC), commit('test: steps', STEPS)], DEFAULTS).issues.join(),
    ).toMatch(/no test: commit before it/);
  });

  it('needs no red check for a refactor, docs or a backfill', () => {
    expect(checkPhases([commit('refactor: tidy', SRC), commit('docs: explain', 'docs/a.md')], DEFAULTS)).toEqual({
      issues: [],
      redAt: undefined,
      redFeatures: [],
    });
    const backfill = checkPhases(
      [commit('spec: x', FEATURE), commit('test: y', STEPS), commit('fix: z', SRC)],
      DEFAULTS,
      {
        backfill: true,
      },
    );
    expect(backfill.issues).toEqual([]);
    expect(backfill.redAt).toBeUndefined();
  });

  it('lets arch commits change only the model', () => {
    const issues = checkPhases(
      [commit('arch: place the gate', 'docs/architecture/models/gate.c4'), commit('docs: x', 'docs/architecture/x.c4')],
      DEFAULTS,
    ).issues;
    expect(issues).toEqual([expect.stringMatching(/docs\/architecture\/x\.c4 is outside the docs phase/)]);
  });
});
