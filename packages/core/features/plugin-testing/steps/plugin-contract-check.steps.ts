import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { checkPluginContract, startFakeHttp } from '../../../src/testing/index.js';
import type { FakeHttp } from '../../../src/testing/index.js';
import { seenBy } from '../../approvals/steps/approval-channels.steps.js';
import { API_TOKEN, opKey } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';
import { startHarness, tasksVariant } from './plugin-test-harness.steps.js';

/** What plugin author 3's contract test saw: the issues, its own fake Acme and the answer it got. */
const checked = new WeakMap<
  SynoikiaWorld,
  { issues?: string[]; fake?: FakeHttp; answer?: { status: number; body: unknown } }
>();
const checkOf = (world: SynoikiaWorld) => {
  let c = checked.get(world);
  if (!c) checked.set(world, (c = {}));
  return c;
};

const call = (name: string, params: unknown) => ({
  key: opKey(name),
  code: `return await tasks.call('${opKey(name)}', ${JSON.stringify(params)});`,
});

/** The builds of "Acme Tasks" that break the contract, as edits of its entry file. */
const BROKEN: Record<string, [string, string][]> = {
  'swaps the reads and the writes': [
    [
      "op('lists.tasks', 'show the open tasks', 'lists', 'read'",
      "op('lists.tasks', 'show the open tasks', 'lists', 'write'",
    ],
    ["op('tasks.add', 'add a task', 'tasks', 'write'", "op('tasks.add', 'add a task', 'tasks', 'read'"],
  ],
  'asks to type "delete" to delete a list': [['{ confirmLiteral: params.list }', "{ confirmLiteral: 'delete' }"]],
  'shows the share password under the name "code"': [
    [
      "'lists.share': (p, ctx) => upstream('GET', `${listPath(p.list)}/share`, undefined, callHeaders(ctx)),",
      "'lists.share': async (p, ctx) => ({ list: p.list, code: (await upstream('GET', `${listPath(p.list)}/share`, undefined, callHeaders(ctx))).password }),",
    ],
  ],
};

Given('plugin author {int} started the plugin harness on Acme Tasks', async (world: SynoikiaWorld) => {
  await startHarness(world);
});

Given(
  'plugin author {int} started the plugin harness on a build of Acme Tasks that {}',
  async (world: SynoikiaWorld, _author: number, breaks: string) => {
    const edits = BROKEN[breaks];
    if (!edits) throw new Error(`The World has no build of Acme Tasks that ${breaks}`);
    await startHarness(world, tasksVariant(world, edits));
  },
);

When(
  'plugin author {int} checks the contract with {string}, {string}, {string} of {string} and the share password',
  async (world: SynoikiaWorld, _author: number, read: string, write: string, locked: string, list: string) => {
    checkOf(world).issues = await checkPluginContract(seenBy(world).harness!, {
      read: call(read, { list: 'Groceries' }),
      write: call(write, { list: 'Groceries', title: 'butter' }),
      locked: { ...call(locked, { list }), confirm: list },
      secrets: {
        code: call('show the share password', { list: 'Groceries' }).code,
        values: [world.sharePasswords.get('Groceries')!, API_TOKEN],
      },
    });
  },
);

When(
  'plugin author {int} checks the contract with the read {string} and the write {string}',
  async (world: SynoikiaWorld, _author: number, read: string, write: string) => {
    checkOf(world).issues = await checkPluginContract(seenBy(world).harness!, {
      read: { key: read === 'show the done tasks' ? 'lists.done' : opKey(read), code: '' },
      write: call(write, { list: 'Groceries', title: 'butter' }),
    });
  },
);

Then('the contract check reports no issues', (world: SynoikiaWorld) => {
  expect(checkOf(world).issues).toEqual([]);
});

Then(
  'the contract check reports that {string} is not a read and {string} is not a write',
  (world: SynoikiaWorld, read: string, write: string) => {
    expect(checkOf(world).issues).toEqual(
      expect.arrayContaining([`${opKey(read)}: expected a read`, `${opKey(write)}: expected a write`]),
    );
  },
);

Then(
  'the contract check reports that {string} asks to type {string} in place of {string}',
  (world: SynoikiaWorld, name: string, literal: string, expected: string) => {
    expect(checkOf(world).issues).toContain(
      `locked ${opKey(name)}: confirmation literal is "${literal}", expected "${expected}"`,
    );
  },
);

Then('the contract check reports that the share password reached the sandbox', (world: SynoikiaWorld) => {
  const password = world.sharePasswords.get('Groceries')!;
  expect(checkOf(world).issues).toEqual([`secrets: "${password.slice(0, 4)}"… reached the sandbox`]);
});

Then('the contract check reports only that the catalog has no "show the done tasks"', (world: SynoikiaWorld) => {
  expect(checkOf(world).issues).toEqual(['read: No operation lists.done in the synced catalog']);
});

// ── the fake server ──

Given(
  'plugin author {int} fakes Acme with a route for a list by its name, which needs the API token',
  async (world: SynoikiaWorld) => {
    const fake = await startFakeHttp({
      routes: {
        'GET /lists/{name}': (req) => ({ body: { name: req.params.name } }),
        'GET /lists/{name}/share': () => {
          throw new Error('share is down');
        },
      },
      guard: (req) => (req.headers.authorization === `Bearer ${API_TOKEN}` ? undefined : { status: 401 }),
    });
    world.cleanups.push(() => fake.close());
    checkOf(world).fake = fake;
  },
);

async function ask(world: SynoikiaWorld, pathname: string, token = true) {
  const c = checkOf(world);
  const res = await fetch(`${c.fake!.url}${pathname}`, {
    headers: token ? { authorization: `Bearer ${API_TOKEN}` } : {},
  });
  const text = await res.text();
  c.answer = { status: res.status, body: text ? (JSON.parse(text) as unknown) : undefined };
}

const listPath = (list: string) => `/lists/${encodeURIComponent(list)}`;

When(
  'plugin author {int} asks the fake Acme for the list {string}',
  async (world: SynoikiaWorld, _a: number, list: string) => {
    await ask(world, listPath(list));
  },
);

When(
  'plugin author {int} asks the fake Acme for the list {string} without the API token',
  async (world: SynoikiaWorld, _a: number, list: string) => {
    await ask(world, listPath(list), false);
  },
);

When(
  'plugin author {int} asks the fake Acme for the done tasks of {string}',
  async (world: SynoikiaWorld, _a: number, list: string) => {
    await ask(world, `${listPath(list)}/tasks?status=done`);
  },
);

When(
  'plugin author {int} asks the fake Acme for the share password of {string}',
  async (world: SynoikiaWorld, _a: number, list: string) => {
    await ask(world, `${listPath(list)}/share`);
  },
);

Then(
  'the fake Acme answers with the list {string}, and kept one request for that list',
  (world: SynoikiaWorld, list: string) => {
    const c = checkOf(world);
    expect(c.answer).toEqual({ status: 200, body: { name: list } });
    expect(c.fake!.requests.map((r) => `${r.method} ${r.path}`)).toEqual([`GET ${listPath(list)}`]);
  },
);

Then('the fake Acme answers that it has no such route', (world: SynoikiaWorld) => {
  expect(checkOf(world).answer).toEqual({ status: 404, body: { message: 'Not found' } });
});

Then('the fake Acme answers with a server error that says {string}', (world: SynoikiaWorld, message: string) => {
  expect(checkOf(world).answer).toEqual({ status: 500, body: { message } });
});

Then('the fake Acme answers that the request is not authorized', (world: SynoikiaWorld) => {
  expect(checkOf(world).answer?.status).toBe(401);
});
