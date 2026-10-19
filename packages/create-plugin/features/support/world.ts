import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { After, QuickPickleWorld, setWorldConstructor } from 'quickpickle';

export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.resolve(PACKAGE_DIR, '../..');
// Inside this checkout, so a plugin that author 3 builds resolves the SDK and core from its sources.
const WORK_DIR = path.join(PACKAGE_DIR, '.smoke');
const TSX = pathToFileURL(createRequire(path.join(ROOT, 'package.json')).resolve('tsx')).href;
const require = createRequire(import.meta.url);
export const TSC = require.resolve('typescript/bin/tsc');
export const VITEST = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

/** The commands of the published bins, run from this checkout's sources. */
const shim = (entry: string) =>
  `#!/bin/sh\nexec "${process.execPath}" --no-node-snapshot --import "${TSX}" --conditions synoikia-source "${path.join(PACKAGE_DIR, 'src', entry)}" "$@"\n`;

/** A fake `gh release`: each release is a folder of its assets under FAKE_GITHUB_DIR. */
const FAKE_GH = `import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const [cmd, sub, tag, ...rest] = process.argv.slice(2);
if (cmd !== 'release' || !tag) process.exit(2);
const dir = path.join(process.env.FAKE_GITHUB_DIR, tag);
const files = [];
const flags = {};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--') && (a.includes('=') || a === '--clobber')) continue;
  if (a.startsWith('--')) flags[a.slice(2)] = rest[++i];
  else files.push(a);
}
const put = () => files.forEach((f) => copyFileSync(f, path.join(dir, path.basename(f))));
if (sub === 'view') process.exit(existsSync(dir) ? 0 : 1);
if (sub === 'create') {
  if (existsSync(dir)) process.exit(1);
  mkdirSync(dir, { recursive: true });
  put();
} else if (sub === 'upload') {
  if (!existsSync(dir)) process.exit(1);
  put();
} else if (sub === 'download') {
  if (!existsSync(path.join(dir, flags.pattern))) process.exit(1);
  copyFileSync(path.join(dir, flags.pattern), path.join(flags.dir, flags.pattern));
} else process.exit(2);
`;

/** A minisign key made with Node's Ed25519, standing in for the repository's signing key. */
export function signingKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = randomBytes(8);
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
  return {
    publicKey: Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64'),
    sign: (data: Buffer, comment: string) => minisign(privateKey, keyId, data, comment),
  };
}

function minisign(privateKey: KeyObject, keyId: Buffer, data: Buffer, comment: string) {
  const sig = sign(null, createHash('blake2b512').update(data).digest(), privateKey);
  const global = sign(null, Buffer.concat([sig, Buffer.from(comment)]), privateKey);
  return [
    'untrusted comment: signature from the repository key',
    Buffer.concat([Buffer.from('ED'), keyId, sig]).toString('base64'),
    `trusted comment: ${comment}`,
    global.toString('base64'),
    '',
  ].join('\n');
}

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

export const AUTH_FLAGS: Record<string, string> = {
  'a bearer token': 'bearer',
  'an API key': 'api-key',
  'a user and password': 'basic',
  'no sign-in': 'none',
};

export const ARCHETYPE_FLAGS: Record<string, string> = {
  'a service with an OpenAPI description': 'openapi-rest',
  'a REST service without a spec': 'static-rest',
  'a remote procedure service on WebSocket': 'websocket-rpc',
  'a plugin to fill in by hand': 'blank',
};

export class PluginAuthorWorld extends QuickPickleWorld {
  /** Plugin author 3's own folder. */
  dir = '';
  /** The plugin repository, once author 3 has one. */
  repo = '';
  /** The plugin that the scenario is about. */
  plugin = '';
  last?: Run;
  /** The archive checksums of each pack. */
  sums: string[] = [];
  /** A pull request event, for the checks that read one. */
  eventFile?: string;
  repoKey = signingKey();
  otherKey = signingKey();
  private bin = '';

  async init() {
    await super.init();
    mkdirSync(WORK_DIR, { recursive: true });
    this.dir = mkdtempSync(path.join(WORK_DIR, 'author-3-'));
    this.bin = path.join(this.dir, '.bin');
    mkdirSync(this.bin);
    const tool = (name: string, text: string) => {
      writeFileSync(path.join(this.bin, name), text);
      chmodSync(path.join(this.bin, name), 0o755);
    };
    tool('synoikia-plugin', shim('cli.ts'));
    tool('create-plugin', shim('create.ts'));
    writeFileSync(path.join(this.bin, 'fake-gh.mjs'), FAKE_GH);
    tool('gh', `#!/bin/sh\nexec "${process.execPath}" "${path.join(this.bin, 'fake-gh.mjs')}" "$@"\n`);
  }

  get github() {
    return path.join(this.dir, 'github');
  }

  /** The environment of author 3's shell: the tools on the path, and no CI variables of this run. */
  env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GITHUB_')) env[k] = v;
    return {
      ...env,
      PATH: `${this.bin}${path.delimiter}${process.env.PATH ?? ''}`,
      FAKE_GITHUB_DIR: this.github,
      ...(this.eventFile ? { GITHUB_EVENT_PATH: this.eventFile } : {}),
      ...extra,
    };
  }

  /** Runs a command as author 3 does, in the repository unless told otherwise. */
  run(command: string, args: string[], opts: { cwd?: string; input?: string; env?: Record<string, string> } = {}) {
    const r = spawnSync(command, args, {
      cwd: opts.cwd ?? this.repo,
      env: this.env(opts.env),
      input: opts.input,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) throw r.error;
    this.last = { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    return this.last;
  }

  cli(...args: string[]) {
    return this.run('synoikia-plugin', args);
  }

  /** Runs a command that must succeed, and fails the step with its output when it does not. */
  must(command: string, args: string[], cwd = this.repo) {
    const r = this.run(command, args, { cwd });
    if (r.code !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
    return r;
  }

  /** The create command: a repository in author 3's folder, with no install. */
  create(name: string, ...flags: string[]) {
    this.repo = path.join(this.dir, name);
    return this.run('create-plugin', [name, ...flags, '--skip-install'], { cwd: this.dir });
  }

  /** `synoikia-plugin new` with no prompts and no install. */
  newPlugin(...flags: string[]) {
    return this.cli('new', ...flags, '--yes', '--skip-install');
  }

  /** The lines a command wrote to stderr, without the name of the check that wrote them. */
  problems(): string[] {
    return (this.last?.stderr ?? '')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.replace(/^[a-z-]+: /, ''));
  }

  file(rel: string) {
    return path.join(this.repo, rel);
  }

  read(rel: string) {
    return readFileSync(this.file(rel), 'utf8');
  }

  write(rel: string, text: string) {
    mkdirSync(path.dirname(this.file(rel)), { recursive: true });
    writeFileSync(this.file(rel), text);
  }

  readJson<T = Record<string, unknown>>(rel: string): T {
    return JSON.parse(this.read(rel)) as T;
  }

  editJson(rel: string, edit: (value: Record<string, unknown>) => void) {
    const value = this.readJson(rel);
    edit(value);
    this.write(rel, `${JSON.stringify(value, null, 2)}\n`);
  }

  git(...args: string[]) {
    return execFileSync('git', args, { cwd: this.repo, encoding: 'utf8', stdio: 'pipe' }).trim();
  }

  initGit() {
    this.git('init', '-q', '-b', 'main');
    this.git('config', 'user.email', 'author-3@acme.test');
    this.git('config', 'user.name', 'Plugin author 3');
    this.git('config', 'commit.gpgsign', 'false');
    this.git('add', '-A');
    this.git('commit', '-q', '-m', 'chore: start');
  }

  commit(subject: string, files: Record<string, string>) {
    for (const [f, t] of Object.entries(files)) this.write(f, t);
    this.git('add', '-A');
    this.git('commit', '-q', '-m', subject);
  }

  /** Signs every packed archive, as the release workflow does with minisign. */
  signArchives(key = this.repoKey) {
    const out = path.join(this.repo, '.repo');
    const releases = JSON.parse(readFileSync(path.join(out, 'releases.json'), 'utf8')) as { file: string }[];
    for (const r of releases) {
      const archive = path.join(out, r.file);
      writeFileSync(`${archive}.minisig`, key.sign(readFileSync(archive), `file:${r.file}`));
    }
  }

  stop() {
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
  }
}

setWorldConstructor(PluginAuthorWorld);

After((world: PluginAuthorWorld) => {
  world.stop();
});
