import { execFileSync, spawnSync } from 'node:child_process';
import type { Commit } from './phases.js';

export const git = (root: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trimEnd();

const lines = (text: string) => text.split('\n').filter(Boolean);

export const currentBranch = (root: string) =>
  process.env.GITHUB_HEAD_REF ||
  spawnSync('git', ['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();

export const mergeBase = (root: string, base: string) => git(root, 'merge-base', base, 'HEAD');

/** Commits after `base`, oldest first. A merge lists what its conflict resolution changed. */
export function commitsSince(root: string, base: string): Commit[] {
  return lines(git(root, 'rev-list', '--reverse', `${mergeBase(root, base)}..HEAD`)).map((sha) => {
    const parents = git(root, 'rev-list', '--parents', '-n', '1', sha).split(' ').length - 1;
    const files =
      parents > 1
        ? git(root, 'show', '--remerge-diff', '--format=', '--name-only', sha)
        : git(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha);
    return { sha, subject: git(root, 'log', '-1', '--format=%s', sha), files: lines(files) };
  });
}

export const changedSince = (root: string, base: string, filter = 'ACMR') =>
  lines(git(root, 'diff', '--name-only', `--diff-filter=${filter}`, `${mergeBase(root, base)}...HEAD`));

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

export const trackedFiles = (root: string, ref = 'HEAD') => lines(git(root, 'ls-tree', '-r', '--name-only', ref));

export const showFile = (root: string, ref: string, file: string) => {
  const r = spawnSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : undefined;
};

export const stagedFiles = (root: string) => lines(git(root, 'diff', '--cached', '--name-only', '--diff-filter=ACMRT'));
