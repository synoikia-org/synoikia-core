import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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
const authored = new WeakMap<
  SynoikiaWorld,
  { profile?: Record<string, unknown>; output?: string; ownFeature?: { file: string; text: string } }
>();
const authorOf = (world: SynoikiaWorld) => {
  let a = authored.get(world);
  if (!a) authored.set(world, (a = {}));
  return a;
};

const call = (name: string, params: unknown) => ({ fn: 'call', args: [opKey(name), params], key: opKey(name) });

/** The builds of Acme Tasks that break a rule: edits of its entry file or its manifest. */
type Build = {
  entry?: [string, string][];
  manifest?: (m: ManifestJson) => void;
  files?: Record<string, string>;
  /** Extra vitest arguments, such as a file filter. */
  args?: string[];
};

const BROKEN: Record<string, Build> = {
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
  'shows the share password under the name "code"': {
    entry: [
      [
        "'lists.share': (p, ctx) => upstream('GET', `${listPath(p.list)}/share`, undefined, callHeaders(ctx)),",
        "'lists.share': async (p, ctx) => ({ list: p.list, code: (await upstream('GET', `${listPath(p.list)}/share`, undefined, callHeaders(ctx))).password }),",
      ],
    ],
  },
  'shows the API token in the approval of "add a task"': {
    entry: [
      [
        'return p.title ? `${name}: "${p.title}" in ${p.list}`',
        'return p.title ? `${name}: "${p.title}" in ${p.list} with ${secrets.token}`',
      ],
    ],
  },
  'passes the connection test with a wrong API token': {
    entry: [['      refused ? { ok: false', '      false ? { ok: false']],
  },
  'names no network host': {
    manifest: (m) => (m.network.hosts = []),
  },
  'runs only the access rule of the suite': { args: ['access.feature'] },
  'shows the API token in the approval of "delete a list"': {
    entry: [
      [
        ': `${name}: ${p.list}`;',
        ": key === 'lists.delete' ? `${name}: ${p.list} ${secrets.token}` : `${name}: ${p.list}`;",
      ],
    ],
  },
  'cannot summarize "add a task"': {
    entry: [
      [
        '  summarize: (id, { key, params }) =>\n',
        "  summarize: (id, { key, params }) =>\n    key === 'tasks.add' ? fail(id, 'UPSTREAM_ERROR', 'no summary') :\n",
      ],
    ],
  },
  'shows the share password in the open tasks of a list': {
    entry: [
      [
        "'lists.tasks': (p, ctx) => upstream('GET', `${listPath(p.list)}/tasks?status=open`, undefined, callHeaders(ctx)),",
        "'lists.tasks': async (p, ctx) => ({ tasks: await upstream('GET', `${listPath(p.list)}/tasks?status=open`, undefined, callHeaders(ctx)), code: 'groceries-share-7' }),",
      ],
    ],
  },
  'shows the share password when it deletes a list': {
    entry: [
      [
        "'lists.delete': (p, ctx) => upstream('DELETE', listPath(p.list), undefined, callHeaders(ctx)),",
        "'lists.delete': async (p, ctx) => ({ deleted: await upstream('DELETE', listPath(p.list), undefined, callHeaders(ctx)), code: 'groceries-share-7' }),",
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
  'the share password reached the sandbox': `a secret value of the profile reached the agent: "${'groceries-share-7'.slice(0, 4)}…"`,
  'the API token reached the approval': `a secret value of the profile reached the approval of ${opKey('add a task')}: "${API_TOKEN.slice(0, 4)}…"`,
  'the connection test accepted a wrong API token':
    'the connection test passed with the wrong credentials of the profile',
  'the manifest names no network host': 'network.hosts: names no host',
  'the suite did not run every rule': 'the suite file locks.feature did not run',
  'the API token reached the approval of "delete a list"': `a secret value of the profile reached the approval of ${opKey('delete a list')}: "${API_TOKEN.slice(0, 4)}…"`,
  '"add a task" asked for no approval': `${opKey('add a task')} asked for no approval`,
  'the share password reached the agent': `a secret value of the profile reached the agent: "${'groceries-share-7'.slice(0, 4)}…"`,
  '"archive a list" is locked and the profile has no case for it': `${opKey('archive a list')} is locked and the profile has no case for it`,
  'the API token is a secret that is not write-only': 'connection.token: a secret field must be writeOnly',
  'the guide of "import tasks" is not provided': `the guide of ${opKey('import tasks')} is not provided`,
};

type ManifestJson = {
  connection: { schema: { properties: Record<string, { writeOnly?: boolean }> } };
  network: { hosts: string[] };
};

Given(
  'the profile of Acme Tasks names {string}, {string}, the lock {string} of {string} and the share password',
  (world: SynoikiaWorld, read: string, write: string, locked: string, list: string) => {
    authorOf(world).profile = {
      reads: [call(read, { list: 'Groceries' })],
      writes: [call(write, { list: 'Groceries', title: 'butter' })],
      rejects: [{ fn: 'call', args: ['lists.purge', {}] }],
      connectionTest: { wrong: { token: 'acme-tok-wrong' } },
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
async function runSuite(world: SynoikiaWorld, breaks?: string | Build) {
  const fault = breaks === undefined ? {} : typeof breaks === 'string' ? BROKEN[breaks] : breaks;
  if (!fault) throw new Error(`The World has no build of Acme Tasks that ${String(breaks)}`);
  const dir = tasksCopy(world, (copy) => {
    editEntry(copy, fault.entry ?? []);
    const manifestFile = path.join(copy, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as ManifestJson;
    fault.manifest?.(manifest);
    for (const [name, body] of Object.entries(fault.files ?? {})) writeFileSync(path.join(copy, name), body);
    const own = authorOf(world).ownFeature;
    if (own) {
      // A plugin repository has the testing packages installed, as core has them.
      symlinkSync(path.resolve(path.dirname(RUN_CONFIG), '../../node_modules'), path.join(copy, 'node_modules'));
      mkdirSync(path.join(copy, 'features'));
      writeFileSync(path.join(copy, 'features', own.file), own.text);
    }
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
      [VITEST, 'run', '--config', RUN_CONFIG, '--root', dir, ...(fault.args ?? [])],
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

Given(
  'plugin author {int} writes a feature of Acme Tasks for {string} with the steps of the compliance suite',
  (world: SynoikiaWorld, _author: number, name: string) => {
    const a = authorOf(world);
    const callName = `${name} of Groceries`;
    const addName = 'add butter to Groceries';
    a.profile = {
      ...a.profile,
      calls: {
        [callName]: call(name, { list: 'Groceries' }),
        [addName]: call('add a task', { list: 'Groceries', title: 'butter' }),
      },
    };
    a.ownFeature = {
      file: 'open-tasks.feature',
      text: [
        'Feature: Open tasks',
        '  Rule: An agent sees the open tasks of a list',
        '    Scenario: The agent sees the open tasks of Groceries',
        `      Given the group of "${callName}" is at level read`,
        `      When the agent runs "${callName}"`,
        '      Then the agent gets a result that contains "milk"',
        '    Scenario: The open tasks of Groceries hold no task of another list',
        `      Given the group of "${callName}" is at level read`,
        `      When the agent runs "${callName}"`,
        '      Then the agent gets a result that does not contain "sweep"',
        '    Scenario: A read at level read asks no human',
        `      Given the group of "${callName}" is at level read`,
        `      When the agent runs "${callName}"`,
        '      Then no approval was asked',
        '    Scenario: An add with no human still shows its approval',
        '      Given the group of "add butter to Groceries" is at level ask',
        '      When the agent runs "add butter to Groceries"',
        '      Then the approval shows "butter"',
        '',
      ].join('\n'),
    };
  },
);

When('plugin author {int} runs that feature', async (world: SynoikiaWorld) => {
  await runSuite(world);
});

Then('the feature passes against the fake Acme in the plugin harness', (world: SynoikiaWorld) => {
  const output = authorOf(world).output!;
  expect(output, output).toMatch(/✓ \|compliance\| features\/open-tasks\.feature/);
  expect(output).toContain('Acme Tasks (World fixture) 1.0.0 is fit for production.');
});

Given('the profile of Acme Tasks names no sample write', (world: SynoikiaWorld) => {
  authorOf(world).profile = { ...authorOf(world).profile, writes: [] };
});

/** The writes of Acme Tasks; a build with only one of them leaves the others out of its catalog. */
const WRITES = ['rename a list', 'archive a list', 'delete a list', 'add a task', 'complete a task', 'import tasks'];

When(
  'plugin author {int} runs the compliance suite on a build of Acme Tasks whose only write is {string}',
  async (world: SynoikiaWorld, _author: number, name: string) => {
    const remove = WRITES.filter((w) => w !== name).map(opKey);
    await runSuite(world, {
      entry: [
        [
          'const { change = {}, remove = [] } = changes();',
          `const { change = {}, remove = ${JSON.stringify(remove)} } = changes();`,
        ],
      ],
    });
  },
);
