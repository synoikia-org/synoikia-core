import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import * as tar from 'tar';

/** The World's "Acme Tasks" plugin as its source folder holds it. */
export const TASKS_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/world/tasks');

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** A build of "Acme Tasks" as an npm-pack style archive: `manifest` changes its manifest, `files` adds files or
 * (null) removes them. */
export function tasksArchive(
  version: string,
  manifest: (m: Record<string, unknown>) => void = () => undefined,
  files: Record<string, string | null> = {},
) {
  const work = mkdtempSync(path.join(tmpdir(), 'synoikia-world-build-'));
  try {
    const pkg = path.join(work, 'package');
    cpSync(TASKS_SOURCE, pkg, { recursive: true });
    const m = JSON.parse(readFileSync(path.join(pkg, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    m.version = version;
    manifest(m);
    writeFileSync(path.join(pkg, 'manifest.json'), JSON.stringify(m, null, 2));
    for (const [name, body] of Object.entries(files)) {
      if (body === null) rmSync(path.join(pkg, name));
      else writeFileSync(path.join(pkg, name), body);
    }
    const file = path.join(work, 'out.tgz');
    tar.c({ gzip: true, cwd: work, file, sync: true, portable: true }, ['package']);
    return readFileSync(file);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The manifest of the World's "Acme Tasks" at `version`. */
export function tasksManifest(version: string) {
  const m = JSON.parse(readFileSync(path.join(TASKS_SOURCE, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  return JSON.stringify({ ...m, version });
}

/** One entry of a hand-built archive: a file (`0`), a link (`2`), a character device (`3`). */
export interface RawEntry {
  name: string;
  type: string;
  body?: string;
  link?: string;
  /** The size the header declares, when it is not the size of `body`. */
  size?: number;
}

function header(e: RawEntry, size: number) {
  const h = Buffer.alloc(512);
  h.write(e.name, 0);
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(e.type, 156);
  if (e.link) h.write(e.link, 157);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

/** A hand-built, gzipped archive, for entries a well-behaved packer refuses to make. */
export function rawArchive(entries: RawEntry[]) {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.from(e.body ?? '');
    const size = e.size ?? body.length;
    blocks.push(header(e, size));
    const padded = Buffer.alloc(Math.ceil(size / 512) * 512);
    body.copy(padded);
    blocks.push(padded);
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
