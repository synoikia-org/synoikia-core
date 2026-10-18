import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { ErrorCodes, fetchSpec, fillTemplate, matchPath, restLookup } from '@synoikia/plugin-sdk';
import { aliasBomb } from '../../support/acme-description.js';
import { explain } from '../../support/world.js';
import type { PluginAuthorWorld } from '../../support/world.js';

const METHODS: Record<string, string> = { read: 'GET', add: 'POST', change: 'PATCH', removal: 'DELETE' };

const yamlValue = (text: string): unknown => parseYaml(text) as unknown;

const refusal = (world: PluginAuthorWorld) => {
  const last = world.last;
  expect(last.ok, last.ok ? JSON.stringify(last.value) : '').toBe(false);
  return (last as { error: Error & { code?: string } }).error;
};

/** The request the agent sends for an operation of the description, on a list. */
const requestFor = (world: PluginAuthorWorld, summary: string, list: string, body: unknown) => {
  const [method, template] = world.keyOf(summary).split(' ') as [string, string];
  return { method: method.toLowerCase(), path: fillTemplate(template, { listId: world.list(list).id }), body };
};

Given('Acme Tasks describes its API in an OpenAPI 3.0 description', (world: PluginAuthorWorld) => {
  expect(world.description.openapi).toBe('3.0.3');
});

const GIVES: Record<string, (world: PluginAuthorWorld) => void> = {
  'an OpenAPI 2 description': (w) => {
    w.descriptionText = 'swagger: "2.0"\nopenapi: "2.0"\npaths: {}\n';
  },
  'a description that is not YAML': (w) => {
    w.descriptionText = '{{{ not yaml';
  },
  'an empty description': (w) => {
    w.descriptionText = '';
  },
  'an OpenAPI 3.0 description with no paths': (w) => {
    w.descriptionText = 'openapi: 3.0.3\n';
  },
};

Given(
  /^Acme Tasks gives (an OpenAPI 2 description|a description that is not YAML|an empty description|an OpenAPI 3\.0 description with no paths)$/,
  (world: PluginAuthorWorld, description: string) => {
    GIVES[description]!(world);
  },
);

Given('Acme Tasks gives its description as OpenAPI 3.1', (world: PluginAuthorWorld) => {
  world.description.openapi = '3.1.0';
});

Given(
  'Acme Tasks gives a description with {int} levels of YAML aliases, each {int} times the level before',
  (world: PluginAuthorWorld, levels: number, times: number) => {
    expect(times).toBe(9);
    world.descriptionText = aliasBomb(levels);
  },
);

When('plugin author 3 builds the catalog from the description', (world: PluginAuthorWorld) => {
  world.buildFromDescription();
});

Given('plugin author 3 built the catalog from the description', (world: PluginAuthorWorld) => {
  world.buildFromDescription();
  expect(world.catalog?.error).toBeUndefined();
});

Then('the catalog is refused with {string}', (world: PluginAuthorWorld, reason: string) => {
  expect(world.catalog?.operations).toBeUndefined();
  expect(world.catalog?.error).toContain(reason);
});

Then('the catalog is refused with the upstream error {string}', (world: PluginAuthorWorld, reason: string) => {
  expect(world.catalog?.operations).toBeUndefined();
  expect(world.catalog).toMatchObject({ code: ErrorCodes.UpstreamError, error: reason });
});

Then('the catalog holds {string} and {string}', (world: PluginAuthorWorld, a: string, b: string) => {
  expect(world.catalog?.error).toBeUndefined();
  for (const summary of [a, b]) world.operation(world.keyOf(summary));
});

Then(
  /^the operation "([^"]+)" at "([^"]+)" is a (read|write) that needs (no|a) review$/,
  (world: PluginAuthorWorld, summary: string, path: string, classification: string, review: string) => {
    const key = world.keyOf(summary);
    expect(key.split(' ')[1]).toBe(path);
    expect(world.operation(key)).toMatchObject({ classification, needsReview: review === 'a' });
  },
);

Given('the plugin turns off the guess from the names and the paths of reads', (world: PluginAuthorWorld) => {
  world.openApiOptions = { actionWords: null, pathActionWords: null };
});

Given('plugin.yaml excludes every path under {string}', (world: PluginAuthorWorld, prefix: string) => {
  world.setYaml({ exclude: [`* ${prefix}/*`] });
});

Then(
  'the catalog holds {int} operations, and none at {string}, {string} or {string}',
  (world: PluginAuthorWorld, count: number, ...rest: unknown[]) => {
    expect(world.catalog?.error).toBeUndefined();
    const paths = world.catalog!.operations!.map((o) => o.key.split(' ')[1]);
    expect(paths).toHaveLength(count);
    for (const p of rest.slice(0, 3)) expect(paths).not.toContain(p);
  },
);

Then(
  '{string} is in the group {string} with the description {string}',
  (world: PluginAuthorWorld, summary: string, group: string, description: string) => {
    expect(world.operation(world.keyOf(summary))).toMatchObject({
      kind: 'rest',
      group,
      docs: { summary, description },
    });
  },
);

Then(
  '{string} takes the required {string} in its path and {string} in its query',
  (world: PluginAuthorWorld, summary: string, pathParam: string, queryParam: string) => {
    expect(world.operation(world.keyOf(summary)).paramsSchema).toMatchObject({
      properties: {
        path: { properties: { [pathParam]: { type: 'string' } }, required: [pathParam] },
        query: { properties: { [queryParam]: { type: 'integer' } } },
      },
    });
  },
);

Given(
  'plugin.yaml locks {string} and splits it for {string}',
  (world: PluginAuthorWorld, summary: string, suffix: string) => {
    world.addRule({ match: world.keyOf(summary), locked: true, split: suffix });
  },
);

Then(
  '{string} and its twin for {string} are locked writes with a typed confirmation',
  (world: PluginAuthorWorld, summary: string, suffix: string) => {
    const key = world.keyOf(summary);
    for (const k of [key, `${key}#${suffix}`])
      expect(world.operation(k)).toMatchObject({ classification: 'write', locked: true, typedConfirmation: true });
  },
);

Given(
  'Acme Tasks also describes {string} at {string}',
  (world: PluginAuthorWorld, summary: string, template: string) => {
    const paths = world.description.paths as Record<string, unknown>;
    const [verb] = world.keyOf(summary).split(' ') as [string];
    paths[template] = { [verb.toLowerCase()]: { summary: `${summary} again` } };
  },
);

Given(
  'the schema of a task in Acme Tasks fans out {int} ways on {int} levels',
  (world: PluginAuthorWorld, ways: number, levels: number) => {
    const schemas = (world.description.components as { schemas: Record<string, unknown> }).schemas;
    const fan = (to: string) =>
      Object.fromEntries(Array.from({ length: ways }, (_, i) => [`p${i}`, { $ref: `#/components/schemas/${to}` }]));
    schemas.Task = { type: 'object', properties: fan('L1') };
    for (let n = 1; n <= levels; n++) schemas[`L${n}`] = { type: 'object', properties: fan(`L${n + 1}`) };
  },
);

Given('the plugin expects at least {int} operations from Acme Tasks', (world: PluginAuthorWorld, min: number) => {
  world.openApiOptions = { minOperations: min };
});

Then('the parent of a list in {string} reads {string}', (world: PluginAuthorWorld, summary: string, text: string) => {
  expect(world.operation(world.keyOf(summary)).paramsSchema).toMatchObject({
    properties: { body: { properties: { parent: { description: text } } } },
  });
});

type Matched = ReturnType<typeof matchPath>;

When(
  /^the plugin matches an? (read|change) of the path "([^"]+)"$/,
  (world: PluginAuthorWorld, method: string, path: string) => {
    world.kept.matched = matchPath(world.openapi!, METHODS[method]!, path);
  },
);

Then(
  'the path finds {string} with {string} as its {string}',
  (world: PluginAuthorWorld, summary: string, value: string, param: string) => {
    const matched = world.kept.matched as Matched;
    expect(matched?.op.key).toBe(world.keyOf(summary));
    expect(Object.hasOwn(matched!.pathParams, param)).toBe(true);
    expect(matched!.pathParams[param]).toBe(value);
    expect(Object.getPrototypeOf(matched!.pathParams)).toBe(Object.prototype);
  },
);

Then('the path finds no operation', (world: PluginAuthorWorld) => {
  expect(world.kept.matched).toBeUndefined();
});

When(
  /^the plugin fills the path of "([^"]+)" with the list (.+)$/,
  async (world: PluginAuthorWorld, summary: string, value: string) => {
    const template = world.keyOf(summary).split(' ')[1]!;
    const listId = value === 'no value' ? undefined : yamlValue(value);
    await world.call(async () => fillTemplate(template, listId === undefined ? {} : { listId }));
  },
);

Then('the plugin gets the path {string}', (world: PluginAuthorWorld, path: string) => {
  expect(world.last).toEqual({ ok: true, value: path });
});

Then('the path is refused with {string}', (world: PluginAuthorWorld, reason: string) => {
  expect(refusal(world).message).toContain(reason);
});

When(/^the agent sends Acme Tasks the request (.+)$/, async (world: PluginAuthorWorld, request: string) => {
  const binding = world.binding();
  await world.call(() => binding.resolveOperation({ fn: 'request', args: [yamlValue(request)] }));
});

When('core runs the operation {string} of Acme Tasks', async (world: PluginAuthorWorld, key: string) => {
  const binding = world.binding();
  await world.call(() => binding.invoke({ key, params: {}, context: { callId: 'c-1', deadlineMs: 5000 } }));
});

Then('the request is refused with {string}', (world: PluginAuthorWorld, reason: string) => {
  expect(refusal(world).message).toContain(reason);
});

Given(
  'Acme Tasks has the list {string} as {string} and the list {string} of another user as {string}',
  (world: PluginAuthorWorld, mine: string, mineId: string, other: string, otherId: string) => {
    world.lists.push(
      { id: mineId, name: mine, tasks: [] },
      { id: otherId, name: other, owner: 'another user', tasks: [] },
    );
  },
);

Given('plugin.yaml splits {string} for {string}', (world: PluginAuthorWorld, summary: string, suffix: string) => {
  world.addRule({ match: world.keyOf(summary), split: suffix });
});

Then(/^the request resolves to "([^"]+)" with (.+)$/, (world: PluginAuthorWorld, operation: string, params: string) => {
  const [summary, suffix] = operation.split(' for ') as [string, string | undefined];
  const key = world.keyOf(summary) + (suffix ? `#${suffix}` : '');
  expect(world.last).toEqual({ ok: true, value: { key, params: yamlValue(params) } });
});

Given(
  'plugin.yaml splits {string} for {string} with the note {string}',
  (world: PluginAuthorWorld, summary: string, suffix: string, note: string) => {
    const key = world.keyOf(summary);
    world.addRule({ match: key, split: suffix });
    world.addRule({ match: `${key}#${suffix}`, summaryNote: note });
  },
);

Given('the locked operations take the list id as their literal', (world: PluginAuthorWorld) => {
  world.setYaml({ defaults: { confirm: { param: '/path/listId' } } });
});

When(
  'core asks for the summary of the rename of the list {string} to {int} copies of {string}',
  async (world: PluginAuthorWorld, list: string, n: number, text: string) => {
    const binding = world.binding();
    const { key, params } = await binding.resolveOperation({
      fn: 'request',
      args: [{ method: 'patch', path: `/lists/${list}`, body: { name: text.repeat(n) } }],
    });
    const summary = await binding.summarize({ key, params, targets: [] });
    world.kept.summary = summary.text;
    world.literal = summary.confirmLiteral;
  },
);

Then(
  'the summary shows the change of {string}, the name cut after {int} characters and {string}, and the approver types {string}',
  (world: PluginAuthorWorld, path: string, max: number, note: string, literal: string) => {
    const body = JSON.stringify({ name: 'y'.repeat(500) });
    expect(world.kept.summary).toBe(`Acme Tasks PATCH ${path} ${body.slice(0, max)}… ${note}`);
    expect(world.literal).toBe(literal);
  },
);

When(
  'the plugin looks up the list {string} with {string}',
  async (world: PluginAuthorWorld, list: string, operation: string) => {
    const lookup = restLookup(() => world.client());
    await world.call(() => lookup(world.keyOf(operation), [{ listId: list }], 1000));
  },
);

Then('the lookup is refused', (world: PluginAuthorWorld) => {
  refusal(world);
});

Then('the lookup gives the list {string}', (world: PluginAuthorWorld, name: string) => {
  expect(world.last).toMatchObject({ ok: true, value: { name } });
});

When(
  /^the agent sends "([^"]+)" on "([^"]+)" with the fields (.+)$/,
  async (world: PluginAuthorWorld, operation: string, list: string, fields: string) => {
    const binding = world.binding();
    world.received.length = 0;
    await world.call(async () => {
      const resolved = await binding.resolveOperation({
        fn: 'request',
        args: [requestFor(world, operation, list, yamlValue(fields))],
      });
      return binding.invoke({ ...resolved, context: { callId: 'c-1', deadlineMs: 5000 } });
    });
  },
);

Then(
  /^Acme Tasks receives the body as (form fields|multipart fields|the default encoding) "(.+)"$/,
  (world: PluginAuthorWorld, encoding: string, body: string) => {
    expect(world.last.ok, world.last.ok ? '' : explain((world.last as { error: Error }).error)).toBe(true);
    const req = world.received.at(-1)!;
    const type = req.headers['content-type'] ?? '';
    if (encoding === 'form fields') {
      expect(type).toBe('application/x-www-form-urlencoded');
      expect(req.body).toBe(body);
    } else if (encoding === 'multipart fields') {
      const [name, value] = body.split('=') as [string, string];
      expect(type).toMatch(/^multipart\/form-data; boundary=/);
      expect(req.body).toContain(`name="${name}"\r\n\r\n${value}\r\n`);
    } else {
      expect(type).toBe('application/json');
      expect(req.body).toBe(body);
    }
  },
);

Given('Acme Tasks serves its description only for {string}', (world: PluginAuthorWorld, ref: string) => {
  world.descriptionRefs = new Set([ref]);
});

Given('Acme Tasks fails to serve the description for {string}', (world: PluginAuthorWorld, ref: string) => {
  world.descriptionFailures.add(ref);
});

Given('Acme Tasks serves no description', (world: PluginAuthorWorld) => {
  world.descriptionRefs = new Set();
});

Given(
  'the plugin takes a description of at most {int} bytes, and Acme Tasks serves more',
  (world: PluginAuthorWorld, max: number) => {
    expect(world.descriptionYaml.length).toBeGreaterThan(max);
    world.kept.maxBytes = max;
  },
);

When(
  'the plugin fetches the description for {string}, then for {string}',
  async (world: PluginAuthorWorld, first: string, second: string) => {
    await world.startAcme();
    const candidates = [first, second].map((ref) => ({ url: `${world.baseUrl}/spec/${ref}/openapi.yaml`, ref }));
    const max = world.kept.maxBytes as number | undefined;
    await world.call(() => fetchSpec({ service: 'Acme Tasks', candidates, ...(max ? { maxBytes: max } : {}) }));
  },
);

Then(
  'the plugin gets the description for {string}, and Acme Tasks receives no token with it',
  (world: PluginAuthorWorld, ref: string) => {
    expect(world.last).toEqual({ ok: true, value: { text: world.descriptionYaml, ref } });
    const reads = world.received.filter((r) => r.path.startsWith('/api/spec/'));
    expect(reads.map((r) => r.path)).toEqual(['/api/spec/v4.2/openapi.yaml', `/api/spec/${ref}/openapi.yaml`]);
    for (const r of reads) expect(r.headers.authorization).toBeUndefined();
  },
);

Then('the fetch is refused with {string}', (world: PluginAuthorWorld, reason: string) => {
  expect(refusal(world).message).toContain(reason);
});
