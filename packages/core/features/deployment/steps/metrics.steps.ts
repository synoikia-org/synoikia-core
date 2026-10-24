import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { CORE_VERSION } from '../../../src/version.js';
import type { SynoikiaWorld } from '../../support/world.js';
import { rawRequest } from './requests.js';

// The scenarios name the port 9464. Core takes a free one, so scenarios that run at once do not collide.
const METRICS = { METRICS_HOST: '127.0.0.1', METRICS_PORT: '0' };

const reads = new WeakMap<SynoikiaWorld, { status: number; text: string }>();
const lastRead = (world: SynoikiaWorld) => reads.get(world) ?? expect.fail('nobody read the metrics');

async function readMetrics(world: SynoikiaWorld, token?: string) {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  reads.set(world, await rawRequest(world.metricsBase, '/metrics', { headers }));
}

When('the operator starts the server without a metrics port', async (world: SynoikiaWorld) => {
  await world.restartCore();
});

Then('the server opens no metrics port', (world: SynoikiaWorld) => {
  expect(world.servers?.metrics).toBeUndefined();
  expect(world.metricsBase).toBe('');
});

When(
  'the operator restarts the server with metrics and the portal both on the port {int}',
  async (world: SynoikiaWorld, port: number) => {
    await world.stopCore();
    await world.startAgain({ METRICS_PORT: String(port), ADMIN_PORT: String(port) });
  },
);

Then('the server does not start, because the ports must differ', (world: SynoikiaWorld) => {
  expect(world.startError).toContain('METRICS_PORT must differ from MCP_PORT and ADMIN_PORT');
  expect(world.servers).toBeUndefined();
});

Given(
  'the operator started the server with metrics on the port 9464 and the scrape token {string}',
  async (world: SynoikiaWorld, token: string) => {
    await world.restartCore({ ...METRICS, METRICS_TOKEN: token });
  },
);

When('Prometheus reads the metrics with the token {string}', async (world: SynoikiaWorld, token: string) => {
  await readMetrics(world, token);
});

Then('Prometheus gets the metrics', (world: SynoikiaWorld) => {
  const read = lastRead(world);
  expect(read.status).toBe(200);
  expect(read.text).toContain('synoikia_build_info');
});

When('someone reads the metrics with the token {string}', async (world: SynoikiaWorld, token: string) => {
  await readMetrics(world, token);
});

Then('they are refused as unauthenticated and see no metric', (world: SynoikiaWorld) => {
  const read = lastRead(world);
  expect(read.status).toBe(401);
  expect(read.text).not.toContain('synoikia_');
});

When(
  'the operator starts the server with metrics on the port 9464 and no scrape token',
  async (world: SynoikiaWorld) => {
    await world.restartCore(METRICS);
  },
);

Then(
  'the server starts and warns that anyone who reaches the port can read the metrics',
  async (world: SynoikiaWorld) => {
    expect(world.serverLog).toContain(
      'WARN METRICS_TOKEN is not set: anyone who reaches the metrics port can read the metrics.',
    );
    await readMetrics(world);
    expect(lastRead(world).status).toBe(200);
  },
);

Given('the operator started core 0.23.0 with metrics on the port 9464', async (world: SynoikiaWorld) => {
  expect(CORE_VERSION).toBe('0.23.0');
  await world.restartCore(METRICS);
});

When('Prometheus reads the metrics', async (world: SynoikiaWorld) => {
  await readMetrics(world);
});

Then('Prometheus reads the version {string}', (world: SynoikiaWorld, version: string) => {
  expect(lastRead(world).text).toContain(`synoikia_build_info{version="${version}"} 1`);
});
