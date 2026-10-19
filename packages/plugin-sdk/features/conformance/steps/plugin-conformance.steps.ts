import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { checkConformance, ErrorCodes, PluginError } from '@synoikia/plugin-sdk';
import type { ConformanceSample, PluginHandlers, SyncCatalogResult } from '@synoikia/plugin-sdk';
import { acmeTasksPlugin } from '../../support/acme-tasks-plugin.js';
import type { PluginAuthorWorld } from '../../support/world.js';

type Break = (handlers: PluginHandlers) => PluginHandlers;

const breaks = (world: PluginAuthorWorld): Break[] => (world.kept.breaks ??= []) as Break[];

/** Changes one operation of the catalog the plugin syncs. */
const changeCatalog =
  (change: (result: SyncCatalogResult) => SyncCatalogResult): Break =>
  (h) => ({ ...h, syncCatalog: async () => change(await h.syncCatalog()) });

Given(
  'the conformance check resolves {string} and {string} of {string}, and expects {string} to be refused',
  (world: PluginAuthorWorld, read: string, remove: string, list: string, unknown: string) => {
    const path = (summary: string) => world.keyOf(summary).split(' ')[1]!.replace('{listId}', world.list(list).id!);
    const samples: ConformanceSample[] = [
      { fn: 'request', args: [{ path: path(read) }], expectKey: world.keyOf(read) },
      { fn: 'request', args: [{ method: 'delete', path: path(remove) }], expectKey: world.keyOf(remove) },
    ];
    world.kept.samples = samples;
    world.kept.rejects = [{ fn: 'request', args: [{ path: unknown }] }];
    world.setManifest('binding.functions', ['request']);
    world.setManifest('network.hosts', ['{{connection.baseUrl}}']);
  },
);

When('plugin author 3 runs the conformance check', async (world: PluginAuthorWorld) => {
  await world.startAcme();
  world.writePluginYaml();
  world.loadSettings();
  const handlers = breaks(world).reduce((h, change) => change(h), acmeTasksPlugin(world.dir));
  world.problems = await checkConformance({
    manifest: world.manifest,
    handlers,
    init: { instanceId: 'tasks', config: { baseUrl: world.baseUrl }, secrets: { token: world.token } },
    samples: world.kept.samples as ConformanceSample[],
    rejects: world.kept.rejects as { fn: string; args: unknown[] }[],
    ...(world.settings?.value ? { settings: world.settings.value } : {}),
  });
});

Then('the check reports only one problem, at {string}', (world: PluginAuthorWorld, place: string) => {
  expect(world.problems).toHaveLength(1);
  expect(world.problems[0]!.startsWith(place), world.problems[0]).toBe(true);
});

Then(/^the check reports at "(.+)" that "(.+)"$/, (world: PluginAuthorWorld, place: string, problem: string) => {
  expect(
    world.problems.some((p) => p.startsWith(place) && p.includes(problem)),
    world.problems.join('\n'),
  ).toBe(true);
});

Given('the plugin also implements the registry search', (world: PluginAuthorWorld) => {
  breaks(world).push((h) => ({ ...h, syncRegistry: () => [] }));
});

Given('the plugin lists {string} twice in its catalog', (world: PluginAuthorWorld, summary: string) => {
  const key = world.keyOf(summary);
  breaks(world).push(
    changeCatalog((r) => ({ ...r, operations: [...r.operations, r.operations.find((o) => o.key === key)!] })),
  );
});

Given(
  'plugin.yaml gives {string} the match profile {string}',
  (world: PluginAuthorWorld, summary: string, profile: string) => {
    world.addRule({ match: world.keyOf(summary), matchProfile: profile });
  },
);

Given('the plugin gives {string} as a locked read', (world: PluginAuthorWorld, summary: string) => {
  const key = world.keyOf(summary);
  breaks(world).push(
    changeCatalog((r) => ({
      ...r,
      operations: r.operations.map((o) => (o.key === key ? { ...o, locked: true, classification: 'read' } : o)),
    })),
  );
});

Given('the plugin gives no literal for {string}', (world: PluginAuthorWorld, summary: string) => {
  const key = world.keyOf(summary);
  breaks(world).push((h) => ({
    ...h,
    summarize: async (p) => {
      const { text, confirmLiteral } = await h.summarize(p);
      return p.key === key ? { text } : { text, ...(confirmLiteral ? { confirmLiteral } : {}) };
    },
  }));
});

Given('the plugin resolves every request to {string}', (world: PluginAuthorWorld, summary: string) => {
  const key = world.keyOf(summary);
  breaks(world).push((h) => ({
    ...h,
    resolveOperation: async (p) => ({ ...(await h.resolveOperation(p)), key }),
  }));
});

Given('the plugin accepts every request for an unknown path', (world: PluginAuthorWorld) => {
  breaks(world).push((h) => ({
    ...h,
    resolveOperation: async (p) => {
      try {
        return await h.resolveOperation(p);
      } catch (err) {
        if (err instanceof PluginError && err.code === ErrorCodes.UnknownOperation)
          return { key: world.keyOf('Show the lists'), params: {} };
        throw err;
      }
    },
  }));
});

Given('the connection test of the plugin answers {string} for its result', (world: PluginAuthorWorld, ok: string) => {
  breaks(world).push((h) => ({ ...h, testConnection: () => ({ ok }) as never }));
});
