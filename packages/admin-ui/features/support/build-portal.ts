import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    portalDir: string;
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INPUTS = ['src', 'index.html', 'vite.config.ts', 'package.json'];

function fingerprint() {
  const hash = createHash('sha256');
  for (const input of INPUTS) {
    const full = path.join(ROOT, input);
    const files = statSync(full).isDirectory()
      ? (readdirSync(full, { recursive: true }) as string[]).sort().map((f) => path.join(input, f))
      : [input];
    for (const file of files)
      if (statSync(path.join(ROOT, file)).isFile()) hash.update(file).update(readFileSync(path.join(ROOT, file)));
  }
  return hash.digest('hex').slice(0, 16);
}

// The portal is built once into a directory named by a hash of its sources, so later runs reuse it until they change.
export default function setup(project: TestProject) {
  const name = `synoikia-portal-${fingerprint()}`;
  const target = path.join(tmpdir(), name);
  if (!existsSync(path.join(target, '.ready'))) {
    const dir = mkdtempSync(path.join(tmpdir(), 'synoikia-portal-build-'));
    const vite = path.join(path.dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin/vite.js');
    execFileSync(process.execPath, [vite, 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'warn'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    writeFileSync(path.join(dir, '.ready'), '');
    try {
      renameSync(dir, target);
    } catch {
      rmSync(dir, { recursive: true, force: true });
    }
    for (const old of readdirSync(tmpdir()))
      if (old.startsWith('synoikia-portal-') && old !== name && !old.startsWith('synoikia-portal-build-'))
        rmSync(path.join(tmpdir(), old), { recursive: true, force: true });
  }
  project.provide('portalDir', target);
}
