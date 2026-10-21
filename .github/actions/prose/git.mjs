import { execFileSync } from 'node:child_process';

/**
 * @param {string} root
 * @param {...string} args
 */
const git = (root, ...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trimEnd();

/** @param {string} text */
const lines = (text) => text.split('\n').filter(Boolean);

/** @param {string} cwd */
export const repoRoot = (cwd) => git(cwd, 'rev-parse', '--show-toplevel');

/**
 * @param {string} root
 * @param {string} base
 */
const mergeBase = (root, base) => git(root, 'merge-base', base, 'HEAD');

/**
 * @param {string} root
 * @param {string} base
 */
export const changedSince = (root, base) =>
  lines(git(root, 'diff', '--name-only', '--diff-filter=ACMR', `${mergeBase(root, base)}...HEAD`));

/**
 * Line numbers each file added since `base`.
 * @param {string} root
 * @param {string} base
 * @param {readonly string[]} files
 * @returns {Map<string, Set<number>>}
 */
export function addedLines(root, base, files) {
  /** @type {Map<string, Set<number>>} */
  const out = new Map();
  if (!files.length) return out;
  const diff = git(root, 'diff', '--unified=0', '--no-color', `${mergeBase(root, base)}...HEAD`, '--', ...files);
  /** @type {Set<number> | undefined} */
  let current;
  for (const line of diff.split('\n')) {
    const file = line.match(/^\+\+\+ b\/(.*)$/)?.[1];
    if (file) out.set(file, (current = new Set()));
    const hunk = line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
    if (hunk && current) for (let n = 0; n < Number(hunk[2] ?? 1); n++) current.add(Number(hunk[1]) + n);
  }
  return out;
}
