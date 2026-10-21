import { execFileSync } from 'node:child_process';

const git = (root: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trimEnd();

const lines = (text: string) => text.split('\n').filter(Boolean);

export const repoRoot = (cwd: string) => git(cwd, 'rev-parse', '--show-toplevel');

const mergeBase = (root: string, base: string) => git(root, 'merge-base', base, 'HEAD');

export const changedSince = (root: string, base: string) =>
  lines(git(root, 'diff', '--name-only', '--diff-filter=ACMR', `${mergeBase(root, base)}...HEAD`));

/** Line numbers each file added since `base`. */
export function addedLines(root: string, base: string, files: readonly string[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  if (!files.length) return out;
  const diff = git(root, 'diff', '--unified=0', '--no-color', `${mergeBase(root, base)}...HEAD`, '--', ...files);
  let current: Set<number> | undefined;
  for (const line of diff.split('\n')) {
    const file = line.match(/^\+\+\+ b\/(.*)$/)?.[1];
    if (file) out.set(file, (current = new Set()));
    const hunk = line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
    if (hunk && current) for (let n = 0; n < Number(hunk[2] ?? 1); n++) current.add(Number(hunk[1]) + n);
  }
  return out;
}
