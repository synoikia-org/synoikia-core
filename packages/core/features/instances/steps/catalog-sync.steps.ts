import { readFileSync, rmSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { eventually, opKey } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

const openTasks = (list: string) => `return await tasks.call('lists.tasks', ${JSON.stringify({ list })});`;

Given(
  'the plugin of {string} was updated to version {word} with the new read {string}',
  async (world: SynoikiaWorld, slug: string, version: string, name: string) => {
    world.changeCatalog({ add: [{ name, group: 'lists', classification: 'read' }] });
    await world.editManifest((m) => {
      m.version = version;
    });
    await world.restartPlugin(slug);
  },
);

Given(
  'the manifest of Acme Tasks says version {word}, and the admin rescans the plugins folder',
  async (world: SynoikiaWorld, version: string) => {
    await world.editManifest((m) => {
      m.version = version;
    });
  },
);

Given('Acme gets the saved view {string}', (world: SynoikiaWorld, view: string) => {
  world.views.push(view);
});

Given(
  'the plugin of {string} sends the new read {string}, and {string} twice',
  (world: SynoikiaWorld, _slug: string, _name: string, _twice: string) => {
    world.pluginFlag('catalog-output', 'duplicate');
  },
);

Given(
  'the plugin of {string} sends the new read {string}, and {string} without its classification',
  (world: SynoikiaWorld) => {
    world.pluginFlag('catalog-output', 'no-classification');
  },
);

Given(
  'the plugin of {string} sends the new read {string}, and result secrets of {string} that name no field',
  (world: SynoikiaWorld) => {
    world.pluginFlag('catalog-output', 'empty-secret-keys');
  },
);

When(
  'agent {word} asks for the open tasks of {string} before and after the plugin lists its operations again',
  async (world: SynoikiaWorld, agent: string, list: string) => {
    await world.execute(agent, world.lastInstance, openTasks(list));
    const before = world.answer;
    rmSync(world.pluginFile('catalog-broken'));
    await world.execute(agent, world.lastInstance, openTasks(list));
    world.answer = { before, after: world.answer };
  },
);

When('the plugin of {string} reports that its catalog changed', (world: SynoikiaWorld) => {
  world.pluginFlag('catalog-changed', String(Date.now()));
});

Then(
  'agent {word} is first told that {string} is unavailable, and then gets {string}, {string} and {string}',
  (world: SynoikiaWorld, _agent: string, _slug: string, a: string, b: string, c: string) => {
    expect(String((world.answer.before as { refused?: string }).refused)).toContain('Endpoint unavailable');
    expect(world.answer.after).toMatchObject({ result: [a, b, c].map((title) => ({ title, done: false })) });
  },
);

Then(
  'the admin sees the saved view {string} in the catalog of {string} within {int} seconds',
  async (world: SynoikiaWorld, view: string, slug: string, seconds: number) => {
    const t0 = Date.now();
    await eventually(
      async () => (await world.operations(slug)).some((o) => o.key === `views.${view}`),
      'the saved view',
      seconds * 1000,
    );
    expect(Date.now() - t0).toBeLessThan(seconds * 1000);
  },
);

Then(
  'the admin sees the {int} operations of {string} as before, without {string}',
  async (world: SynoikiaWorld, count: number, slug: string, name: string) => {
    const ops = await world.operations(slug);
    expect(ops).toHaveLength(count);
    expect(ops.map((o) => o.key)).not.toContain(opKey(name));
  },
);

// ── memory of a large sync ──

/** The anonymous memory of this process, where the World runs core, after a full collection. */
async function coreMemoryMb() {
  setFlagsFromString('--expose-gc');
  (runInNewContext('gc') as () => void)();
  await new Promise((r) => setTimeout(r, 200));
  const rollup = readFileSync('/proc/self/smaps_rollup', 'utf8');
  return Number(/Anonymous:\s+(\d+)/.exec(rollup)![1]) / 1024;
}

const memoryBefore = new WeakMap<SynoikiaWorld, number>();

Given(
  'Acme Tasks runs as the instance {string}, and its plugin lists 3,000 operations',
  async (world: SynoikiaWorld, slug: string) => {
    await world.tasksInstance(slug);
    const add = Array.from({ length: 3000 }, (_, i) => ({
      key: `reports.r${i}`,
      displayName: `show report ${i}`,
      group: 'reports',
      classification: 'read',
    }));
    world.pluginFlag('catalog-changes', JSON.stringify({ add }));
    memoryBefore.set(world, await coreMemoryMb());
  },
);

When('the admin syncs {string} twice', async (world: SynoikiaWorld, slug: string) => {
  await world.sync(slug);
  await world.sync(slug);
});

Then('core holds at most {int} MB more memory than before the first sync', async (world: SynoikiaWorld, mb: number) => {
  expect((await world.operations(world.lastInstance)).length).toBeGreaterThan(3000);
  expect((await coreMemoryMb()) - memoryBefore.get(world)!).toBeLessThanOrEqual(mb);
});
