import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { testKey } from '../../../test/minisign-keys.js';
import { startCoreProcess } from '../../support/core-process.js';
import type { CoreProcess } from '../../support/core-process.js';
import { DEFAULT_REPOSITORY, eventually } from '../../support/world.js';
import type { OfferedBuild, SynoikiaWorld } from '../../support/world.js';

const DAY_MS = 24 * 60 * 60_000;

const state = new WeakMap<
  SynoikiaWorld,
  { oldKeys: Map<string, string>; run?: CoreProcess; available?: Record<string, unknown>[] }
>();
const of = (world: SynoikiaWorld) => {
  let s = state.get(world);
  if (!s) state.set(world, (s = { oldKeys: new Map() }));
  return s;
};

/** The key the index of `name` publishes now. */
const publishedKey = (world: SynoikiaWorld, name: string) => {
  const repo = world.repository(name);
  return repo.publishedKey !== undefined ? repo.publishedKey : repo.key!.publicKey;
};

const repoNamed = async (world: SynoikiaWorld, name: string) =>
  (await world.repositoryList()).find((r) => r.name === name);

const expectError = (world: SynoikiaWorld, error: string) =>
  expect(world.portalAnswer.body, JSON.stringify(world.portalAnswer)).toMatchObject({ error });

const indexFetches = (world: SynoikiaWorld, name: string) =>
  world.repoFetched.filter((u) => u === world.repository(name).url).length;

/** `name` offers a build of "Acme Tasks"; core sees it at once when the admin added the repository. */
async function offer(world: SynoikiaWorld, name: string, version: string, build: Partial<OfferedBuild> = {}) {
  const repo = world.offer(name, version, build);
  if (repo.id) await world.expectOk(world.refreshRepository(name), 'refresh repository');
}

/** Core starts again, which runs its first refresh of the repositories; a day may pass first. */
async function refreshOnStart(world: SynoikiaWorld, passDay: boolean) {
  const before = world.repoFetched.length;
  if (passDay) await world.advanceClock(DAY_MS + 60_000);
  await world.restartCore();
  await eventually(() => world.repoFetched.length > before, 'a repository fetch', 500).catch(() => undefined);
}

/** A new key for `name`: its builds and its index use it from now on. */
function newKey(world: SynoikiaWorld, name: string) {
  const repo = world.repository(name);
  of(world).oldKeys.set(name, repo.key!.publicKey);
  repo.key = testKey();
  world.publish(repo);
}

/** The operator starts core as `main.ts` runs it on the World's data directory; the admin signs in there. */
async function operatorStart(world: SynoikiaWorld) {
  const s = of(world);
  if (s.run) {
    s.run.child.kill('SIGTERM');
    await s.run.exited;
  } else await world.stopCore();
  s.run = await startCoreProcess(world, world.dataDir);
  expect(s.run.adminBase, s.run.log).not.toBe('');
  world.adminBase = s.run.adminBase;
  const { username, password } = world.person('admin');
  world.admin = await world.portal(username, password);
}

Given('{string} offers Acme Tasks {word}', async (world: SynoikiaWorld, name: string, version: string) => {
  await offer(world, name, version);
});

Given('{string} offers Acme Tasks {word} but publishes no key', (world: SynoikiaWorld, name: string, v: string) => {
  world.repository(name).publishedKey = null;
  world.offer(name, v);
});

Given(
  '{string} offers Acme Tasks {word} for core {word} and newer',
  async (world: SynoikiaWorld, name: string, version: string, core: string) => {
    await offer(world, name, version, { minCoreVersion: core });
  },
);

Given(
  'the admin added {string}, which offers Acme Tasks {word}',
  async (world: SynoikiaWorld, name: string, version: string) => {
    world.offer(name, version);
    await world.addRepository(name);
  },
);

Given('the admin installed Acme Tasks {word} from {string}', async (world: SynoikiaWorld, v: string, name: string) => {
  await world.installedFrom(name, v);
});

When('the admin adds {string} as a signed repository without a key', async (world: SynoikiaWorld, name: string) => {
  await world.answerOf(
    world.admin.post('/api/plugin-repos', { url: world.repository(name).url, signingMode: 'signed' }),
  );
});

When('the admin adds {string} as a signed repository with another key', async (world: SynoikiaWorld, name: string) => {
  await world.answerOf(
    world.admin.post('/api/plugin-repos', {
      url: world.repository(name).url,
      signingMode: 'signed',
      confirmPublicKey: testKey().publicKey,
    }),
  );
});

When(
  'the admin adds {string} as a signed repository with its key file, comment line included',
  async (world: SynoikiaWorld, name: string) => {
    const repo = world.repository(name);
    const { body } = await world.answerOf(
      world.admin.post('/api/plugin-repos', {
        url: repo.url,
        signingMode: 'signed',
        confirmPublicKey: `untrusted comment: minisign public key of ${name}\n${repo.key!.publicKey}\n`,
      }),
    );
    repo.id = body.id as string;
  },
);

When('the admin adds the unsigned repository at {string}', async (world: SynoikiaWorld, url: string) => {
  const { body } = await world.answerOf(world.admin.post('/api/plugin-repos', { url, signingMode: 'unsigned' }));
  if (typeof body.id === 'string' && world.repositories.has(body.name as string))
    world.repository(body.name as string).id = body.id;
});

Then(
  'the admin is asked to confirm the key of {string}, and is shown its key id and its full key',
  (world: SynoikiaWorld, name: string) => {
    expectError(world, 'confirm_key');
    expect(world.portalAnswer.body.details).toMatchObject({
      publicKey: world.repository(name).key!.publicKey,
      keyId: expect.stringMatching(/^[0-9A-F]{16}$/),
    });
  },
);

Then('the admin has no plugin repository', async (world: SynoikiaWorld) => {
  expect(await world.repositoryList()).toEqual([]);
});

Then(
  'the admin has the repository {string} with its key id and {int} plugin',
  async (world: SynoikiaWorld, name: string, count: number) => {
    expect(await repoNamed(world, name)).toMatchObject({
      signingMode: 'signed',
      publicKey: world.repository(name).key!.publicKey,
      keyId: expect.stringMatching(/^[0-9A-F]{16}$/),
      pluginCount: count,
    });
  },
);

Then(
  'the admin has the repository {string} with {int} plugin',
  async (world: SynoikiaWorld, name: string, count: number) => {
    expect(await repoNamed(world, name)).toMatchObject({ pluginCount: count });
  },
);

Then('the admin is told that {string} publishes no key', (world: SynoikiaWorld) => {
  expectError(world, 'no_public_key');
});

Then('the admin is told that core fetches only secure addresses', (world: SynoikiaWorld) => {
  expectError(world, 'insecure_url');
});

Then('core never fetched {string}', (world: SynoikiaWorld, url: string) => {
  expect(world.repoFetched).not.toContain(url);
});

Given('the address {string} moved to {string}', (world: SynoikiaWorld, from: string, name: string) => {
  world.repoMoves.set(from, world.repository(name).url);
});

Given('the address {string} moves to {string}', (world: SynoikiaWorld, from: string, to: string) => {
  world.repoMoves.set(from, to);
});

Given('the address {string} moves seven times in a row', (world: SynoikiaWorld, first: string) => {
  const base = first.replace(/\/0$/, '');
  for (let i = 0; i < 7; i++) world.repoMoves.set(`${base}/${i}`, `${base}/${i + 1}`);
});

Then('the admin is told that core could not fetch the repository', (world: SynoikiaWorld) => {
  expectError(world, 'fetch_failed');
});

Given('{string} publishes its index in format version {int}', (world: SynoikiaWorld, name: string, format: number) => {
  const repo = world.repository(name);
  repo.format = format;
  world.publish(repo);
});

Then('the admin is told that the index of the repository is not valid', (world: SynoikiaWorld) => {
  expectError(world, 'invalid_index');
});

Given('{string} stopped publishing its index', (world: SynoikiaWorld, name: string) => {
  world.repoFiles.delete(world.repository(name).url);
});

Given(
  'the last fetch of {string} failed because it stopped publishing its index',
  async (world: SynoikiaWorld, name: string) => {
    world.repoFiles.delete(world.repository(name).url);
    await refreshOnStart(world, true);
    await eventually(async () => !!(await repoNamed(world, name))?.lastFetchError, 'the failed fetch');
  },
);

Given('{string} publishes its index again', (world: SynoikiaWorld, name: string) => {
  world.publish(world.repository(name));
});

When('a day passes and core refreshes its repositories', async (world: SynoikiaWorld) => {
  await refreshOnStart(world, true);
});

When('core refreshes its repositories', async (world: SynoikiaWorld) => {
  await refreshOnStart(world, false);
});

Then('the admin sees that the last fetch of {string} failed', async (world: SynoikiaWorld, name: string) => {
  await eventually(async () => /404/.test((await repoNamed(world, name))?.lastFetchError ?? ''), 'the fetch error');
});

Then('the admin sees that the last fetch of {string} worked', async (world: SynoikiaWorld, name: string) => {
  await eventually(async () => {
    const repo = await repoNamed(world, name);
    return repo?.lastFetchError === null && repo.keyStatus === 'ok';
  }, 'a fetch that works');
});

Then('core did not fetch the index of {string} again', (world: SynoikiaWorld, name: string) => {
  expect(indexFetches(world, name)).toBe(1);
});

Then('core fetched the index of {string} again', async (world: SynoikiaWorld, name: string) => {
  await eventually(() => indexFetches(world, name) === 2, 'the second fetch of the index');
});

When('the operator starts core for the first time', async (world: SynoikiaWorld) => {
  await operatorStart(world);
});

Given('the operator started core for the first time', async (world: SynoikiaWorld) => {
  await operatorStart(world);
});

When('the operator starts core again', async (world: SynoikiaWorld) => {
  await operatorStart(world);
});

Given('the admin removed the repository {string}', async (world: SynoikiaWorld, name: string) => {
  const repo = await repoNamed(world, name);
  await world.expectOk(world.admin.del(`/api/plugin-repos/${repo!.id}`), 'remove repository');
});

When('the admin removes the repository {string}', async (world: SynoikiaWorld, name: string) => {
  const repo = await repoNamed(world, name);
  await world.answerOf(world.admin.del(`/api/plugin-repos/${repo!.id}`));
});

Then(
  'the admin has the repository {string}, signed with the key that core pins',
  async (world: SynoikiaWorld, name: string) => {
    expect(await repoNamed(world, name)).toMatchObject({
      url: DEFAULT_REPOSITORY.url,
      signingMode: 'signed',
      publicKey: DEFAULT_REPOSITORY.publicKey,
    });
  },
);

Then('the audit log shows that core added {string}, not a person', async (world: SynoikiaWorld, name: string) => {
  const rows = (await world.audit({ decision: 'plugin_repo_added' })) as unknown as {
    actorKind: string;
    detail: { name: string };
  }[];
  expect(rows.filter((r) => r.detail.name === name)).toMatchObject([{ actorKind: 'system' }]);
});

/** The admin adds a repository named `name` at `url`, which publishes `publicKey`, and confirms that key. */
async function addSigned(world: SynoikiaWorld, name: string, url: string, publicKey: string) {
  const index = { schema: 1, name, publicKey, plugins: [] };
  world.repoFiles.set(url, Buffer.from(JSON.stringify(index)));
  await world.expectOk(
    world.admin.post('/api/plugin-repos', { url, signingMode: 'signed', confirmPublicKey: publicKey }),
    'add repository',
  );
}

const formerUrl = DEFAULT_REPOSITORY.formerUrls[0]!;

Given('the admin added {string} with its pinned key', async (world: SynoikiaWorld, name: string) => {
  await addSigned(world, name, DEFAULT_REPOSITORY.url, DEFAULT_REPOSITORY.publicKey);
});

Given(
  'the admin added {string} at its former address with its pinned key',
  async (world: SynoikiaWorld, name: string) => {
    await addSigned(world, name, formerUrl, DEFAULT_REPOSITORY.publicKey);
  },
);

Given('the admin added {string} at its former address with another key', async (world: SynoikiaWorld, name: string) => {
  await addSigned(world, name, formerUrl, testKey().publicKey);
});

Then(
  'the audit log shows that core moved {string} to its new address, not a person',
  async (world: SynoikiaWorld, name: string) => {
    const rows = (await world.audit({ decision: 'plugin_repo_moved' })) as unknown as {
      actorKind: string;
      detail: { name: string; from: string; to: string };
    }[];
    expect(rows.filter((r) => r.detail.name === name)).toMatchObject([
      { actorKind: 'system', detail: { from: formerUrl, to: DEFAULT_REPOSITORY.url } },
    ]);
  },
);

Then('the admin still has a repository at the former address of {string}', async (world: SynoikiaWorld) => {
  expect((await world.repositoryList()).filter((r) => r.url === formerUrl)).toHaveLength(1);
});

Then('the admin has the repository {string} once', async (world: SynoikiaWorld) => {
  expect((await world.repositoryList()).filter((r) => r.url === DEFAULT_REPOSITORY.url)).toHaveLength(1);
});

Given('{string} now signs with a new key', (world: SynoikiaWorld, name: string) => {
  newKey(world, name);
});

Given('{string} now signs with a new key that has the same key id', (world: SynoikiaWorld, name: string) => {
  const repo = world.repository(name);
  const pinned = repo.key!.publicKey;
  of(world).oldKeys.set(name, pinned);
  const raw = Buffer.from(testKey().publicKey, 'base64');
  Buffer.from(pinned, 'base64').copy(raw, 2, 2, 10);
  repo.publishedKey = raw.toString('base64');
  world.publish(repo);
});

Given('the key of {string} changed', async (world: SynoikiaWorld, name: string) => {
  newKey(world, name);
  await world.expectOk(world.refreshRepository(name), 'refresh repository');
});

When('the admin refreshes {string}', async (world: SynoikiaWorld, name: string) => {
  await world.answerOf(world.refreshRepository(name));
});

Given('the admin refreshed {string}', async (world: SynoikiaWorld, name: string) => {
  await world.expectOk(world.refreshRepository(name), 'refresh repository');
});

Then(
  'the admin sees that the key of {string} changed, and is shown the new key',
  async (world: SynoikiaWorld, name: string) => {
    expect(await repoNamed(world, name)).toMatchObject({
      keyStatus: 'key_changed',
      publicKey: of(world).oldKeys.get(name),
      offeredKey: { publicKey: publishedKey(world, name) },
    });
  },
);

When(
  'the admin installs Acme Tasks {word} from {string}',
  async (world: SynoikiaWorld, version: string, name: string) => {
    await world.answerOf(world.installFrom(name, version));
  },
);

Then('the admin is told that the key of the repository changed', (world: SynoikiaWorld) => {
  expectError(world, 'key_changed');
});

When('the admin confirms the old key of {string}', async (world: SynoikiaWorld, name: string) => {
  const id = world.repository(name).id!;
  await world.answerOf(
    world.admin.post(`/api/plugin-repos/${id}/confirm-key`, { publicKey: of(world).oldKeys.get(name) }),
  );
});

Given('the admin confirmed the new key of {string}', async (world: SynoikiaWorld, name: string) => {
  const id = world.repository(name).id!;
  await world.expectOk(
    world.admin.post(`/api/plugin-repos/${id}/confirm-key`, { publicKey: publishedKey(world, name) }),
    'confirm the new key',
  );
});

Then('the admin is asked to confirm the new key of {string}', (world: SynoikiaWorld, name: string) => {
  expectError(world, 'confirm_key');
  expect(world.portalAnswer.body.details).toMatchObject({ publicKey: publishedKey(world, name) });
});

Then('the admin has Acme Tasks {word} with a verified signature', async (world: SynoikiaWorld, version: string) => {
  expect(world.portalAnswer.status).toBe(201);
  expect(await world.plugin()).toMatchObject({ version, signatureVerified: true });
});

Then('the admin is told that Acme Tasks still comes from {string}', (world: SynoikiaWorld) => {
  expectError(world, 'repo_in_use');
  expect(world.portalAnswer.body.details).toMatchObject({ plugins: ['tasks'] });
});

Given('the admin uninstalled Acme Tasks', async (world: SynoikiaWorld) => {
  await world.expectOk(world.admin.del('/api/plugins/tasks'), 'uninstall Acme Tasks');
});

When('the admin looks at the plugins on offer', async (world: SynoikiaWorld) => {
  of(world).available = (await world.expectOk(
    world.admin.get('/api/plugin-repos/available'),
    'list the plugins on offer',
  )) as unknown as Record<string, unknown>[];
});

Then(
  'the admin is offered Acme Tasks {word}, and {word} is marked as not compatible',
  (world: SynoikiaWorld, latest: string, other: string) => {
    expect(of(world).available).toMatchObject([
      { pluginId: 'tasks', latest, versions: expect.arrayContaining([{ version: other, compatible: false }]) },
    ]);
  },
);

Then('the admin is told that Acme Tasks {word} needs a newer core', (world: SynoikiaWorld) => {
  expectError(world, 'incompatible');
  expect(world.portalAnswer.body.message).toMatch(/needs core 99\.0\.0/);
});
