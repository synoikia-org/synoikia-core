import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { verifyPluginRepository } from '../../../src/testing/index.js';
import type { VerifiedPlugin } from '../../../src/testing/index.js';
import { testKey } from '../../../test/minisign-keys.js';
import { tasksArchive } from '../../support/plugin-archives.js';
import type { SynoikiaWorld } from '../../support/world.js';

/** What plugin author 3's release check saw: the builds it verified, or why it failed. */
const releases = new WeakMap<
  SynoikiaWorld,
  { fullLinks?: boolean; missing?: string[]; verified?: VerifiedPlugin[]; error?: string }
>();
const releaseOf = (world: SynoikiaWorld) => {
  let r = releases.get(world);
  if (!r) releases.set(world, (r = {}));
  return r;
};

/** The release of `name` in a folder, as its build leaves it: the index and the archives next to it. */
function releaseFolder(world: SynoikiaWorld, name: string) {
  const r = releaseOf(world);
  const repo = world.repository(name);
  const dir = mkdtempSync(path.join(tmpdir(), 'synoikia-release-'));
  world.cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
  const index = JSON.parse(world.repoFiles.get(repo.url)!.toString('utf8')) as {
    plugins: { versions: { url: string }[] }[];
  };
  for (const v of index.plugins.flatMap((p) => p.versions)) {
    const file = path.basename(v.url);
    const archive = world.repoFiles.get(new URL(v.url, repo.url).toString());
    if (archive && !r.missing?.includes(file)) writeFileSync(path.join(dir, file), archive);
    if (r.fullLinks) v.url = `https://downloads.acme.example/releases/${file}`;
  }
  writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
  return { index: path.join(dir, 'index.json'), assets: dir };
}

Given(
  '{string} offers Acme Tasks {word} with {word} download addresses',
  (world: SynoikiaWorld, name: string, version: string, links: string) => {
    world.offer(name, version);
    releaseOf(world).fullLinks = links === 'full';
  },
);

Given(
  '{string} offers Acme Tasks {word} without its archive',
  (world: SynoikiaWorld, name: string, version: string) => {
    world.offer(name, version);
    releaseOf(world).missing = [`tasks-${version}.tgz`];
  },
);

Given(
  '{string} offers a build of Acme Tasks {word} that throws {string} when it loads',
  (world: SynoikiaWorld, name: string, version: string, message: string) => {
    const entry = `throw new Error(${JSON.stringify(message)});\n`;
    world.offer(name, version, { archive: tasksArchive(version, undefined, { 'index.mjs': entry }) });
  },
);

Given(
  '{string} offers a build of Acme Tasks {word} that never answers',
  (world: SynoikiaWorld, name: string, version: string) => {
    const entry = 'setInterval(() => {}, 1000);\n';
    world.offer(name, version, { archive: tasksArchive(version, undefined, { 'index.mjs': entry }) });
  },
);

async function check(world: SynoikiaWorld, name: string, publicKey: string) {
  const r = releaseOf(world);
  try {
    r.verified = await verifyPluginRepository({ ...releaseFolder(world, name), publicKey });
  } catch (err) {
    r.error = err instanceof Error ? err.message : String(err);
  }
}

When(
  'plugin author {int} checks the release of {string} with its key',
  async (world: SynoikiaWorld, _author: number, name: string) => {
    await check(world, name, world.repository(name).key!.publicKey);
  },
);

When(
  'plugin author {int} checks the release of {string} with another key',
  async (world: SynoikiaWorld, _author: number, name: string) => {
    await check(world, name, testKey().publicKey);
  },
);

Then('the check passes for Acme Tasks {word}, with its signature verified', (world: SynoikiaWorld, version: string) => {
  const r = releaseOf(world);
  expect(r.error).toBeUndefined();
  expect(r.verified).toEqual([{ id: 'tasks', version, signatureVerified: true }]);
});

Then('the check fails, because the key is not the key of {string}', (world: SynoikiaWorld) => {
  expect(releaseOf(world).error).toMatch(/Confirm the repository public key/);
});

Then(
  'the check fails for Acme Tasks {word}, because the checksum does not match',
  (world: SynoikiaWorld, version: string) => {
    expect(releaseOf(world).error).toMatch(new RegExp(`^tasks@${version}: .*sha256`));
  },
);

Then(
  'the check fails for Acme Tasks {word}, because its archive is missing',
  (world: SynoikiaWorld, version: string) => {
    expect(releaseOf(world).error).toMatch(new RegExp(`^tasks@${version}: .*404`));
  },
);

Then(
  'the check says that Acme Tasks {word} does not start, and shows {string}',
  (world: SynoikiaWorld, version: string, message: string) => {
    expect(releaseOf(world).error).toMatch(new RegExp(`^tasks@${version} does not start[\\s\\S]*${message}`));
  },
);

Then('the check says that Acme Tasks {word} does not start', (world: SynoikiaWorld, version: string) => {
  expect(releaseOf(world).error).toMatch(new RegExp(`^tasks@${version} does not start`));
});
