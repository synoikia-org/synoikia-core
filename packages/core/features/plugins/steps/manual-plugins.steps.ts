import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { rawArchive, sha256, tasksArchive, tasksManifest } from '../../support/plugin-archives.js';
import { API_TOKEN, eventually, tasksBuild } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

type Portal = SynoikiaWorld['admin'];

interface Uploads {
  /** The staged uploads, oldest first. */
  ids: string[];
  last?: { fileName: string; archive: Buffer };
  running?: Promise<Response>;
  /** Acme's catalog requests before the last install, so a sync the install starts on its own counts too. */
  viewsBeforeInstall?: number;
}
const state = new WeakMap<SynoikiaWorld, Uploads>();
const of = (world: SynoikiaWorld) => {
  let s = state.get(world);
  if (!s) state.set(world, (s = { ids: [] }));
  return s;
};

const expectError = (world: SynoikiaWorld, error: string) =>
  expect(world.portalAnswer.body, JSON.stringify(world.portalAnswer)).toMatchObject({ error });

const auditOf = async (world: SynoikiaWorld, decision: string) =>
  ((await world.audit({ decision })) as unknown as { detail: Record<string, unknown> }[]).slice().reverse();

let manyFiles: Buffer | undefined;

/** Uploads `body` with this file name; `encode: false` sends the name as it is. */
async function upload(
  world: SynoikiaWorld,
  body: Buffer | ReadableStream<Uint8Array>,
  fileName?: string,
  opts: { portal?: Portal; encode?: boolean } = {},
) {
  const headers: Record<string, string> =
    fileName === undefined ? {} : { 'x-file-name': opts.encode === false ? fileName : encodeURIComponent(fileName) };
  const sent = body instanceof ReadableStream ? body : new Uint8Array(body);
  const answer = await world.answerOf((opts.portal ?? world.admin).post('/api/plugins/uploads', sent, headers));
  if (typeof answer.body.uploadId === 'string') of(world).ids.push(answer.body.uploadId);
  if (Buffer.isBuffer(body) && fileName !== undefined) of(world).last = { fileName, archive: body };
  return answer;
}

async function staged(world: SynoikiaWorld, archive: Buffer, fileName = 'tasks.tgz') {
  const answer = await upload(world, archive, fileName);
  expect(answer.status, JSON.stringify(answer)).toBe(201);
}

const installUpload = (world: SynoikiaWorld, id = of(world).ids.at(-1)!) => {
  of(world).viewsBeforeInstall = world.upstreamRequests('GET', '/views').length;
  return world.answerOf(world.admin.post(`/api/plugins/uploads/${id}/install`));
};

async function installed(world: SynoikiaWorld, archive: Buffer, fileName?: string) {
  await staged(world, archive, fileName);
  const answer = await installUpload(world);
  expect(answer.status, JSON.stringify(answer)).toBe(200);
}

const notes = (version: string, name: string) =>
  tasksArchive(version, (m) => {
    m.id = 'notes';
    m.name = name;
  });

When(
  'the admin uploads the build {string} of Acme Tasks {word}',
  async (world: SynoikiaWorld, file: string, v: string) => {
    await upload(world, tasksBuild(v), file);
  },
);

Given(
  'the admin uploaded the build {string} of Acme Tasks {word}',
  async (world: SynoikiaWorld, file: string, v: string) => {
    await staged(world, tasksBuild(v), file);
  },
);

Given(
  'the admin installed the build {string} of Acme Tasks {word}',
  async (world: SynoikiaWorld, file: string, v: string) => {
    await installed(world, tasksBuild(v), file);
  },
);

Then(
  'the admin is shown Acme Tasks {word} with its checksum, its file name and a compatible plugin SDK',
  (world: SynoikiaWorld, version: string) => {
    const { fileName, archive } = of(world).last!;
    expect(world.portalAnswer).toMatchObject({
      status: 201,
      body: { pluginId: 'tasks', version, sha256: sha256(archive), fileName, sdkCompatible: true },
    });
  },
);

Then(
  'the admin is shown that it replaces Acme Tasks {word} from {string}, enabled, with no permission changes',
  (world: SynoikiaWorld, version: string, name: string) => {
    expect(world.portalAnswer.body).toMatchObject({
      replaces: { version, repoName: name, manual: false, enabled: true },
      permissionChanges: [],
    });
  },
);

When('the admin installs the upload', async (world: SynoikiaWorld) => {
  await installUpload(world);
});

When('the admin installs the same upload again', async (world: SynoikiaWorld) => {
  await installUpload(world);
});

When('the admin installs the first upload', async (world: SynoikiaWorld) => {
  await installUpload(world, of(world).ids[0]);
});

Then(
  'Acme Tasks {word} is enabled and unverified, and marked as manual with the released version {word}',
  async (world: SynoikiaWorld, version: string, released: string) => {
    expect(world.portalAnswer.status, JSON.stringify(world.portalAnswer)).toBe(200);
    expect(await world.plugin()).toMatchObject({
      version,
      enabled: true,
      signatureVerified: false,
      manual: { fileName: of(world).last!.fileName, releasedVersion: released },
    });
  },
);

Then(
  '{string} is ready, still reaches Acme with its token, and the audit log shows the manual install',
  async (world: SynoikiaWorld, slug: string) => {
    const id = world.instances.get(slug)!;
    const status = async () =>
      (await world.expectOk(world.admin.get(`/api/instances/${id}`), 'read instance')).status as string;
    await eventually(async () => (await status()) === 'ready', `${slug} to be ready`);
    await world.sync(slug);
    const views = world.upstreamRequests('GET', '/views');
    expect(views.length).toBeGreaterThan(of(world).viewsBeforeInstall!);
    expect(views.at(-1)?.headers.authorization).toBe(`Bearer ${API_TOKEN}`);
    const { fileName, archive } = of(world).last!;
    expect((await auditOf(world, 'plugin_manual_installed')).map((r) => r.detail)).toEqual([
      {
        pluginId: 'tasks',
        version: '1.1.0-dev.1',
        previousVersion: '1.0.0',
        sha256: sha256(archive),
        fileName,
        releasedVersion: '1.0.0',
        enabled: true,
      },
    ]);
  },
);

Then('{string} is ready', async (world: SynoikiaWorld, slug: string) => {
  const id = world.instances.get(slug)!;
  const instance = await world.expectOk(world.admin.get(`/api/instances/${id}`), 'read instance');
  expect(instance.status).toBe('ready');
});

Then('the admin is told that the upload is not there', (world: SynoikiaWorld) => {
  expectError(world, 'upload_not_found');
});

Given(
  'the admin uploaded a build of Acme Tasks {word} that asks for one more network host',
  async (world: SynoikiaWorld, version: string) => {
    const archive = tasksArchive(version, (m) => {
      m.network = { hosts: ['127.0.0.1', 'sync.acme.example'] };
    });
    await staged(world, archive);
    expect(world.portalAnswer.body.permissionChanges).toEqual(['network.hosts']);
  },
);

Then(
  'the audit log shows that the manual install needs a review of its network hosts',
  async (world: SynoikiaWorld) => {
    expect((await auditOf(world, 'plugin_manual_installed')).at(-1)?.detail).toMatchObject({
      enabled: false,
      needsReview: ['network.hosts'],
    });
  },
);

Given(
  'the admin uploaded a build of the new plugin {string} {word}',
  async (world: SynoikiaWorld, n: string, v: string) => {
    await staged(world, notes(v, n));
    expect(world.portalAnswer.body).toMatchObject({ pluginId: 'notes', replaces: null, permissionChanges: [] });
  },
);

Given(
  'the admin installed a build of the new plugin {string} {word}',
  async (world: SynoikiaWorld, n: string, v: string) => {
    await installed(world, notes(v, n));
  },
);

Then(
  'Acme Notes {word} is disabled, comes from no repository, and has no released version',
  async (world: SynoikiaWorld, version: string) => {
    expect(await world.plugin('notes')).toMatchObject({
      version,
      enabled: false,
      status: 'ok',
      repoId: null,
      manual: { releasedVersion: null },
    });
  },
);

When('the admin reverts Acme {word}', async (world: SynoikiaWorld, plugin: string) => {
  await world.answerOf(world.admin.post(`/api/plugins/${plugin.toLowerCase()}/revert`));
});

Then('Acme Tasks {word} is enabled and no longer marked as manual', async (world: SynoikiaWorld, version: string) => {
  expect(world.portalAnswer.status, JSON.stringify(world.portalAnswer)).toBeLessThan(300);
  expect(await world.plugin()).toMatchObject({
    version,
    enabled: true,
    manual: null,
    sha256: sha256(tasksBuild(version)),
  });
});

Then('the audit log shows that the revert replaced {string}', async (world: SynoikiaWorld, file: string) => {
  expect((await auditOf(world, 'plugin_manual_reverted')).at(-1)?.detail).toMatchObject({
    version: '1.0.0',
    previousVersion: '1.1.0-dev.1',
    replacedFile: file,
    replacedSha256: sha256(of(world).last!.archive),
  });
});

Then('the audit log shows that the update replaced {string}', async (world: SynoikiaWorld, file: string) => {
  expect((await auditOf(world, 'plugin_updated')).at(-1)?.detail).toMatchObject({ replacedFile: file });
});

Then('the admin is told that the plugin has no released version to revert to', (world: SynoikiaWorld) => {
  expectError(world, 'not_manual');
});

Given('{string} now offers only Acme Tasks {word}', async (world: SynoikiaWorld, name: string, version: string) => {
  world.repository(name).builds = [];
  world.offer(name, version);
  await world.expectOk(world.refreshRepository(name), 'refresh repository');
});

Then(
  'the admin is told that Acme Tasks {word} is no longer in {string}',
  (world: SynoikiaWorld, version: string, name: string) => {
    expectError(world, 'released_version_gone');
    expect(world.portalAnswer.body.message).toBe(`tasks@${version} is no longer in ${name}`);
  },
);

When('the admin uploads a file of 50 MB and 1 byte', async (world: SynoikiaWorld) => {
  await upload(world, Buffer.alloc(50 * 1024 * 1024 + 1), 'big.tgz');
});

When('the admin streams a file of {int} MB without a size', async (world: SynoikiaWorld, mb: number) => {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= mb * 1024 * 1024) return controller.close();
      sent += 1024 * 1024;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });
  await upload(world, stream, 'big.tgz');
});

Then('the admin is told that the file is too large', (world: SynoikiaWorld) => {
  expectError(world, 'too_large');
});

When('the admin uploads the text {string} as {string}', async (world: SynoikiaWorld, text: string, file: string) => {
  await upload(world, Buffer.from(text), file);
});

When(
  'the admin uploads a build of Acme Tasks with a link to {string}',
  async (world: SynoikiaWorld, target: string) => {
    const archive = rawArchive([
      { name: 'manifest.json', type: '0', body: tasksManifest('1.1.0') },
      { name: 'index.mjs', type: '2', link: target },
    ]);
    await upload(world, archive, 'tasks.tgz');
  },
);

When('the admin uploads a build of Acme Tasks without its entry file', async (world: SynoikiaWorld) => {
  await upload(world, tasksArchive('1.1.0', undefined, { 'index.mjs': null }), 'tasks.tgz');
});

Then('the admin is told that the plugin is not valid', (world: SynoikiaWorld) => {
  expectError(world, 'invalid_plugin');
});

When('the admin uploads a build of Acme Tasks without a file name', async (world: SynoikiaWorld) => {
  await upload(world, tasksBuild('1.1.0'));
});

Then('the admin is told that the request is not valid', (world: SynoikiaWorld) => {
  expectError(world, 'invalid_request');
});

When(
  'the admin uploads a build of Acme Tasks named {string}, a tab, and {string}',
  async (world: SynoikiaWorld, a: string, b: string) => {
    await upload(world, tasksBuild('1.1.0'), `${a}\t${b}`);
  },
);

When(
  'the admin uploads a build of Acme Tasks named {string}, a right-to-left override, and {string}',
  async (world: SynoikiaWorld, a: string, b: string) => {
    await upload(world, tasksBuild('1.1.0'), `${a}‮${b}`);
  },
);

When(
  'the admin uploads a build of Acme Tasks with the encoded name {string}',
  async (world: SynoikiaWorld, name: string) => {
    await upload(world, tasksBuild('1.1.0'), name, { encode: false });
  },
);

Then('the admin is told that the file name is not valid', (world: SynoikiaWorld) => {
  expectError(world, 'invalid_file_name');
});

Then('the admin is shown the file name {string}', (world: SynoikiaWorld, file: string) => {
  expect(world.portalAnswer).toMatchObject({ status: 201, body: { fileName: file } });
});

When('the admin uploads two builds of Acme Tasks at once', async (world: SynoikiaWorld) => {
  // The first build has thousands of files. Small uploads follow it until one arrives while it still unpacks.
  manyFiles ??= tasksArchive(
    '1.1.0',
    undefined,
    Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`f${i}.txt`, 'x'])),
  );
  let done = false;
  const first = world
    .answerOf(world.admin.post('/api/plugins/uploads', new Uint8Array(manyFiles), { 'x-file-name': 'a.tgz' }))
    .finally(() => (done = true));
  const answers: Awaited<ReturnType<SynoikiaWorld['answerOf']>>[] = [];
  while (!done && !answers.some((a) => a.status === 409)) {
    const small = world.admin.post('/api/plugins/uploads', new Uint8Array(tasksBuild('1.1.0')), {
      'x-file-name': 'b.tgz',
    });
    answers.push(await world.answerOf(small));
  }
  answers.push(await first);
  world.portalAnswer = answers.find((a) => a.status === 409) ?? answers.at(-1)!;
});

Then('the admin is told that another upload is being processed', (world: SynoikiaWorld) => {
  expectError(world, 'upload_in_progress');
});

Then('the admin is told that the upload expired', (world: SynoikiaWorld) => {
  expectError(world, 'upload_expired');
});

Then(
  'Acme Tasks {word} is still installed and enabled, with no manual install in the audit log',
  async (world: SynoikiaWorld, version: string) => {
    expect(await world.plugin()).toMatchObject({ version, enabled: true, manual: null });
    expect(await auditOf(world, 'plugin_manual_installed')).toEqual([]);
  },
);

Given(
  'the admin uploaded a build of Acme Tasks {word} for the plugin SDK {word}',
  async (world: SynoikiaWorld, version: string, sdk: string) => {
    const archive = tasksArchive(version, (m) => {
      m.sdk = sdk;
    });
    await staged(world, archive);
    expect(world.portalAnswer.body).toMatchObject({ sdkCompatible: false, sdk });
  },
);

Then('the admin is told that the build needs the plugin SDK {word}', (world: SynoikiaWorld, sdk: string) => {
  expectError(world, 'incompatible');
  expect(world.portalAnswer.body.message).toContain(`needs plugin SDK ${sdk}`);
});

Given(
  'a slow install of Acme Tasks {word} from {string} runs',
  async (world: SynoikiaWorld, version: string, name: string) => {
    world.repoDelayMs = 1500;
    of(world).running = world.installFrom(name, version);
    const archive = new URL(`tasks-${version}.tgz`, world.repository(name).url).toString();
    await eventually(() => world.repoFetched.includes(archive), 'the download of the build');
  },
);

Then('the admin is told that an install of Acme Tasks is in progress', (world: SynoikiaWorld) => {
  expectError(world, 'install_in_progress');
});

Then('the admin can install the upload once that install ends', async (world: SynoikiaWorld) => {
  expect((await of(world).running!).status).toBe(201);
  const answer = await installUpload(world);
  expect(answer).toMatchObject({ status: 200, body: { version: '1.1.0-dev.1' } });
});

When(
  'user {int} uploads the build {string} of Acme Tasks {word}',
  async (world: SynoikiaWorld, user: number, file: string, version: string) => {
    await upload(world, tasksBuild(version), file, { portal: world.person(`user ${user}`).portal });
  },
);

When('user {int} reverts Acme Tasks', async (world: SynoikiaWorld, user: number) => {
  await world.answerOf(world.person(`user ${user}`).portal!.post('/api/plugins/tasks/revert'));
});

Then('user {int} is told that only an admin can do this', (world: SynoikiaWorld) => {
  expect(world.portalAnswer.status).toBe(403);
});
