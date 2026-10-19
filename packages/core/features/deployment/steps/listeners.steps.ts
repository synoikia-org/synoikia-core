import { Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { INITIALIZE, rawRequest } from './requests.js';

const state = new WeakMap<SynoikiaWorld, { statuses: number[]; bodies: string[] }>();
const of = (world: SynoikiaWorld) => {
  let s = state.get(world);
  if (!s) state.set(world, (s = { statuses: [], bodies: [] }));
  return s;
};

async function ask(world: SynoikiaWorld, requests: Promise<{ status: number; text: string }>[]) {
  const answers = await Promise.all(requests);
  of(world).statuses = answers.map((a) => a.status);
  of(world).bodies = answers.map((a) => a.text);
}

/** Restarts core with a start-up setting that may stop the start. */
async function restartWith(world: SynoikiaWorld, env: Record<string, string>) {
  await world.stopCore();
  await world.startAgain(env);
}

When('someone asks the agent port for the portal session and for the sign-in', async (world: SynoikiaWorld) => {
  await ask(world, [
    rawRequest(world.mcpBase, '/api/session'),
    rawRequest(world.mcpBase, '/auth/login', { body: { username: 'admin', password: 'x' } }),
  ]);
});

When(
  'someone asks the portal port for the instance {string}, for the OAuth description and for a token',
  async (world: SynoikiaWorld, slug: string) => {
    await ask(world, [
      rawRequest(world.adminBase, `/${slug}`, { body: INITIALIZE }),
      rawRequest(world.adminBase, '/.well-known/oauth-authorization-server'),
      rawRequest(world.adminBase, '/oauth/token', { body: {} }),
    ]);
  },
);

Then('both are not found', (world: SynoikiaWorld) => {
  expect(of(world).statuses).toEqual([404, 404]);
});

Then('all three are not found', (world: SynoikiaWorld) => {
  expect(of(world).statuses).toEqual([404, 404, 404]);
});

When(
  'the operator restarts the server with both listeners on the port {int}',
  async (world: SynoikiaWorld, port: number) => {
    await restartWith(world, { MCP_PORT: String(port), ADMIN_PORT: String(port) });
  },
);

Then('the server does not start, because the two ports must differ', (world: SynoikiaWorld) => {
  expect(world.startError).toContain('MCP_PORT and ADMIN_PORT must differ');
  expect(world.servers).toBeUndefined();
});

When('someone checks the health of both listeners without a sign-in', async (world: SynoikiaWorld) => {
  await ask(world, [rawRequest(world.mcpBase, '/healthz'), rawRequest(world.adminBase, '/healthz')]);
});

Then('both answer only "ok"', (world: SynoikiaWorld) => {
  expect(of(world).statuses).toEqual([200, 200]);
  expect(of(world).bodies.map((b) => JSON.parse(b) as unknown)).toEqual([{ status: 'ok' }, { status: 'ok' }]);
});

When('the operator restarts the server with the public address {string}', async (world: SynoikiaWorld, url: string) => {
  await restartWith(world, { PUBLIC_MCP_URL: url });
});

When('the operator restarts the server with an empty public address', async (world: SynoikiaWorld) => {
  world.serverLog.length = 0;
  await restartWith(world, { PUBLIC_MCP_URL: '' });
});

Then('the server does not start, because the public address is not valid', (world: SynoikiaWorld) => {
  expect(world.startError).toMatch(/PUBLIC_MCP_URL/);
  expect(world.startError).toMatch(/Invalid URL/i);
  expect(world.servers).toBeUndefined();
});

Then('the server starts and warns that OAuth is off until the public address is set', async (world: SynoikiaWorld) => {
  expect(world.startError).toBeUndefined();
  expect(world.serverLog).toContain(
    'WARN PUBLIC_MCP_URL is not set: OAuth is off (bearer tokens still work). Set it to the public address of the MCP port.',
  );
  expect((await rawRequest(world.mcpBase, '/healthz')).status).toBe(200);
});
