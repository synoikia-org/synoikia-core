import { rmSync } from 'node:fs';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { API_TOKEN, eventually, opKey } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';
import { identity } from '../../identity/steps/identity.js';

const HOUR = 60 * 60_000;

const state = new WeakMap<SynoikiaWorld, { synced: Map<string, string>; summary: Record<string, unknown> }>();
const of = (world: SynoikiaWorld) => {
  let s = state.get(world);
  if (!s) state.set(world, (s = { synced: new Map(), summary: {} }));
  return s;
};

async function instance(world: SynoikiaWorld, slug: string) {
  return world.expectOk(world.admin.get(`/api/instances/${world.instances.get(slug)!}`), 'read instance');
}

/** The search of the last answer, by operation key. */
const foundKeys = (world: SynoikiaWorld) =>
  ((world.answer.result as { key: string }[] | undefined) ?? []).map((o) => o.key);

Given('the admin added the instance {string} without a sync', async (world: SynoikiaWorld, slug: string) => {
  const plugins = (await world.expectOk(world.admin.get('/api/plugins'), 'list plugins')) as unknown as {
    id: string;
    pluginId: string;
  }[];
  const plugin = plugins.find((p) => p.pluginId === 'tasks')!;
  await world.expectOk(world.admin.patch(`/api/plugins/${plugin.id}`, { enabled: true }), 'enable plugin');
  const created = await world.expectOk(
    world.admin.post('/api/instances', {
      pluginId: 'tasks',
      slug,
      connection: { url: world.upstream!.url, token: API_TOKEN },
    }),
    'create instance',
  );
  world.instances.set(slug, created.id as string);
  world.lastInstance = slug;
});

Given(
  'agent {word} of the admin has an open session on {string}',
  async (world: SynoikiaWorld, agent: string, slug: string) => {
    await world.tasksInstance(slug);
    await world.credential(agent, 'admin', 'write');
    await world.session(agent, slug);
  },
);

Given(
  'Acme gets the saved view {string}, and {int} minutes go by',
  (world: SynoikiaWorld, view: string, minutes: number) => {
    world.views.push(view);
    world.passTime(minutes * 60_000);
  },
);

Given(
  'Acme moves to version {string} with the saved view {string}, and {int} minutes go by',
  (world: SynoikiaWorld, version: string, view: string, minutes: number) => {
    world.views.push(view);
    world.pluginFlag('upstream-version', version);
    world.passTime(minutes * 60_000);
  },
);

Given(
  '{string} last synced {int} hours ago and {string} {int} hours ago',
  async (world: SynoikiaWorld, first: string, firstAgo: number, second: string, secondAgo: number) => {
    await world.tasksInstance(first);
    await world.tasksInstance(second);
    world.passTime((firstAgo - secondAgo) * HOUR);
    await world.signInAgain();
    await world.sync(second);
    world.passTime(secondAgo * HOUR);
    await world.signInAgain();
    for (const slug of [first, second])
      of(world).synced.set(slug, (await instance(world, slug)).lastSyncedAt as string);
  },
);

When('the hourly sync runs', async (world: SynoikiaWorld) => {
  // The daily sync is checked at each start of core, and then each hour.
  await world.restartCore();
  await world.signInAgain();
});

When(
  'agent {word} opens two sessions on {string} at the same moment',
  async (world: SynoikiaWorld, agent: string, slug: string) => {
    await Promise.all([world.connect(agent, slug), world.connect(agent, slug)]);
  },
);

When(
  'the plugin of {string} lists its operations again, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, slug: string) => {
    rmSync(world.pluginFile('catalog-broken'));
    await world.sync(slug);
  },
);

When(
  'the admin syncs {string} while its plugin cannot list its operations',
  async (world: SynoikiaWorld, slug: string) => {
    world.pluginFlag('catalog-broken');
    const res = await world.admin.post(`/api/instances/${await world.tasksInstance(slug)}/sync`);
    expect(res.ok).toBe(false);
  },
);

Given('the admin gets a notification when a sync fails', async (world: SynoikiaWorld) => {
  identity(world).inbox = await world.notificationInbox(['sync.failed']);
});

When('the admin syncs {string} now', async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  of(world).summary = await world.expectOk(world.admin.post(`/api/instances/${id}/sync`), 'sync instance');
});

Then('agent {word} finds the operation {string}', (world: SynoikiaWorld, _agent: string, name: string) => {
  expect(foundKeys(world)).toContain(opKey(name));
});

Then('agent {word} finds the saved view {string}', (world: SynoikiaWorld, _agent: string, view: string) => {
  expect(foundKeys(world)).toContain(`views.${view}`);
});

Then('the admin sees that {string} synced', async (world: SynoikiaWorld, slug: string) => {
  const i = await instance(world, slug);
  expect(i.lastSyncedAt).toBeTruthy();
  expect(i.lastSyncStatus).toBe('ok');
});

Then(
  'the admin sees that {string} synced again, and {string} did not',
  async (world: SynoikiaWorld, again: string, not: string) => {
    // The daily sync runs in the background after the start.
    await eventually(
      async () => (await instance(world, again)).lastSyncedAt !== of(world).synced.get(again),
      `the sync of ${again}`,
    );
    expect((await instance(world, not)).lastSyncedAt).toBe(of(world).synced.get(not));
  },
);

Then('Acme was asked for its catalog once', (world: SynoikiaWorld) => {
  expect(world.upstreamRequests('GET', '/views')).toHaveLength(1);
});

Then('the admin sees {string} with the error {string}', async (world: SynoikiaWorld, slug: string, error: string) => {
  expect(await instance(world, slug)).toMatchObject({ status: 'error', statusError: error });
});

Then('the admin sees that {string} is ready', async (world: SynoikiaWorld, slug: string) => {
  expect(await instance(world, slug)).toMatchObject({ status: 'ready', statusError: null });
});

Then('the admin is told that the sync added {int} operations', (world: SynoikiaWorld, count: number) => {
  expect(of(world).summary).toMatchObject({ added: count });
});
