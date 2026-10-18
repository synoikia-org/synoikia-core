import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { API_TOKEN, eventually } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

const KEY_FILE = 'master.key';
const keyFile = (world: SynoikiaWorld) => path.join(world.dataDir, KEY_FILE);

/** Every file of the data directory as one buffer, without the plugins. */
function dataFiles(dir: string): Buffer {
  return Buffer.concat(
    readdirSync(dir)
      .filter((name) => name !== 'plugins')
      .map((name) => path.join(dir, name))
      .map((file) => (statSync(file).isDirectory() ? dataFiles(file) : readFileSync(file))),
  );
}

const state = new WeakMap<
  SynoikiaWorld,
  { answers: { status: number; body: Record<string, unknown> }[]; logFrom: number }
>();
const of = (world: SynoikiaWorld) => {
  let s = state.get(world);
  if (!s) state.set(world, (s = { answers: [], logFrom: 0 }));
  return s;
};

async function connection(world: SynoikiaWorld, slug: string) {
  const id = await world.tasksInstance(slug);
  return world.expectOk(world.admin.get(`/api/instances/${id}/connection`), 'read connection');
}

// ── the master key ──

When('the operator restarts the server with another master key', async (world: SynoikiaWorld) => {
  await world.stopCore();
  await world.startAgain({ MASTER_KEY: randomBytes(32).toString('base64') });
  expect(world.startError).toBeUndefined();
});

When('the operator restarts the server with a master key of 16 bytes', async (world: SynoikiaWorld) => {
  await world.stopCore();
  await world.startAgain({ MASTER_KEY: randomBytes(16).toString('base64') });
});

When('a new server starts with a master key in its start-up settings', async (world: SynoikiaWorld) => {
  world.coreEnv.MASTER_KEY = randomBytes(32).toString('base64');
  of(world).logFrom = world.serverLog.length;
  await world.freshCore();
});

When('a new server starts without a master key', async (world: SynoikiaWorld) => {
  of(world).logFrom = world.serverLog.length;
  await world.freshCore();
});

Given('the key file of the server holds {string}', (world: SynoikiaWorld, text: string) => {
  writeFileSync(keyFile(world), text);
});

When('core restarts and fails', async (world: SynoikiaWorld) => {
  await world.stopCore();
  await world.startAgain();
});

Then('the server does not start, because the master key must be 32 bytes', (world: SynoikiaWorld) => {
  expect(world.startError).toMatch(/^MASTER_KEY must be 32 bytes of base64/);
  expect(world.servers).toBeUndefined();
});

Then('the server does not start, because the key file must hold 32 bytes', (world: SynoikiaWorld) => {
  expect(world.startError).toBe(`${keyFile(world)} must be 32 bytes of base64 (e.g. \`openssl rand -base64 32\`)`);
  expect(world.servers).toBeUndefined();
});

Then('the key file still holds {string}', (world: SynoikiaWorld, text: string) => {
  expect(readFileSync(keyFile(world), 'utf8')).toBe(text);
});

Then('the data directory holds no key file', (world: SynoikiaWorld) => {
  expect(existsSync(keyFile(world))).toBe(false);
});

Then('the server log does not warn about the master key', (world: SynoikiaWorld) => {
  expect(world.serverLog.slice(of(world).logFrom).filter((l) => l.includes('Master key'))).toEqual([]);
});

Then('the data directory holds a key file that only its owner can read', (world: SynoikiaWorld) => {
  expect(statSync(keyFile(world)).mode & 0o777).toBe(0o600);
  expect(Buffer.from(readFileSync(keyFile(world), 'utf8').trim(), 'base64')).toHaveLength(32);
});

Then('the server log warns that the master key is in the data directory', (world: SynoikiaWorld) => {
  expect(world.serverLog.slice(of(world).logFrom)).toContain(
    `WARN Master key is stored at ${keyFile(world)}, inside the data volume. Set MASTER_KEY to keep it separate from the database.`,
  );
});

// ── secrets at rest ──

Then(
  'agent {word} can read the open tasks {string}, {string} and {string} of {string}',
  async (world: SynoikiaWorld, agent: string, a: string, b: string, c: string, list: string) => {
    await world.call(agent, 'show the open tasks', { list });
    expect(world.answer).toMatchObject({ result: [a, b, c].map((title) => ({ title, done: false })) });
  },
);

Then('the data directory does not hold the API token as plain text', (world: SynoikiaWorld) => {
  expect(dataFiles(world.dataDir).includes(API_TOKEN)).toBe(false);
});

Then(
  'the admin signs in again and sees that {string} cannot read its secrets',
  async (world: SynoikiaWorld, slug: string) => {
    await world.signInAgain();
    const id = await world.tasksInstance(slug);
    let instance: Record<string, unknown> = {};
    await eventually(async () => {
      instance = await world.expectOk(world.admin.get(`/api/instances/${id}`), 'read instance');
      return instance.status === 'error';
    }, 'the instance to show an error');
    expect(instance.statusError).toMatch(/Unable to decrypt value/);
  },
);

// ── the connection in administration ──

When('the admin opens the connection of {string}', async (world: SynoikiaWorld, slug: string) => {
  of(world).answers = [{ status: 200, body: await connection(world, slug) }];
});

Then('the admin sees that the API token is set and ends in {string}', (world: SynoikiaWorld, end: string) => {
  expect(of(world).answers[0]!.body.secrets).toMatchObject({ token: { set: true, hint: `…${end}` } });
});

Then('the connection never shows the API token', (world: SynoikiaWorld) => {
  expect(JSON.stringify(of(world).answers[0]!.body)).not.toContain(API_TOKEN);
});

Given('the admin saves the connection of {string} without the token', async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  await world.expectOk(
    world.admin.put(`/api/instances/${id}/connection`, { config: { url: world.upstream!.url } }),
    'save connection',
  );
  const after = await connection(world, slug);
  expect(after.secrets).toMatchObject({ token: { set: true } });
});

When('the admin clears the token of {string}', async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  await world.expectOk(
    world.admin.put(`/api/instances/${id}/connection`, {
      config: { url: world.upstream!.url },
      secrets: { token: null },
    }),
    'clear token',
  );
});

Then(
  'the admin sees that the API token is not set, and Acme refuses agent {word}',
  async (world: SynoikiaWorld, agent: string) => {
    expect((await connection(world, world.lastInstance)).secrets).toMatchObject({ token: { set: false } });
    await eventually(async () => {
      await world.call(agent, 'show the open tasks', { list: 'Groceries' });
      return 'error' in world.answer;
    }, 'the call to fail');
    expect(world.answer).toMatchObject({ error: 'UPSTREAM_ERROR' });
  },
);

When(
  'the admin tests and saves {string} with the address {string} and no token',
  async (world: SynoikiaWorld, slug: string, url: string) => {
    const id = await world.tasksInstance(slug);
    const answers = [
      await world.admin.post(`/api/instances/${id}/connection/test`, { config: { url } }),
      await world.admin.put(`/api/instances/${id}/connection`, { config: { url } }),
    ];
    of(world).answers = await Promise.all(
      answers.map(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> })),
    );
  },
);

Then('the admin is told both times to enter the token again', async (world: SynoikiaWorld) => {
  for (const a of of(world).answers) {
    expect(a.status).toBe(400);
    expect(a.body).toMatchObject({ error: 'secrets_required', details: ['token'] });
  }
  expect((await connection(world, world.lastInstance)).config).toMatchObject({ url: world.upstream!.url });
});

Then('the test with the address {string} and a new token works', async (world: SynoikiaWorld, url: string) => {
  const id = await world.tasksInstance(world.lastInstance);
  const res = await world.expectOk(
    world.admin.post(`/api/instances/${id}/connection/test`, { config: { url }, secrets: { token: 'a-new-token' } }),
    'test connection',
  );
  expect(res).toMatchObject({ ok: true });
});
