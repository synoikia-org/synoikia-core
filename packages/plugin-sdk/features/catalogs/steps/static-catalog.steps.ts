import { Given, Then, When } from 'quickpickle';
import type { DataTable } from 'quickpickle';
import { expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { ErrorCodes, staticCatalog, staticHttpBinding } from '@synoikia/plugin-sdk';
import type { PluginAuthorWorld } from '../../support/world.js';

const METHODS: Record<string, string> = { read: 'GET', add: 'POST', change: 'PATCH', removal: 'DELETE' };

const binding = (world: PluginAuthorWorld) =>
  staticHttpBinding({ namespace: 'acme', service: 'Acme Tasks', rules: world.rules(), client: () => world.client() });

/** Resolves and runs one call, as core does with the agent's `acme.call(operation, params)`. */
const call = (world: PluginAuthorWorld, operation: string, params: unknown, deadlineMs = 5000) => {
  const b = binding(world);
  world.received.length = 0;
  return world.call(async () => {
    const resolved = await b.resolveOperation({ fn: 'call', args: [operation, params] });
    return b.invoke({ ...resolved, context: { callId: 'c-1', deadlineMs } });
  });
};

Given('plugin.yaml declares these operations of Acme Tasks:', (world: PluginAuthorWorld, table: DataTable) => {
  const operations = table.hashes().map((row: Record<string, string>) => {
    const [method, path] = row.request ? (row.request.split(' ') as [string, string]) : [];
    return {
      key: row.operation,
      kind: row.kind,
      group: row.operation!.split('.')[0],
      classification: row.class,
      summary: row.operation,
      ...(row.reason ? { reason: row.reason } : {}),
      ...(row.attestation === 'yes' ? { attestation: true } : {}),
      ...(method ? { http: { method: METHODS[method], path, ...(row.body ? { body: row.body } : {}) } } : {}),
    };
  });
  world.setYaml({ operations });
});

Given('plugin.yaml locks {string} and confirms it with the list id', (world: PluginAuthorWorld, key: string) => {
  world.addRule({ match: key, locked: true, confirm: { param: '/path/listId' } });
});

When('plugin author 3 builds the declared catalog', (world: PluginAuthorWorld) => {
  world.loadSettings();
  world.catalog = { operations: staticCatalog(world.rules()) };
});

Then('the declared catalog holds:', (world: PluginAuthorWorld, table: DataTable) => {
  expect(world.catalog!.operations).toEqual(
    table.hashes().map((row: Record<string, string>) =>
      expect.objectContaining({
        key: row.operation,
        kind: row.kind,
        classification: row.class,
        classificationReason: row.reason,
        locked: row.locked === 'yes',
        attestationRequired: row.attestation === 'yes',
        docs: { summary: row.operation },
      }),
    ),
  );
});

When(
  'core asks for the summary of {string} on the list {string}',
  async (world: PluginAuthorWorld, key: string, list: string) => {
    const summary = await binding(world).summarize({ key, params: { path: { listId: list } }, targets: [] });
    world.kept.summary = summary.text;
    world.literal = summary.confirmLiteral;
  },
);

Then(
  /^the summary reads "([^"]+)" with the (read|add|change|removal) of "([^"]+)", and the approver types "([^"]+)"$/,
  (world: PluginAuthorWorld, start: string, method: string, path: string, literal: string) => {
    expect(world.kept.summary).toBe(`${start} ${METHODS[method]} ${path}`);
    expect(world.literal).toBe(literal);
  },
);

When(/^the agent calls "([^"]+)" with (.+)$/, async (world: PluginAuthorWorld, operation: string, params: string) => {
  await call(world, operation, parseYaml(params));
});

Then(
  /^the call is refused as (an unknown operation|invalid parameters) with "(.+)"$/,
  (world: PluginAuthorWorld, kind: string, reason: string) => {
    const last = world.last;
    expect(last.ok, last.ok ? JSON.stringify(last.value) : '').toBe(false);
    const err = (last as { error: Error & { code?: string } }).error;
    expect(err.code).toBe(kind === 'an unknown operation' ? ErrorCodes.UnknownOperation : ErrorCodes.InvalidParams);
    expect(err.message).toContain(reason);
  },
);

Given('Acme Tasks answers after {int} milliseconds', (world: PluginAuthorWorld, ms: number) => {
  world.slowMs = ms;
});

When(
  'the agent calls {string} on {string} with {int} milliseconds left',
  async (world: PluginAuthorWorld, operation: string, list: string, left: number) => {
    await call(world, operation, { path: { listId: world.list(list).id } }, left);
  },
);

When(
  /^the agent calls "([^"]+)" on "([^"]+)" with the fields (.+)$/,
  async (world: PluginAuthorWorld, operation: string, list: string, fields: string) => {
    await call(world, operation, { path: { listId: world.list(list).id }, body: parseYaml(fields) as unknown });
  },
);

Given(
  'plugin.yaml also declares {string} with the body encoding {string}',
  (world: PluginAuthorWorld, key: string, encoding: string) => {
    const operations = world.yamlDoc.operations as unknown[];
    operations.push({
      key,
      group: 'lists',
      classification: 'read',
      summary: key,
      http: { method: 'POST', path: '/lists/{listId}/export', body: encoding },
    });
    world.setYaml({ operations });
  },
);
