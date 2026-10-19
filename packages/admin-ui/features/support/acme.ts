import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { FakeRequest } from '@synoikia/core/testing';
import { testKey } from '../../../core/test/minisign-keys.js';

export const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../core');
/** The upstream fake and the fixture plugin of core's World, for scenarios that need an instance. */
export const CORE_FIXTURES = path.join(CORE, 'test/fixtures/world');
/** The World's "Acme Tasks" plugin as core's World keeps it. */
export const TASKS_SOURCE = path.join(CORE_FIXTURES, 'tasks');
/** The upstream's API token, stored as the instance's secret. */
export const API_TOKEN = 'acme-tok-9f8e7d6c'; // gitleaks:allow (the fake upstream's test token)

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** The fake "Acme Tasks" service: its lists, read with the API token. */
export function acmeRoutes(lists: Map<string, string[]>) {
  const missing = { status: 404 };
  return {
    'GET /lists': () => ({ body: [...lists.keys()].map((name) => ({ name, description: '' })) }),
    'GET /lists/{name}': (req: FakeRequest) =>
      lists.has(req.params.name!) ? { body: { name: req.params.name, version: '1' } } : missing,
    'GET /lists/{name}/tasks': (req: FakeRequest) => {
      const name = req.params.name!;
      const tasks = lists.get(name);
      if (!tasks) return missing;
      return {
        body:
          req.query.get('with') === 'ids'
            ? tasks.map((title, i) => ({ id: `${name}#${i}`, title }))
            : tasks.map((title) => ({ title, done: false })),
      };
    },
    'GET /views': () => ({ body: [] }),
  };
}

export const acmeGuard = (req: FakeRequest) =>
  req.headers.authorization === `Bearer ${API_TOKEN}` ? undefined : { status: 401 };

function tarHeader(name: string, size: number) {
  const h = Buffer.alloc(512);
  h.write(name, 0);
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write('0', 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

/** A build of "Acme Tasks" as an npm-pack style archive, with `change` applied to its manifest. */
export function tasksArchive(version: string, change: (m: Record<string, unknown>) => void = () => undefined) {
  const blocks: Buffer[] = [];
  for (const file of (readdirSync(TASKS_SOURCE) as string[]).sort()) {
    const full = path.join(TASKS_SOURCE, file);
    if (!statSync(full).isFile()) continue;
    let body = readFileSync(full);
    if (file === 'manifest.json') {
      const m = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
      m.version = version;
      change(m);
      body = Buffer.from(JSON.stringify(m, null, 2));
    }
    blocks.push(tarHeader(`package/${file}`, body.length));
    const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
    body.copy(padded);
    blocks.push(padded);
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

type SigningKey = ReturnType<typeof testKey>;

/** A plugin repository the World serves to core, and the builds of "Acme Tasks" it offers. */
export interface FakeRepository {
  name: string;
  url: string;
  /** The key that signs its builds; null for an unsigned repository. */
  key: SigningKey | null;
  builds: { version: string; archive: Buffer }[];
  /** Its id in core, once the admin added it. */
  id?: string;
}

const KNOWN: Record<string, { url: string; signed: boolean }> = {
  'Acme plugins': { url: 'https://plugins.acme.example/index.json', signed: true },
  'Acme mirror': { url: 'https://mirror.acme.example/index.json', signed: false },
};

export function newRepository(name: string): FakeRepository {
  const known = KNOWN[name];
  if (!known) throw new Error(`The World has no repository "${name}"`);
  return { name, url: known.url, key: known.signed ? testKey() : null, builds: [] };
}

/** The files of `repo` by address: its index and its archives. */
export function publishedFiles(repo: FakeRepository) {
  const files = new Map<string, Buffer>();
  const versions = repo.builds.map((b) => {
    const file = `tasks-${b.version}.tgz`;
    files.set(new URL(file, repo.url).toString(), b.archive);
    const signature = repo.key?.sign(b.archive);
    return {
      version: b.version,
      sdk: '^0.2.0',
      url: file,
      sha256: sha256(b.archive),
      ...(signature ? { signature } : {}),
    };
  });
  const index = {
    schema: 1,
    name: repo.name,
    ...(repo.key ? { publicKey: repo.key.publicKey } : {}),
    plugins: versions.length ? [{ id: 'tasks', name: 'Acme Tasks', versions }] : [],
  };
  files.set(repo.url, Buffer.from(JSON.stringify(index)));
  return files;
}
