import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { PluginAuthorWorld } from '../../support/world.js';

const tokenField = (world: PluginAuthorWorld, writeOnly: boolean, widget: string | undefined, listed: boolean) => {
  world.connection.schema.properties.token = { type: 'string', ...(writeOnly ? { writeOnly: true } : {}) };
  if (widget) world.connectionHint('token').widget = widget;
  world.setManifest('sensitiveKeys', listed ? ['token'] : []);
};

Given('the plugin connects only to the host of its base address', (world: PluginAuthorWorld) => {
  world.setManifest('network.hosts', ['{{connection.baseUrl}}']);
});

Given(
  'the connection field {string} uses the secret widget, but is not write-only and not listed as sensitive',
  (world: PluginAuthorWorld, field: string) => {
    expect(field).toBe('token');
    tokenField(world, false, 'secret', false);
  },
);

Given(
  'the connection field {string} is write-only and listed as sensitive, with no widget',
  (world: PluginAuthorWorld, field: string) => {
    expect(field).toBe('token');
    tokenField(world, true, undefined, true);
  },
);

Given(
  'the connection field {string} uses the secret widget, is write-only and is listed as sensitive',
  (world: PluginAuthorWorld, field: string) => {
    expect(field).toBe('token');
    tokenField(world, true, 'secret', true);
  },
);

When('plugin author 3 checks the manifest', (world: PluginAuthorWorld) => {
  world.check();
});

Then('the check reports {string}', (world: PluginAuthorWorld, problem: string) => {
  expect(world.problems).toContain(problem);
});

Then('the check reports only {string}', (world: PluginAuthorWorld, problem: string) => {
  expect(world.problems).toEqual([problem]);
});

Then('the check reports no problems', (world: PluginAuthorWorld) => {
  expect(world.problems).toEqual([]);
});

Then('the check reports only that {string} must {string}', (world: PluginAuthorWorld, where: string, fix: string) => {
  expect(world.problems).toHaveLength(1);
  expect(world.problems[0]!.startsWith(`${where}: sensitiveResult`), world.problems[0]).toBe(true);
  expect(world.problems[0]).toContain(fix);
});

Given('the manifest has the match profile {string}', (world: PluginAuthorWorld, profile: string) => {
  world.matchProfile(profile).push({ field: '/name', label: 'Name', op: 'prefix', widget: 'prefix' });
});

Given(
  'plugin.yaml gives {string} the match profile {string} and {string} the match profile {string}',
  (world: PluginAuthorWorld, a: string, pa: string, b: string, pb: string) => {
    world.addRule({ match: a, matchProfile: pa });
    world.addRule({ match: b, matchProfile: pb });
  },
);

Given('plugin.yaml marks the whole result of {string} as secret', (world: PluginAuthorWorld, key: string) => {
  world.addRule({ match: key, sensitiveResult: 'whole' });
});

Given('plugin.yaml has no rules', (world: PluginAuthorWorld) => {
  world.setYaml({ rules: [] });
});
