import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { API_TOKEN, opKey } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';
import { editEntry, tasksCopy } from './plugin-test-harness.steps.js';

const RUN_CONFIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../support/compliance-run.config.ts');
const VITEST = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');

/** Plugin author 3's compliance profile of Acme Tasks, and what the last run of the suite printed. */
const authored = new WeakMap<SynoikiaWorld, { profile?: Record<string, unknown>; output?: string }>();
const authorOf = (world: SynoikiaWorld) => {
  let a = authored.get(world);
  if (!a) authored.set(world, (a = {}));
  return a;
};

const call = (name: string, params: unknown) => ({ fn: 'call', args: [opKey(name), params], key: opKey(name) });

/** The builds of Acme Tasks that break a rule: edits of its entry file or its manifest. */
const BROKEN: Record<
  string,
  { entry?: [string, string][]; manifest?: (m: ManifestJson) => void; files?: Record<string, string> }
> = {
  'throws "boom" when it loads': {
    entry: [
      [
        'const HERE = path.dirname(fileURLToPath(import.meta.url));',
        "throw new Error('boom');\nconst HERE = path.dirname(fileURLToPath(import.meta.url));",
      ],
    ],
  },
  'syncs no operation': {
    entry: [['operations: await catalog() }', 'operations: [] }']],
  },
  'gives "add a task" no description': {
    entry: [
      [
        "op('tasks.add', 'add a task', 'tasks', 'write', {",
        "op('tasks.add', 'add a task', 'tasks', 'write', {\n    docs: undefined,",
      ],
    ],
  },
  'classifies "add a task" as a read': {
    entry: [["op('tasks.add', 'add a task', 'tasks', 'write', {", "op('tasks.add', 'add a task', 'tasks', 'read', {"]],
  },
  'maps an unknown call to "show the open tasks"': {
    entry: [
      [
        "if (!known(key)) return fail(id, 'UNKNOWN_OPERATION', `unknown operation: ${key}`);\n    reply(id, { key, params });",
        "if (!known(key)) return reply(id, { key: 'lists.tasks', params: { list: 'Groceries' } });\n    reply(id, { key, params });",
      ],
    ],
  },
  'asks to type "delete" to delete a list': {
    entry: [['{ confirmLiteral: params.list }', "{ confirmLiteral: 'delete' }"]],
  },
  'does not lock "delete a list"': {
    entry: [
      [
        "op('lists.delete', 'delete a list', 'lists', 'write', { locked: true,",
        "op('lists.delete', 'delete a list', 'lists', 'write', {",
      ],
    ],
  },
  'does not name the list in the approval of "delete a list"': {
    entry: [
      [
        'return p.title ? `${name}: "${p.title}" in ${p.list}` : `${name}: ${p.list}`;',
        'return p.title ? `${name}: "${p.title}" in ${p.list}` : name;',
      ],
    ],
  },
  'locks "purge lists", which its catalog does not have': {
    files: { 'plugin.yaml': 'rules:\n  - match: lists.purge\n    locked: true\n    reason: Purges every list.\n' },
  },
  'also locks "archive a list"': {
    entry: [
      [
        "{ typedConfirmation: true, matchProfile: 'list' }",
        "{ typedConfirmation: true, locked: true, matchProfile: 'list' }",
      ],
    ],
  },
  'shows the API token field as plain text': {
    manifest: (m) => delete m.connection.schema.properties.token!.writeOnly,
  },
  'does not ship the guide of "import tasks"': {
    entry: [
      [
        "reply(id, await upstream('GET', `/guides/${encodeURIComponent(key)}`));",
        "fail(id, 'UPSTREAM_ERROR', `no guide for ${key}`);",
      ],
    ],
  },
};

/** What the suite tells plugin author 3 for each broken rule. */
const FAILURES: Record<string, string> = {
  'Acme Tasks does not start, and shows "boom"': 'the plugin does not start: ',
  'the catalog is empty': 'the catalog is empty',
  '"add a task" has no description': `${opKey('add a task')} has no description`,
  'the lock "purge lists" names no operation': 'the lock lists.purge names no operation',
  '"add a task" ran at level read': `${opKey('add a task')} ran at level read`,
  'Acme Tasks accepted a call that is not in its catalog': 'the plugin accepted a call that is not in its catalog',
  '"delete a list" asks to type "delete" in place of "Chores"': `${opKey('delete a list')} asks to type "delete" in place of "Chores"`,
  '"delete a list" is not off by default': `${opKey('delete a list')} is not off by default`,
  'the approval of "delete a list" does not show "Chores"': `the approval of ${opKey('delete a list')} does not show "Chores"`,
  '"archive a list" is locked and the profile has no case for it': `${opKey('archive a list')} is locked and the profile has no case for it`,
  'the API token is a secret that is not write-only': 'connection.token: a secret field must be writeOnly',
  'the guide of "import tasks" is not provided': `the guide of ${opKey('import tasks')} is not provided`,
};

type ManifestJson = { connection: { schema: { properties: Record<string, { writeOnly?: boolean }> } } };

Given(
  'the profile of Acme Tasks names {string}, {string}, the lock {string} of {string} and the share password',
  (world: SynoikiaWorld, read: string, write: string, locked: string, list: string) => {
    authorOf(world).profile = {
      reads: [call(read, { list: 'Groceries' })],
      writes: [call(write, { list: 'Groceries', title: 'butter' })],
      rejects: [{ fn: 'call', args: ['lists.purge', {}] }],
      locks: { [opKey(locked)]: { ...call(locked, { list }), confirm: list, target: list } },
      secrets: [
        {
          ...call('show the share password', { list: 'Groceries' }),
          values: [world.sharePasswords.get('Groceries'), API_TOKEN],
        },
      ],
    };
  },
);

/** Runs the suite the way plugin author 3 does: vitest in the copy, with the profile and the fake in its test folder. */
async function runSuite(world: SynoikiaWorld, breaks?: string) {
  const fault = breaks === undefined ? {} : BROKEN[breaks];
  if (!fault) throw new Error(`The World has no build of Acme Tasks that ${breaks}`);
  const dir = tasksCopy(world, (copy) => {
    editEntry(copy, fault.entry ?? []);
    const manifestFile = path.join(copy, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as ManifestJson;
    fault.manifest?.(manifest);
    for (const [name, body] of Object.entries(fault.files ?? {})) writeFileSync(path.join(copy, name), body);
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    mkdirSync(path.join(copy, 'test'));
    writeFileSync(
      path.join(copy, 'test', 'fake.mjs'),
      `export async function start() { return { url: ${JSON.stringify(world.upstream!.url)}, close() {} }; }\n`,
    );
    const profile = {
      fake: 'test/fake.mjs',
      connection: { url: '${fake.url}', token: API_TOKEN },
      ...authorOf(world).profile,
    };
    writeFileSync(path.join(copy, 'test', 'compliance.yaml'), JSON.stringify(profile, null, 2));
  });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST')));
  authorOf(world).output = await new Promise<string>((resolve) => {
    execFile(
      process.execPath,
      [VITEST, 'run', '--config', RUN_CONFIG, '--root', dir],
      { env: { ...env, SYNOIKIA_COMPLIANCE_PLUGIN: dir, NO_COLOR: '1' }, maxBuffer: 16 * 1024 * 1024 },
      (_err, stdout, stderr) => resolve(`${stdout}\n${stderr}`),
    );
  });
}

When('plugin author {int} runs the compliance suite on Acme Tasks', async (world: SynoikiaWorld) => {
  await runSuite(world);
});

When(
  'plugin author {int} runs the compliance suite on a build of Acme Tasks that {}',
  async (world: SynoikiaWorld, _author: number, breaks: string) => {
    await runSuite(world, breaks);
  },
);

Then(
  'the suite certifies Acme Tasks {word} for production, with no failed rule',
  (world: SynoikiaWorld, version: string) => {
    const output = authorOf(world).output!;
    expect(output, output).toContain(`Acme Tasks (World fixture) ${version} is fit for production.`);
    expect(output).not.toContain('Failed rule:');
  },
);

Then('the suite does not certify Acme Tasks, because {}', (world: SynoikiaWorld, failure: string) => {
  const output = authorOf(world).output!;
  const message = FAILURES[failure];
  if (!message) throw new Error(`The World has no failure "${failure}"`);
  expect(output, output).toContain('Acme Tasks (World fixture) 1.0.0 is not fit for production.');
  expect(output).toContain(`Failed rule: ${message}`);
  const shown = /shows "(.+)"$/.exec(failure)?.[1];
  if (shown) expect(output.split('\n').find((l) => l.startsWith(`Failed rule: ${message}`))).toContain(shown);
});
