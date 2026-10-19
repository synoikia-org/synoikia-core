import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { API_TOKEN } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

type Answer = SynoikiaWorld['portalAnswer'];
const answers = new WeakMap<SynoikiaWorld, Answer[]>();
const keep = async (world: SynoikiaWorld, res: Promise<Response>) => {
  const answer = { ...(await world.answerOf(res)) };
  answers.set(world, [...(answers.get(world) ?? []), answer]);
  return answer;
};
const kept = (world: SynoikiaWorld) => answers.get(world) ?? [];

const instance = async (world: SynoikiaWorld, slug: string) =>
  world.expectOk(world.admin.get(`/api/instances/${await world.tasksInstance(slug)}`), 'read instance');

const connection = async (world: SynoikiaWorld, slug: string) =>
  (await world.expectOk(
    world.admin.get(`/api/instances/${await world.tasksInstance(slug)}/connection`),
    'read connection',
  )) as { secrets: Record<string, { set: boolean; hint?: string }> };

const enablePlugin = async (world: SynoikiaWorld) => {
  const plugin = (await world.plugin())!;
  await world.expectOk(world.admin.patch(`/api/plugins/${plugin.id}`, { enabled: true }), 'enable plugin');
};

const addInstance = (world: SynoikiaWorld, slug: string, connection: Record<string, unknown>, pluginId = 'tasks') =>
  keep(world, world.admin.post('/api/instances', { pluginId, slug, connection }));

const saveConnection = async (world: SynoikiaWorld, slug: string, secrets: Record<string, string | null>) =>
  keep(
    world,
    world.admin.put(`/api/instances/${await world.tasksInstance(slug)}/connection`, {
      config: { url: world.upstream!.url },
      secrets,
    }),
  );

const reports = (world: SynoikiaWorld) =>
  world.upstreamRequests('POST', '/report').map((r) => r.body as { secrets: string[] });

// ── a new instance ──

Then(
  '{string} is ready, and its connection shows the API token as set, ending in {string}',
  async (world: SynoikiaWorld, slug: string, end: string) => {
    expect(await instance(world, slug)).toMatchObject({ status: 'ready' });
    const shown = await connection(world, slug);
    expect(shown.secrets.token).toEqual({ set: true, hint: `…${end}` });
    expect(JSON.stringify(shown)).not.toContain(API_TOKEN);
  },
);

Then(
  'the audit log shows that the admin added {string} with the secret {string}, and not its value',
  async (world: SynoikiaWorld, slug: string, secret: string) => {
    const rows = await world.audit({ decision: 'instance_created' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toMatchObject({ slug, plugin: 'tasks', secrets: [secret] });
    expect(JSON.stringify(rows)).not.toContain(API_TOKEN);
  },
);

// ── names and connections ──

When(
  'the admin tries to add the instances {string} and {string}',
  async (world: SynoikiaWorld, a: string, b: string) => {
    await enablePlugin(world);
    for (const slug of [a, b]) await addInstance(world, slug, { url: world.upstream!.url, token: API_TOKEN });
  },
);

Then('the admin is told both times that the name is not valid', (world: SynoikiaWorld) => {
  expect(kept(world).map((a) => [a.status, a.body.error])).toEqual([
    [400, 'invalid_slug'],
    [400, 'invalid_slug'],
  ]);
});

When('the admin tries to add another instance {string}', async (world: SynoikiaWorld, slug: string) => {
  await addInstance(world, slug, { url: world.upstream!.url, token: API_TOKEN });
});

Then('the admin is told that {string} is already in use', (world: SynoikiaWorld, slug: string) => {
  expect(kept(world).at(-1)).toMatchObject({
    status: 409,
    body: { error: 'slug_taken', message: `/${slug} is already in use` },
  });
});

When(
  'the admin tries to add {string} without the address of Acme, and {string} with the plugin {string}',
  async (world: SynoikiaWorld, slug: string, other: string, pluginId: string) => {
    await enablePlugin(world);
    await addInstance(world, slug, { token: API_TOKEN });
    await addInstance(world, other, { url: world.upstream!.url }, pluginId);
  },
);

Then(
  'the admin is told that the connection is not valid, and that there is no plugin {string}',
  (world: SynoikiaWorld, pluginId: string) => {
    const [noAddress, noPlugin] = kept(world);
    expect(noAddress).toMatchObject({ status: 400, body: { error: 'invalid_connection' } });
    expect(noPlugin).toMatchObject({
      status: 404,
      body: { error: 'plugin_not_found', message: `No plugin "${pluginId}"` },
    });
  },
);

// ── connection edits ──

When(
  'the admin sets the webhook secret of {string} to {string}',
  async (world: SynoikiaWorld, slug: string, secret: string) => {
    expect((await saveConnection(world, slug, { webhookSecret: secret })).status).toBe(200);
  },
);

Then(
  'Acme hears that the plugin started again with the secrets {string} and {string}',
  (world: SynoikiaWorld, a: string, b: string) => {
    const sent = reports(world);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.secrets).toEqual([a]);
    expect(sent[1]!.secrets).toEqual([a, b].sort());
  },
);

When('the admin clears the webhook secret of {string}', async (world: SynoikiaWorld, slug: string) => {
  expect((await saveConnection(world, slug, { webhookSecret: null })).status).toBe(200);
});

Then(
  'the admin sees that the webhook secret is not set, and that the API token still ends in {string}',
  async (world: SynoikiaWorld, end: string) => {
    expect((await connection(world, world.lastInstance)).secrets).toEqual({
      token: { set: true, hint: `…${end}` },
      webhookSecret: { set: false },
    });
  },
);

When(
  'the admin tries to save the connection of {string} with the secret {string}',
  async (world: SynoikiaWorld, slug: string, secret: string) => {
    await saveConnection(world, slug, { [secret]: 'hunter2-hunter2' });
  },
);

Then('the admin is told that {string} is not a secret of Acme Tasks', (world: SynoikiaWorld, secret: string) => {
  expect(kept(world).at(-1)).toMatchObject({
    status: 400,
    body: { error: 'unknown_secret', message: `"${secret}" is not a secret field of this plugin` },
  });
});

// ── switches ──

When('the admin enables the instance {string}', async (world: SynoikiaWorld, slug: string) => {
  await world.expectOk(
    world.admin.patch(`/api/instances/${await world.tasksInstance(slug)}`, { enabled: true }),
    'enable instance',
  );
});

Given('the admin disabled Acme Tasks', async (world: SynoikiaWorld) => {
  const plugin = (await world.plugin())!;
  await world.expectOk(world.admin.patch(`/api/plugins/${plugin.id}`, { enabled: false }), 'disable plugin');
});

Then(
  'the admin sees that {string} is stopped, and agent {word} is told that {string} is unavailable',
  async (world: SynoikiaWorld, slug: string) => {
    expect(await instance(world, slug)).toMatchObject({ status: 'stopped' });
    expect(String(world.answer.refused)).toContain('This instance is unavailable');
  },
);

// ── connection tests ──

When('the admin tests {string} with the address {string}', async (world: SynoikiaWorld, slug: string, url: string) => {
  const id = await world.tasksInstance(slug);
  await keep(
    world,
    world.admin.post(`/api/instances/${id}/connection/test`, { config: { url }, secrets: { token: API_TOKEN } }),
  );
});

Then(
  'the admin is told that the test cannot reach Acme, and {string} is still ready',
  async (world: SynoikiaWorld, slug: string) => {
    expect(kept(world).at(-1)!.body).toMatchObject({ ok: false, message: 'cannot reach upstream' });
    expect(await instance(world, slug)).toMatchObject({ status: 'ready', statusError: null });
  },
);

const testFrom = async (world: SynoikiaWorld, slug: string, address: string) =>
  keep(
    world,
    world.admin.post(
      `/api/instances/${await world.tasksInstance(slug)}/connection/test`,
      { config: { url: world.upstream!.url } },
      {
        'x-forwarded-for': address,
      },
    ),
  );

Given(
  'someone tried to sign in {int} times from the address {string}, and the admin tested {string} once from there',
  async (world: SynoikiaWorld, times: number, address: string, slug: string) => {
    await world.restartCore({ TRUST_PROXY: '1' });
    const stranger = await world.portalBrowser({ 'x-forwarded-for': address });
    for (let i = 0; i < times; i++)
      expect((await stranger.post('/auth/login', { username: 'ghost', password: 'not the password' })).ok).toBe(false);
    expect((await testFrom(world, slug, address)).body).toMatchObject({ ok: true });
  },
);

When(
  'the admin tests the connection of {string} again from the address {string}',
  async (world: SynoikiaWorld, slug: string, address: string) => {
    await testFrom(world, slug, address);
  },
);

Then('the admin is told that there were too many attempts', (world: SynoikiaWorld) => {
  expect(kept(world).at(-1)).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
});

// ── plugin versions ──

Given('the connection schema of Acme Tasks has the id {string}', async (world: SynoikiaWorld, id: string) => {
  await world.editManifest((m) => {
    (m.connection as { schema: Record<string, unknown> }).schema.$id = id;
  });
});

Given(
  'Acme Tasks {word} keeps that id, and also requires the field {string}',
  async (world: SynoikiaWorld, version: string, field: string) => {
    await world.editManifest((m) => {
      m.version = version;
      const schema = (m.connection as { schema: { properties: Record<string, unknown>; required: string[] } }).schema;
      schema.properties[field] = { type: 'string' };
      schema.required = [...schema.required, field];
    });
  },
);

When('the admin saves the connection of {string} without a workspace', async (world: SynoikiaWorld, slug: string) => {
  await saveConnection(world, slug, {});
});

Then(
  'the admin is told that the connection is not valid, because {string} is missing',
  (world: SynoikiaWorld, field: string) => {
    const answer = kept(world).at(-1)!;
    expect(answer).toMatchObject({ status: 400, body: { error: 'invalid_connection' } });
    expect(JSON.stringify(answer.body)).toContain(`must have required property '${field}'`);
  },
);
