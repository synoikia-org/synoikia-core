import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { isSdkCompatible, OperationDescriptorSchema, SDK_VERSION } from '@synoikia/plugin-sdk';
import { explain } from '../../support/world.js';
import type { PluginAuthorWorld } from '../../support/world.js';

const list = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

Given(
  'plugin author 3 has a plugin folder for {string} with a minimal manifest',
  (world: PluginAuthorWorld, name: string) => {
    expect(world.manifest.name).toBe(name);
  },
);

When('plugin author 3 validates the manifest', (world: PluginAuthorWorld) => {
  world.validate();
});

Then('the manifest is accepted', (world: PluginAuthorWorld) => {
  expect(world.validated?.error).toBeUndefined();
});

Then('the manifest is accepted with no capabilities and no extra search tools', (world: PluginAuthorWorld) => {
  const m = world.validated?.manifest;
  expect(m, world.validated?.error).toBeDefined();
  expect(m!.capabilities).toEqual({ registry: false, targets: false, attestation: false, configTransform: false });
  expect(m!.binding.searchApis).toEqual([]);
});

Then(
  'it has the labels {string} and {string}, no hosts and no match profiles',
  (world: PluginAuthorWorld, one: string, many: string) => {
    const m = world.validated!.manifest!;
    expect(m.labels).toEqual({ operation: one, operations: many });
    expect(m.network.hosts).toEqual([]);
    expect(m.matchProfiles).toEqual({});
  },
);

Then('the manifest is refused at {string}', (world: PluginAuthorWorld, field: string) => {
  expect(world.validated?.manifest).toBeUndefined();
  const paths = world.validated!.error!.split('\n').map((l) => l.split(': ')[0]!);
  expect(
    paths.some((p) => p === field || p.startsWith(`${field}.`)),
    world.validated!.error,
  ).toBe(true);
});

Then('the manifest is refused with {string}', (world: PluginAuthorWorld, reason: string) => {
  expect(world.validated?.manifest).toBeUndefined();
  expect(world.validated!.error).toContain(reason);
});

Given('the manifest sets {string} to {string}', (world: PluginAuthorWorld, field: string, value: string) => {
  world.setManifest(field, value);
});

Given(
  'the binding uses the namespace {string} and the function {string}',
  (world: PluginAuthorWorld, namespace: string, fn: string) => {
    world.setManifest('binding', { namespace, functions: [fn] });
  },
);

Given('the manifest names the instructions file {string}', (world: PluginAuthorWorld, file: string) => {
  world.setManifest('instructions', file);
});

Then('the manifest is accepted with the instructions file {string}', (world: PluginAuthorWorld, file: string) => {
  expect(world.validated?.manifest?.instructions, world.validated?.error).toBe(file);
});

const instructionsFile = (world: PluginAuthorWorld, data: Uint8Array | string) => {
  world.setManifest('instructions', 'instructions.md');
  world.writeFile('instructions.md', data);
};

Given(
  'the instructions file holds a byte-order mark and {int} copies of {string}',
  (world: PluginAuthorWorld, n: number, text: string) => {
    instructionsFile(world, `\uFEFF${text.repeat(n)}`);
  },
);

Given('the instructions file holds {int} copies of {string}', (world: PluginAuthorWorld, n: number, text: string) => {
  instructionsFile(world, text.repeat(n));
});

Given('the instructions file holds {string}', (world: PluginAuthorWorld, text: string) => {
  instructionsFile(world, text);
});

Given(/^the instructions file holds the bytes ([0-9a-f ]+)$/, (world: PluginAuthorWorld, hex: string) => {
  instructionsFile(world, Buffer.from(hex.replace(/ /g, ''), 'hex'));
});

When('plugin author 3 reads the instructions', (world: PluginAuthorWorld) => {
  world.readInstructions();
});

Then('the instructions read as {int} copies of {string}', (world: PluginAuthorWorld, n: number, text: string) => {
  expect(world.instructions?.error).toBeUndefined();
  expect(world.instructions!.text).toBe(text.repeat(n));
});

Then(
  'the instructions read as {string}, a tab, {string}, a carriage return, a line feed and {string}',
  (world: PluginAuthorWorld, a: string, b: string, c: string) => {
    expect(world.instructions?.error).toBeUndefined();
    expect(world.instructions!.text).toBe(`${a}\t${b}\r\n${c}`);
  },
);

Then('the instructions are refused with {string}', (world: PluginAuthorWorld, reason: string) => {
  expect(world.instructions?.text).toBeUndefined();
  expect(world.instructions!.error).toContain(reason);
});

Given(
  'the match profile {string} has the field {string} with the widget {string} and the operator {string}',
  (world: PluginAuthorWorld, profile: string, field: string, widget: string, op: string) => {
    world.matchProfile(profile).push({ field, label: 'Name', widget, ...(op ? { op } : {}) });
  },
);

Given(
  'the connection field {string} picks from the choice source {string}',
  (world: PluginAuthorWorld, field: string, source: string) => {
    world.connection.schema.properties[field] = { type: 'string' };
    Object.assign(world.connectionHint(field), { widget: 'select', optionsSource: source });
  },
);

Given(
  'the match profile {string} has a picker for {string} that picks from {string}',
  (world: PluginAuthorWorld, profile: string, field: string, source: string) => {
    world.matchProfile(profile).push({ field, label: 'List', op: 'in', widget: 'multiselect', optionsSource: source });
  },
);

const targetField = (world: PluginAuthorWorld, profile: string, extra: Record<string, unknown> = {}) =>
  world.matchProfile(profile).push({ field: '$targets', label: 'Lists', widget: 'registry-picker', ...extra });

const declareScopes = (world: PluginAuthorWorld, scopes: string) =>
  world.setManifest('targets', { scopes: list(scopes).map((key) => ({ key, label: key })) });

Given('the match profile {string} has a target field', (world: PluginAuthorWorld, profile: string) => {
  targetField(world, profile);
});

Given(
  /^the manifest turns targets (on|off) and declares (?:no target scopes|the target scope "([^"]*)")$/,
  (world: PluginAuthorWorld, state: string, scope?: string) => {
    world.setManifest('capabilities.targets', state === 'on');
    if (scope) declareScopes(world, scope);
  },
);

Given(
  'the manifest turns targets on and declares the target scopes {string}',
  (world: PluginAuthorWorld, scopes: string) => {
    world.setManifest('capabilities.targets', true);
    declareScopes(world, scopes);
  },
);

Given(
  'the match profile {string} has a target field that offers the scope {string}',
  (world: PluginAuthorWorld, profile: string, scope: string) => {
    targetField(world, profile, { options: { scopes: [scope] } });
  },
);

Given(
  'the match profile {string} has a target field that covers {string} and {string}',
  (world: PluginAuthorWorld, profile: string, a: string, b: string) => {
    targetField(world, profile, { covers: [a, b] });
  },
);

Given(
  'the match profile {string} has the field {string} that covers {string}',
  (world: PluginAuthorWorld, profile: string, field: string, covers: string) => {
    world.matchProfile(profile).push({ field, label: 'Name', op: 'prefix', widget: 'prefix', covers: [covers] });
  },
);

Given(
  /^the binding offers the search tool "([^"]+)" with the capability "([^"]+)" (on|off)$/,
  (world: PluginAuthorWorld, tool: string, capability: string, state: string) => {
    world.setManifest('binding.searchApis', [tool]);
    world.setManifest(`capabilities.${capability}`, state === 'on');
  },
);

Given('the connection form has the fields {string} and {string}', (world: PluginAuthorWorld, a: string, b: string) => {
  world.connection.schema.properties[a] = { type: 'string' };
  world.connection.schema.properties[b] = { type: 'string', writeOnly: true };
});

Given('the password shows only when {string} is {string}', (world: PluginAuthorWorld, field: string, value: string) => {
  Object.assign(world.connectionHint('password'), {
    widget: 'secret',
    showWhen: { field, in: value ? [value] : [] },
  });
});

Then(
  'the manifest is accepted with the password shown only when {string} is {string}',
  (world: PluginAuthorWorld, field: string, value: string) => {
    const m = world.validated?.manifest;
    expect(m, world.validated?.error).toBeDefined();
    expect(m!.connection.ui.password?.showWhen).toEqual({ field, in: [value] });
  },
);

Given('the connection form has a hint for the field {string}', (world: PluginAuthorWorld, field: string) => {
  world.connectionHint(field).widget = 'secret';
});

const describeOperation = (world: PluginAuthorWorld, key: string, group?: string) => {
  world.descriptor = {
    key,
    kind: 'method',
    classification: 'read',
    classificationReason: 'plugin:read',
    ...(group === undefined ? {} : { group }),
  };
};

Given('the plugin describes the operation {string} with no group', (world: PluginAuthorWorld, key: string) => {
  describeOperation(world, key);
});

Given(
  'the plugin describes the operation {string} with the group {string}',
  (world: PluginAuthorWorld, key: string, group: string) => {
    describeOperation(world, key, group);
  },
);

Given(
  'the plugin describes the operation {string} with a group of {int} letters',
  (world: PluginAuthorWorld, key: string, n: number) => {
    describeOperation(world, key, 'x'.repeat(n));
  },
);

Given(
  'the operation keeps the parameters {string} and {string} secret',
  (world: PluginAuthorWorld, a: string, b: string) => {
    world.descriptor!.sensitiveParams = [a, b];
  },
);

Given('the operation keeps the parameter {string} secret', (world: PluginAuthorWorld, p: string) => {
  world.descriptor!.sensitiveParams = [p];
});

Given('the operation keeps {int} parameters secret', (world: PluginAuthorWorld, n: number) => {
  world.descriptor!.sensitiveParams = Array.from({ length: n }, (_, i) => `/${i}`);
});

When('plugin author 3 validates the operation description', (world: PluginAuthorWorld) => {
  const parsed = OperationDescriptorSchema.safeParse(world.descriptor);
  world.descriptorResult = parsed.success ? { value: parsed.data } : { error: explain(parsed.error) };
});

Then('the operation description is refused at {string}', (world: PluginAuthorWorld, field: string) => {
  expect(world.descriptorResult?.value).toBeUndefined();
  const paths = world.descriptorResult!.error!.split('\n').map((l) => l.split(': ')[0]!.split('.')[0]);
  expect(paths, world.descriptorResult!.error).toContain(field);
});

Then('the operation description is accepted in the group {string}', (world: PluginAuthorWorld, group: string) => {
  expect(world.descriptorResult?.error).toBeUndefined();
  expect(world.descriptorResult!.value).toMatchObject({ group, sensitiveParams: ['/1', '/0/password'] });
});

Given('the manifest asks for the SDK range {string}', (world: PluginAuthorWorld, range: string) => {
  world.setManifest('sdk', range);
});

When('plugin author 3 compares the plugin with the contract of this SDK', (world: PluginAuthorWorld) => {
  world.validate();
  world.compatible = isSdkCompatible(world.validated!.manifest!);
});

Then(
  /^the plugin (works|does not work) with the contract "([^"]+)"$/,
  (world: PluginAuthorWorld, verdict: string, version: string) => {
    expect(SDK_VERSION).toBe(version);
    expect(world.compatible).toBe(verdict === 'works');
  },
);
