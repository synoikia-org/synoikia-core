import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { startFakeHttp } from '../../../src/testing/index.js';
import type { FakeHttp } from '../../../src/testing/index.js';
import { API_TOKEN } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

/** What plugin author 3's fake Acme is, and the answer it gave. */
const checked = new WeakMap<SynoikiaWorld, { fake?: FakeHttp; answer?: { status: number; body: unknown } }>();
const checkOf = (world: SynoikiaWorld) => {
  let c = checked.get(world);
  if (!c) checked.set(world, (c = {}));
  return c;
};

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
