import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TEMPLATES_DIR } from '../repo-root.js';

const WORKFLOW_DIR = path.join(TEMPLATES_DIR, 'workflow');
const outName = (name: string) => (/^_[a-zA-Z]/.test(name) ? `.${name.slice(1)}` : name);

/** The shared workflow files, as repo-relative path → template path. Claude files only for repos that use Claude. */
export function workflowFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (from: string, to: string) => {
    for (const entry of readdirSync(from).sort()) {
      const src = path.join(from, entry);
      const dest = path.posix.join(to, outName(entry));
      if (statSync(src).isDirectory()) walk(src, dest);
      else files.set(dest, src);
    }
  };
  walk(path.join(WORKFLOW_DIR, 'base'), '');
  if (existsSync(path.join(root, '.claude'))) walk(path.join(WORKFLOW_DIR, 'claude'), '');
  return files;
}

/** Writes the shared files, or with `check` lists the ones that differ. Returns the paths written or out of date. */
export function syncWorkflow(root: string, check = false): string[] {
  const changed: string[] = [];
  for (const [rel, src] of workflowFiles(root)) {
    const dest = path.join(root, rel);
    const text = readFileSync(src, 'utf8');
    if (existsSync(dest) && readFileSync(dest, 'utf8') === text) continue;
    changed.push(rel);
    if (check) continue;
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    if (rel.startsWith('.githooks/')) chmodSync(dest, 0o755);
  }
  return changed;
}
