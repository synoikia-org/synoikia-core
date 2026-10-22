import { mkdirSync, renameSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { eventually } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

/** What the plugin told Acme about its process when it started. */
const report = (world: SynoikiaWorld) => {
  const sent = world.upstreamRequests('POST', '/report').at(-1);
  if (!sent) throw new Error('The plugin told Acme nothing');
  return sent.body as {
    ownFile: string;
    systemFile: string;
    coreKey: string;
    coreDatabase: string;
    write: string;
    env: string[];
    secrets: string[];
    config: string[];
  };
};

Given('the plugin of {string} tells Acme what it can reach when it starts', (world: SynoikiaWorld) => {
  world.pluginFlag('report');
});

Given('the folder of Acme Tasks in the plugins folder is a link to another folder', (world: SynoikiaWorld) => {
  const folder = path.dirname(world.pluginFile('manifest.json'));
  const elsewhere = path.join(world.dataDir, 'elsewhere');
  mkdirSync(elsewhere);
  renameSync(folder, path.join(elsewhere, 'tasks'));
  symlinkSync(path.join(elsewhere, 'tasks'), folder);
});

Given('the plugin of {string} signals core to open its debugger and tries to connect to it', (world: SynoikiaWorld) => {
  world.pluginFlag('debugger');
});

Then(
  'Acme hears that the plugin found no debugger of core, and agent {word} gets {string}, {string} and {string}',
  (world: SynoikiaWorld, _agent: string, a: string, b: string, c: string) => {
    expect(world.upstreamRequests('POST', '/debugger').at(-1)?.body).toEqual({ debugger: 'none' });
    expect(world.answer).toEqual({ result: [a, b, c] });
  },
);

Then('the audit log warns that core refused to open its debugger', async (world: SynoikiaWorld) => {
  expect(await world.audit({ decision: 'debugger_refused' })).toHaveLength(1);
});

Given('the plugin of {string} sends an operation without its classification', (world: SynoikiaWorld) => {
  world.pluginFlag('catalog-output', 'no-classification');
});

Given('the plugin of {string} no longer knows how to run a call', (world: SynoikiaWorld) => {
  world.pluginFlag('forget', 'invoke');
});

Given(
  'core waits {int} second for each answer of the plugin of {string}, which never answers',
  async (world: SynoikiaWorld, seconds: number) => {
    world.supervision = { ...world.supervision, rpcTimeoutMs: seconds * 1000 };
    await world.restartCore();
    world.pluginFlag('hang', 'resolveOperation');
  },
);

Given('the plugin of {string} dies when it is asked to run a call', (world: SynoikiaWorld) => {
  world.pluginFlag('crash', 'invoke');
});

When(
  'agent {word} asks for the open tasks of {string} twice in one run',
  async (world: SynoikiaWorld, agent: string, list: string) => {
    const call = `tasks.call('lists.tasks', ${JSON.stringify({ list })})`;
    await world.execute(
      agent,
      world.lastInstance,
      `const out = [];\nfor (let i = 0; i < 2; i++) {\n  try { await ${call}; out.push('ok'); } catch (e) { out.push(e.code); }\n}\nreturn out;`,
    );
  },
);

Then('Acme hears that the plugin read its own manifest', (world: SynoikiaWorld) => {
  expect(report(world).ownFile).toBe('allowed');
});

Then(
  'Acme hears that the plugin could not read a system file or the files of core, and could not write a file',
  (world: SynoikiaWorld) => {
    expect(report(world)).toMatchObject({
      systemFile: 'ERR_ACCESS_DENIED',
      coreKey: 'ERR_ACCESS_DENIED',
      coreDatabase: 'ERR_ACCESS_DENIED',
      write: 'ERR_ACCESS_DENIED',
    });
  },
);

Then(
  'Acme hears that the plugin got only {string} and {string} from the environment of core',
  (world: SynoikiaWorld, a: string, b: string) => {
    expect(report(world).env).toEqual([a, b].sort());
  },
);

Then(
  'Acme hears that the plugin got the address {string} and the secret {string}',
  (world: SynoikiaWorld, address: string, secret: string) => {
    expect(report(world)).toMatchObject({ config: [address], secrets: [secret] });
  },
);

/** The admin's answer to "sync now". */
const syncAnswers = new WeakMap<SynoikiaWorld, { status: number; body: Record<string, unknown> }>();

When('the admin tries to sync {string}', async (world: SynoikiaWorld, slug: string) => {
  const res = await world.admin.post(`/api/instances/${await world.tasksInstance(slug)}/sync`);
  syncAnswers.set(world, { status: res.status, body: (await res.json()) as Record<string, unknown> });
});

Then(
  'the admin is told that the sync failed, because the plugin sent a catalog that is not valid',
  (world: SynoikiaWorld) => {
    expect(syncAnswers.get(world)).toMatchObject({
      status: 502,
      body: {
        error: 'sync_failed',
        message: expect.stringMatching(/^Invalid syncCatalog result from plugin: /) as string,
      },
    });
  },
);

Then('the last sync of {string} shows the same reason', async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  const instance = await world.expectOk(world.admin.get(`/api/instances/${id}`), 'read instance');
  expect(instance.lastSyncStatus).toBe(`error: ${String(syncAnswers.get(world)!.body.message)}`);
});

Then(
  'agent {word} is told that the plugin failed with {string}',
  (world: SynoikiaWorld, _agent: string, text: string) => {
    expect(world.answer).toMatchObject({ error: 'PLUGIN_ERROR', message: text });
  },
);

Then('agent {word} is told that the plugin did not answer in time', (world: SynoikiaWorld) => {
  expect(world.answer).toMatchObject({ error: 'UPSTREAM_TIMEOUT', message: expect.stringMatching(/did not answer/) });
});

Then('agent {word} is told both times that the plugin is not available', (world: SynoikiaWorld) => {
  expect(world.answer.result).toEqual(['PLUGIN_UNAVAILABLE', 'PLUGIN_UNAVAILABLE']);
});

Then('no process of Acme Tasks runs, and the audit log shows no plugin error', async (world: SynoikiaWorld) => {
  await eventually(() => world.pluginProcesses() === 0, 'the plugin to exit');
  await new Promise((r) => setTimeout(r, 300));
  expect(world.pluginProcesses()).toBe(0);
  expect(await world.audit({ decision: 'plugin_error' })).toEqual([]);
});
