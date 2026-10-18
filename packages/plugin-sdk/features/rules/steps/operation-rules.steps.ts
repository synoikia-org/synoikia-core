import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { OperationDraft, ResolvedTarget } from '@synoikia/plugin-sdk';
import type { PluginAuthorWorld } from '../../support/world.js';

const find = (world: PluginAuthorWorld, key: string, group: string, extra: Partial<OperationDraft> = {}) => {
  world.drafts.push({ key, kind: 'method', group, ...extra });
};

const byName = (args: unknown[]) => ({ op: 'lists.get', args, field: 'name' });

Given('plugin.yaml is empty', (world: PluginAuthorWorld) => {
  world.pluginYaml = '';
});

Given('plugin.yaml holds {string}', (world: PluginAuthorWorld, text: string) => {
  world.pluginYaml = `${text}\n`;
});

Given('the plugin takes a page size from 1 to 100 in its own section', (world: PluginAuthorWorld) => {
  world.pluginSection = z.object({ pageSize: z.number().int().min(1).max(100) }).strict();
});

When('plugin author 3 loads plugin.yaml', (world: PluginAuthorWorld) => {
  world.loadSettings();
});

Then(
  'a request has {int} seconds and a lookup has {int} seconds',
  (world: PluginAuthorWorld, request: number, lookup: number) => {
    expect(world.settings?.error).toBeUndefined();
    expect(world.settings!.value!.defaults.timeouts).toEqual({ request: request * 1000, lookup: lookup * 1000 });
  },
);

Then('plugin.yaml is refused', (world: PluginAuthorWorld) => {
  expect(world.settings?.value).toBeUndefined();
  expect(world.settings?.error).toBeTruthy();
});

Then('plugin.yaml is refused at {string}', (world: PluginAuthorWorld, field: string) => {
  expect(world.settings?.value).toBeUndefined();
  expect(world.settings!.error!.split('\n').map((l) => l.split(': ')[0])).toContain(field);
});

Given(
  'the plugin finds the reads {string}, {string}, {string} and {string}',
  (world: PluginAuthorWorld, ...rest: unknown[]) => {
    for (const key of rest.slice(0, 4) as string[]) find(world, key, key.split('.')[0]!, { classification: 'read' });
  },
);

Given(
  'plugin.yaml excludes {string} and {string} and includes {string}',
  (world: PluginAuthorWorld, a: string, b: string, c: string) => {
    world.setYaml({ exclude: [a, b], include: [c] });
  },
);

When('plugin author 3 builds the catalog', (world: PluginAuthorWorld) => {
  world.buildCatalog();
});

Then('the catalog holds only {string} and {string}', (world: PluginAuthorWorld, a: string, b: string) => {
  expect(world.catalog?.error).toBeUndefined();
  expect(world.catalog!.operations!.map((o) => o.key)).toEqual([a, b]);
});

Then('the catalog is refused with {string} and {string}', (world: PluginAuthorWorld, a: string, b: string) => {
  expect(world.catalog?.operations).toBeUndefined();
  expect(world.catalog!.error).toContain(a);
  expect(world.catalog!.error).toContain(b);
});

Given(
  /^the plugin finds "([^"]+)" in the group "([^"]+)" and takes it for a (read|write)$/,
  (world: PluginAuthorWorld, key: string, group: string, classification: 'read' | 'write') => {
    find(world, key, group, { classification });
  },
);

Given(
  'the plugin finds {string} in the group {string} and cannot classify it',
  (world: PluginAuthorWorld, key: string, group: string) => {
    find(world, key, group);
  },
);

Given(
  'the plugin finds {string} in the group {string}, takes it for a write and asks for a review',
  (world: PluginAuthorWorld, key: string, group: string) => {
    find(world, key, group, { classification: 'write', classificationReason: 'plugin:write', needsReview: true });
  },
);

Given(
  'the plugin finds {string} in the group {string} with the summary {string}',
  (world: PluginAuthorWorld, key: string, group: string, summary: string) => {
    find(world, key, group, { classification: 'write', docs: { summary } });
  },
);

Given(
  'the plugin finds {string} in the group {string} with the secret parameter {string}',
  (world: PluginAuthorWorld, key: string, group: string, pointer: string) => {
    find(world, key, group, { classification: 'write', sensitiveParams: [pointer] });
  },
);

Given('plugin.yaml locks {string} and also classifies it as a read', (world: PluginAuthorWorld, key: string) => {
  world.addRule({ match: key, locked: true, classification: 'read' });
});

Given(
  'plugin.yaml classifies {string} as a read with the reason {string} and no review',
  (world: PluginAuthorWorld, key: string, reason: string) => {
    world.addRule({ match: key, classification: 'read', reason, needsReview: false });
  },
);

Then(
  '{string} is a locked write with a typed confirmation and the reason {string}',
  (world: PluginAuthorWorld, key: string, reason: string) => {
    expect(world.operation(key)).toMatchObject({
      classification: 'write',
      classificationReason: reason,
      locked: true,
      typedConfirmation: true,
    });
  },
);

Then(
  /^"([^"]+)" is a (read|write) with the reason "([^"]+)"$/,
  (world: PluginAuthorWorld, key: string, classification: string, reason: string) => {
    expect(world.operation(key)).toMatchObject({
      classification,
      classificationReason: reason,
      locked: false,
      typedConfirmation: false,
    });
  },
);

Then(
  '{string} is a read with the reason {string} that needs no review',
  (world: PluginAuthorWorld, key: string, reason: string) => {
    expect(world.operation(key)).toMatchObject({
      classification: 'read',
      classificationReason: reason,
      needsReview: false,
    });
  },
);

Given(
  'plugin.yaml splits {string} for {string} with a secret {string} and the guidance {string}',
  (world: PluginAuthorWorld, key: string, suffix: string, pointer: string, guidance: string) => {
    world.addRule({ match: key, split: suffix, sensitiveParams: [pointer], guidance });
  },
);

Given(
  'plugin.yaml describes every {string} twin as {string} with the note {string}',
  (world: PluginAuthorWorld, suffix: string, description: string, note: string) => {
    world.addRule({ match: `*${suffix}`, description, summaryNote: note });
  },
);

Then(
  '{string} is locked with the secret {string}, the guidance, the description {string} and the note {string}',
  (world: PluginAuthorWorld, key: string, pointer: string, description: string, note: string) => {
    const base = world.operation(key.split('#')[0]!);
    const twin = world.operation(key);
    expect(base).toMatchObject({ locked: false, sensitiveParams: [pointer] });
    expect(base.docs).not.toHaveProperty('description');
    expect(twin).toMatchObject({
      locked: true,
      classification: 'write',
      sensitiveParams: [pointer],
      docs: { summary: base.docs?.summary, description, guidance: base.docs?.guidance },
    });
    expect(world.rules().summaryNotes(key)).toEqual([note]);
  },
);

Given(
  'plugin.yaml gives {string} the match profile {string}, attestation and the secret parameter {string}',
  (world: PluginAuthorWorld, key: string, matchProfile: string, pointer: string) => {
    world.addRule({ match: key, matchProfile, attestation: true, sensitiveParams: [pointer] });
  },
);

Then(
  '{string} has the match profile {string}, requires attestation and keeps {string} and {string} secret',
  (world: PluginAuthorWorld, key: string, matchProfile: string, a: string, b: string) => {
    expect(world.operation(key)).toMatchObject({ matchProfile, attestationRequired: true, sensitiveParams: [a, b] });
  },
);

Given(
  'two rules of plugin.yaml give {string} {int} secret parameters each',
  (world: PluginAuthorWorld, key: string, n: number) => {
    for (const part of ['a', 'b'])
      world.addRule({ match: key, sensitiveParams: Array.from({ length: n }, (_, i) => `/${part}/${i}`) });
  },
);

Given(
  'plugin.yaml confirms {string} with the list name that Acme Tasks gives for the parameter {string}',
  (world: PluginAuthorWorld, key: string, pointer: string) => {
    world.addRule({ match: key, confirm: { lookup: byName([{ $param: pointer }]) } });
  },
);

Given(
  'plugin.yaml locks {string} and confirms it with the list name that Acme Tasks gives for the parameter {string}',
  (world: PluginAuthorWorld, key: string, pointer: string) => {
    world.addRule({ match: key, locked: true, confirm: { lookup: byName([{ $param: pointer }]) } });
  },
);

Given(
  'plugin.yaml locks {string} and confirms it with the name of the list whose id is the parameter {string}',
  (world: PluginAuthorWorld, key: string, pointer: string) => {
    world.addRule({
      match: key,
      locked: true,
      confirm: { lookup: { op: 'lists.all', field: 'name', find: { field: 'id', equals: { $param: pointer } } } },
    });
  },
);

Given(
  'Acme Tasks has the lists {string} as {string} and a list with no name as {string}',
  (world: PluginAuthorWorld, name: string, id: string, unnamed: string) => {
    world.lists.push({ id, name, tasks: [] }, { id: unnamed, tasks: [] });
  },
);

Given(
  'Acme Tasks has the lists {string} as {string}, {string} as {string} and {string} with no id',
  (world: PluginAuthorWorld, a: string, aid: string, b: string, bid: string, c: string) => {
    world.lists.push({ name: c, tasks: [] }, { id: aid, name: a, tasks: [] }, { id: bid, name: b, tasks: [] });
  },
);

When(
  'core asks for the literal of {string} on the list {string}',
  async (world: PluginAuthorWorld, key: string, list: string) => {
    await world.confirmLiteral(key, { list });
  },
);

When(
  /^core asks for the literal of "([^"]+)" on the list "([^"]+)" with (?:no targets|the targets "([^"]+)" and an unnamed "([^"]+)")$/,
  async (world: PluginAuthorWorld, key: string, list: string, named?: string, unnamed?: string) => {
    const targets: ResolvedTarget[] = named
      ? [
          { kind: 'list', id: 'l-1', name: named },
          { kind: 'list', id: unnamed!, name: '' },
        ]
      : [];
    await world.confirmLiteral(key, { list }, targets);
  },
);

When(
  'core asks for the literal of {string} on a list given as an object',
  async (world: PluginAuthorWorld, key: string) => {
    await world.confirmLiteral(key, { list: { id: 'l-1' } });
  },
);

Then('the approver types {string}', (world: PluginAuthorWorld, literal: string) => {
  expect(world.literal).toBe(literal);
});

Then('the approver types nothing', (world: PluginAuthorWorld) => {
  expect(world.literal).toBeUndefined();
});

Then('Acme Tasks gets no request', (world: PluginAuthorWorld) => {
  expect(world.received).toEqual([]);
});

Given('Acme Tasks names its account {string}', (world: PluginAuthorWorld, name: string) => {
  world.account = name ? { name } : {};
});

Given(
  'plugin.yaml confirms locked operations with the account name, or {string} when it has none',
  (world: PluginAuthorWorld, fallback: string) => {
    world.setYaml({
      defaults: { confirm: 'instance' },
      instanceName: { op: 'account.info', field: 'name', fallback },
    });
  },
);

Given('plugin.yaml locks {string}', (world: PluginAuthorWorld, key: string) => {
  world.addRule({ match: key, locked: true });
});

Given(
  'plugin.yaml locks {string} and confirms it with the target names, then the parameter {string}',
  (world: PluginAuthorWorld, key: string, pointer: string) => {
    world.addRule({ match: key, locked: true, confirm: ['targets', { param: pointer }] });
  },
);

Given(
  'the plugin gives the owner {string} as its custom source {string}',
  (world: PluginAuthorWorld, owner: string, name: string) => {
    world.custom[name] = () => owner;
  },
);

Given(
  'plugin.yaml locks {string} and confirms it with the custom source {string}',
  (world: PluginAuthorWorld, key: string, name: string) => {
    world.addRule({ match: key, locked: true, confirm: { custom: name } });
  },
);

Given(
  'plugin.yaml marks the result of {string} as secret by {string}',
  (world: PluginAuthorWorld, key: string, rule: string) => {
    if (rule !== 'none') world.addRule({ match: key, sensitiveResult: parseYaml(rule) as unknown });
    else world.setYaml({ rules: [] });
  },
);

When(
  /^the plugin masks the result (.+) of "([^"]+)" inside another result$/,
  (world: PluginAuthorWorld, result: string, key: string) => {
    world.loadSettings();
    world.masked = world.rules().maskEmbeddedResult(key, parseYaml(result));
  },
);

Then(/^the embedded result reads (.+)$/, (world: PluginAuthorWorld, masked: string) => {
  expect(world.masked).toEqual(parseYaml(masked));
});

Given(
  'plugin.yaml splits {string} for {string} and marks its whole result as secret',
  (world: PluginAuthorWorld, key: string, suffix: string) => {
    world.addRule({ match: key, split: suffix, sensitiveResult: 'whole' });
  },
);

Then(
  '{string} and {string} both declare their whole result as secret',
  (world: PluginAuthorWorld, a: string, b: string) => {
    expect(world.operation(a).sensitiveResult).toBe('whole');
    expect(world.operation(b).sensitiveResult).toBe('whole');
  },
);
