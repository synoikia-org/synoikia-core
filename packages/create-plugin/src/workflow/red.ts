import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { git } from './git.js';

const run = (cwd: string, cmd: string, args: string[]) =>
  spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' } }).status ?? 1;

/** The nearest directory up from `file` with a package.json, below `root`. */
function packageOf(root: string, file: string): string {
  let dir = path.dirname(path.join(root, file));
  while (dir !== root && !existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
  return dir;
}

/** Runs the feature files at `sha` in a temporary worktree. True when at least one package fails. */
export function featuresFailAt(root: string, sha: string, features: readonly string[]): boolean {
  const dir = mkdtempSync(path.join(tmpdir(), 'synoikia-red-'));
  try {
    git(root, 'worktree', 'add', '--detach', dir, sha);
    if (run(dir, 'pnpm', ['install', '--frozen-lockfile', '--prefer-offline']) !== 0)
      throw new Error(`pnpm install failed at ${sha.slice(0, 7)}`);
    const byPackage = new Map<string, string[]>();
    for (const f of features.filter((f) => existsSync(path.join(dir, f)))) {
      const pkg = packageOf(dir, f);
      byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), path.relative(pkg, path.join(dir, f))]);
    }
    let failed = false;
    for (const [pkg, files] of byPackage)
      failed = run(pkg, 'pnpm', ['exec', 'vitest', 'run', ...files]) !== 0 || failed;
    return failed;
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: root });
    rmSync(dir, { recursive: true, force: true });
  }
}
