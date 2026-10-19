import { cpSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { rawArchive, sha256, TASKS_SOURCE, tasksArchive, tasksManifest } from '../../support/plugin-archives.js';
import { eventually, tasksBuild } from '../../support/world.js';
import type { OfferedBuild, SynoikiaWorld } from '../../support/world.js';

const adopted = new WeakMap<SynoikiaWorld, string>();

const expectError = (world: SynoikiaWorld, error: string) =>
  expect(world.portalAnswer.body, JSON.stringify(world.portalAnswer)).toMatchObject({ error });

/** `name` offers a build of "Acme Tasks", and the admin refreshes it when it is added already. */
async function offer(world: SynoikiaWorld, name: string, version: string, build: Partial<OfferedBuild>) {
  const repo = world.offer(name, version, build);
  if (repo.id) await world.expectOk(world.refreshRepository(name), 'refresh repository');
}

const status = async (world: SynoikiaWorld, slug: string) =>
  (await world.expectOk(world.admin.get(`/api/instances/${world.instances.get(slug)!}`), 'read instance'))
    .status as string;

/** The plugin's rows of the audit log with this decision, oldest first. */
const auditOf = async (world: SynoikiaWorld, decision: string) =>
  (
    (await world.audit({ decision })) as unknown as {
      actorKind: string;
      actorId: string;
      detail: Record<string, unknown>;
    }[]
  )
    .slice()
    .reverse();

Given('core has no plugin copied into its plugins folder by hand', async (world: SynoikiaWorld) => {
  await world.withoutHandCopiedTasks();
});

Given(
  '{string} runs on Acme Tasks {word} from {string}',
  async (world: SynoikiaWorld, slug: string, v: string, name: string) => {
    await world.installedFrom(name, v);
    await world.tasksInstance(slug);
  },
);

Given(
  '{string} offers Acme Tasks {word} with the checksum of another build',
  async (world: SynoikiaWorld, name: string, version: string) => {
    await offer(world, name, version, { sha256: sha256(tasksBuild('1.0.0')) });
  },
);

Given(
  '{string} offers Acme Tasks {word} with the signature of another build',
  async (world: SynoikiaWorld, name: string, version: string) => {
    await offer(world, name, version, { signature: world.repository(name).key!.sign(tasksBuild('1.0.0')) });
  },
);

Given(
  '{string} offers Acme Tasks {word} without a signature',
  async (world: SynoikiaWorld, name: string, v: string) => {
    await offer(world, name, v, { signature: null });
  },
);

Given(
  '{string} offers Acme Tasks {word} as an archive with a link to {string}',
  async (world: SynoikiaWorld, name: string, version: string, target: string) => {
    const archive = rawArchive([
      { name: 'manifest.json', type: '0', body: tasksManifest(version) },
      { name: 'index.mjs', type: '2', link: target },
    ]);
    await offer(world, name, version, { archive });
  },
);

Given(
  '{string} offers Acme Tasks {word} as an archive with the file {string}',
  async (world: SynoikiaWorld, name: string, version: string, file: string) => {
    const archive = rawArchive([
      { name: 'manifest.json', type: '0', body: tasksManifest(version) },
      { name: file, type: '0', body: 'outside' },
    ]);
    await offer(world, name, version, { archive });
  },
);

Given(
  '{string} offers Acme Tasks {word} as an archive without a manifest',
  async (world: SynoikiaWorld, name: string, version: string) => {
    await offer(world, name, version, {
      archive: rawArchive([{ name: 'readme.txt', type: '0', body: 'no manifest' }]),
    });
  },
);

Given(
  '{string} offers Acme Tasks {word} as an archive of Acme Tasks {word}',
  async (world: SynoikiaWorld, name: string, version: string, inside: string) => {
    await offer(world, name, version, { archive: tasksArchive(inside) });
  },
);

Given(
  '{string} offers Acme Tasks {word} as an archive with {int} entries',
  async (world: SynoikiaWorld, name: string, version: string, count: number) => {
    const entries = [{ name: 'manifest.json', type: '0', body: tasksManifest(version) }];
    for (let i = entries.length; i < count; i++) entries.push({ name: `f${i}.txt`, type: '0', body: '' });
    await offer(world, name, version, { archive: rawArchive(entries) });
  },
);

Given(
  '{string} offers Acme Tasks {word} as an archive that unpacks to {int} MB',
  async (world: SynoikiaWorld, name: string, version: string, mb: number) => {
    const archive = rawArchive([
      { name: 'manifest.json', type: '0', body: tasksManifest(version) },
      { name: 'big.bin', type: '0', size: mb * 1024 * 1024 },
    ]);
    await offer(world, name, version, { archive });
  },
);

Given(
  '{string} offers Acme Tasks {word} as an archive with a device file',
  async (world: SynoikiaWorld, name: string, version: string) => {
    const archive = rawArchive([
      { name: 'manifest.json', type: '0', body: tasksManifest(version) },
      { name: 'console', type: '3' },
    ]);
    await offer(world, name, version, { archive });
  },
);

Then(
  'the admin has Acme Tasks {word} with a verified signature, disabled',
  async (world: SynoikiaWorld, version: string) => {
    expect(world.portalAnswer.status, JSON.stringify(world.portalAnswer)).toBe(201);
    expect(await world.plugin()).toMatchObject({
      version,
      signatureVerified: true,
      sha256: sha256(tasksBuild(version)),
      enabled: false,
      status: 'ok',
      repoId: world.repository('Acme plugins').id,
    });
  },
);

Then('the files of Acme Tasks {word} are in the plugins folder', (world: SynoikiaWorld, version: string) => {
  expect(JSON.parse(readFileSync(world.pluginFile('manifest.json'), 'utf8'))).toMatchObject({ version });
  expect(existsSync(world.pluginFile('index.mjs'))).toBe(true);
});

Then('the files of Acme Tasks are gone from the plugins folder', (world: SynoikiaWorld) => {
  expect(existsSync(path.dirname(world.pluginFile('manifest.json')))).toBe(false);
});

Then('the admin has no plugin Acme Tasks', async (world: SynoikiaWorld) => {
  expect(await world.plugin()).toBeUndefined();
  expect(existsSync(world.pluginFile('manifest.json'))).toBe(false);
});

Then('the admin is told that the build does not match its checksum', (world: SynoikiaWorld) => {
  expectError(world, 'checksum_mismatch');
});

Then('the admin is told that the signature of the build is not valid', (world: SynoikiaWorld) => {
  expectError(world, 'signature_invalid');
});

Then('the admin is told that the build has no signature', (world: SynoikiaWorld) => {
  expectError(world, 'signature_missing');
});

Then('the admin is told that {string} does not offer that version', (world: SynoikiaWorld) => {
  expectError(world, 'version_not_found');
});

When('the admin enables Acme Tasks and adds the instance {string}', async (world: SynoikiaWorld, slug: string) => {
  await world.tasksInstance(slug);
});

Then(
  '{string} is ready with the {int} operations of Acme Tasks',
  async (world: SynoikiaWorld, slug: string, n: number) => {
    expect(await status(world, slug)).toBe('ready');
    expect(await world.operations(slug)).toHaveLength(n);
  },
);

Then('the audit log shows that the admin enabled Acme Tasks', async (world: SynoikiaWorld) => {
  expect(await auditOf(world, 'plugin_enabled')).toMatchObject([
    { actorKind: 'user', actorId: world.person('admin').id, detail: { pluginId: 'tasks' } },
  ]);
});

Then(
  'Acme Tasks {word} is enabled, and {string} is ready',
  async (world: SynoikiaWorld, version: string, slug: string) => {
    expect(await world.plugin()).toMatchObject({ version, enabled: true });
    await eventually(async () => (await status(world, slug)) === 'ready', `${slug} to be ready`);
  },
);

Then(
  'Acme Tasks {word} is disabled, and {string} is stopped',
  async (world: SynoikiaWorld, version: string, slug: string) => {
    expect(await world.plugin()).toMatchObject({ version, enabled: false });
    expect(await status(world, slug)).toBe('stopped');
  },
);

Then(
  'the audit log shows that the update of Acme Tasks needs a review of its network hosts',
  async (world: SynoikiaWorld) => {
    expect((await auditOf(world, 'plugin_updated')).at(-1)?.detail).toMatchObject({
      version: '1.2.0',
      enabled: false,
      needsReview: ['network.hosts'],
    });
  },
);

When('the admin uninstalls Acme Tasks', async (world: SynoikiaWorld) => {
  await world.answerOf(world.admin.del('/api/plugins/tasks'));
});

Then('the admin is told that the instance {string} uses Acme Tasks', (world: SynoikiaWorld, slug: string) => {
  expectError(world, 'plugin_has_instances');
  expect(world.portalAnswer.body.details).toMatchObject({ instances: [slug] });
});

Then(
  'the audit log shows that {string} was added, then Acme Tasks installed, enabled and uninstalled',
  async (world: SynoikiaWorld) => {
    const decisions = (
      (await world.audit({ kind: 'config', decision: 'plugin_' })) as unknown as { decision: string }[]
    )
      .map((r) => r.decision)
      .reverse();
    expect(decisions.slice(decisions.lastIndexOf('plugin_repo_added'))).toEqual([
      'plugin_repo_added',
      'plugin_installed',
      'plugin_enabled',
      'plugin_uninstalled',
    ]);
  },
);

Then('the admin is told that Acme Tasks is installed from another repository', (world: SynoikiaWorld) => {
  expectError(world, 'installed_from_elsewhere');
});

Then('{string} offers Acme Tasks as installed from elsewhere', async (world: SynoikiaWorld, name: string) => {
  const offered = (await world.expectOk(world.admin.get('/api/plugin-repos/available'), 'list offers')) as unknown as {
    repoId: string;
  }[];
  expect(offered.find((o) => o.repoId === world.repository(name).id)).toMatchObject({
    blocked: 'installed_from_elsewhere',
    installed: { fromThisRepo: false, managed: true },
  });
});

Given(
  'the admin copied Acme Tasks {word} into the plugins folder by hand, and it runs as {string}',
  async (world: SynoikiaWorld, _version: string, slug: string) => {
    cpSync(TASKS_SOURCE, path.dirname(world.pluginFile('manifest.json')), { recursive: true });
    await world.expectOk(world.admin.post('/api/plugins/rescan'), 'rescan plugins');
    await world.tasksInstance(slug);
    adopted.set(world, (await world.plugin())!.id);
  },
);

Then(
  'Acme Tasks {word} is the same plugin, still has the instance {string}, and is disabled for review',
  async (world: SynoikiaWorld, version: string) => {
    expect(world.portalAnswer.status, JSON.stringify(world.portalAnswer)).toBe(201);
    expect(await world.plugin()).toMatchObject({
      id: adopted.get(world),
      version,
      repoId: world.repository('Acme mirror').id,
      enabled: false,
      signatureVerified: false,
      instances: 1,
    });
  },
);

Then('the audit log shows that {string} adopted Acme Tasks', async (world: SynoikiaWorld, name: string) => {
  expect(await auditOf(world, 'plugin_adopted')).toMatchObject([
    { detail: { pluginId: 'tasks', repo: world.repository(name).url, enabled: false } },
  ]);
});

Then('the admin is told that the archive is not valid', (world: SynoikiaWorld) => {
  expectError(world, 'invalid_archive');
});

Then('core wrote no file {string} outside the plugins folder', (world: SynoikiaWorld, file: string) => {
  expect(existsSync(path.join(world.dataDir, file))).toBe(false);
  expect(existsSync(path.join(world.dataDir, 'plugins-staging', file))).toBe(false);
  expect(existsSync(path.join(world.dataDir, 'plugins', file))).toBe(false);
});

Then(
  'the admin is told that the archive holds Acme Tasks {word}, not {word}',
  (world: SynoikiaWorld, inside: string, picked: string) => {
    expectError(world, 'manifest_mismatch');
    expect(world.portalAnswer.body.message).toBe(`The archive contains tasks@${inside}, not tasks@${picked}`);
  },
);
