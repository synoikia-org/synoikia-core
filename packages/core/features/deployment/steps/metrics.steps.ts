import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { API_TOKEN, eventually } from '../../support/world.js';
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

When('Prometheus reads the metrics', async (world: SynoikiaWorld) => {
  await readMetrics(world);
});

Then('Prometheus reads the version of core that the portal overview shows', async (world: SynoikiaWorld) => {
  const { version } = await world.expectOk(world.admin.get('/api/overview'), 'read overview');
  expect(version).toMatch(/^\d+\.\d+\.\d+/);
  expect(lastRead(world).text).toContain(`synoikia_build_info{version="${version as string}"} 1`);
});

/** The value of one metric line, matched by name and labels in any order; undefined when Prometheus reads none. */
function metric(text: string, name: string, labels: Record<string, string> = {}) {
  for (const line of text.split('\n')) {
    const m = /^([a-z_]+)(?:\{(.*)\})? (\S+)$/.exec(line);
    if (!m || m[1] !== name) continue;
    const has = Object.fromEntries([...(m[2] ?? '').matchAll(/(\w+)="([^"]*)"/g)].map((l) => [l[1], l[2]]));
    if (Object.entries(labels).every(([k, v]) => has[k] === v)) return Number(m[3]);
  }
  return undefined;
}

async function scrape(world: SynoikiaWorld) {
  await readMetrics(world);
  return lastRead(world).text;
}

Given('the operator started the server with metrics on the port 9464', async (world: SynoikiaWorld) => {
  await world.restartCore(METRICS);
});

Given(
  'agent {word} may read and write the list {string} of the instance {string}',
  async (world: SynoikiaWorld, agent: string, list: string, slug: string) => {
    world.lists.set(
      list,
      ['milk', 'bread', 'eggs'].map((title) => ({ title, done: false })),
    );
    await world.tasksInstance(slug);
    await world.credential(agent, 'admin', 'write');
  },
);

Given('Acme answers after 300 ms', (world: SynoikiaWorld) => {
  world.upstreamDelayMs = 300;
});

Then(
  'Prometheus reads 1 call to {string} that is {word}',
  async (world: SynoikiaWorld, slug: string, outcome: string) => {
    expect(metric(await scrape(world), 'synoikia_calls_total', { instance: slug, outcome })).toBe(1);
  },
);

Then('Prometheus reads 1 call to {string} that failed', async (world: SynoikiaWorld, slug: string) => {
  expect(metric(await scrape(world), 'synoikia_calls_total', { instance: slug, outcome: 'failed' })).toBe(1);
});

Then('Prometheus reads 1 call to {string} that is awaiting approval', async (world: SynoikiaWorld, slug: string) => {
  const text = await scrape(world);
  expect(metric(text, 'synoikia_calls_total', { instance: slug, outcome: 'awaiting_approval' })).toBe(1);
});

Then(
  'Prometheus reads 1 call to {string} in the bucket up to 0.5 s, and none up to 0.25 s',
  async (world: SynoikiaWorld, slug: string) => {
    const text = await scrape(world);
    expect(metric(text, 'synoikia_call_duration_seconds_bucket', { instance: slug, le: '0.5' })).toBe(1);
    expect(metric(text, 'synoikia_call_duration_seconds_bucket', { instance: slug, le: '0.25' })).toBe(0);
  },
);

Given(
  'agent {word} added {string} to {string} of the instance {string} and waits for approval',
  async (world: SynoikiaWorld, agent: string, title: string, list: string, slug: string) => {
    world.lists.set(list, [{ title: 'milk', done: false }]);
    await world.tasksInstance(slug);
    await world.instanceSettings(slug, { approvalTimeoutMs: 10_000 });
    await world.setGroupLevel(slug, 'tasks', 'ask');
    await world.credential(agent, 'admin', 'write');
    await world.call(agent, 'add a task', { list, title });
    expect(world.answer).toMatchObject({ status: 'awaiting_approval' });
  },
);

When('the approval is granted', async (world: SynoikiaWorld) => {
  await (await world.approvalPage('admin')).decide('approve');
});

When('the approval is refused', async (world: SynoikiaWorld) => {
  await (await world.approvalPage('admin')).decide('deny');
});

When('the approval runs out of time', async (world: SynoikiaWorld) => {
  const timedOut = async () =>
    metric(await scrape(world), 'synoikia_approvals_total', { instance: world.lastInstance, outcome: 'timed_out' });
  await eventually(async () => (await timedOut()) === 1, 'the approval to time out', 15_000);
});

Then(
  'Prometheus reads 1 approval for {string} that ended as {}',
  async (world: SynoikiaWorld, slug: string, end: string) => {
    const outcome = end.replace(' ', '_');
    await eventually(
      async () => metric(await scrape(world), 'synoikia_approvals_total', { instance: slug, outcome }) === 1,
      `an approval that ended as ${end}`,
    );
  },
);

Given(
  'Acme Tasks is installed with the instances {string} and {string}',
  async (world: SynoikiaWorld, a: string, b: string) => {
    await world.tasksInstance(a);
    await world.tasksInstance(b);
  },
);

Then('Prometheus reads 1 installed plugin and 2 instances', async (world: SynoikiaWorld) => {
  const text = await scrape(world);
  expect(metric(text, 'synoikia_plugins_installed')).toBe(1);
  expect(metric(text, 'synoikia_instances')).toBe(2);
});

const instanceStatus = async (world: SynoikiaWorld, slug: string) =>
  (await world.expectOk(world.admin.get(`/api/instances/${world.instances.get(slug)!}`), 'read instance'))
    .status as string;

Given('the instance {string} is ready', async (world: SynoikiaWorld, slug: string) => {
  await world.tasksInstance(slug);
  await eventually(async () => (await instanceStatus(world, slug)) === 'ready', 'the instance to be ready');
});

Given('the instance {string} is idle', async (world: SynoikiaWorld, slug: string) => {
  await world.tasksInstance(slug);
  await world.editManifest((m) => (m.lifecycle = 'on-demand'));
  await world.instanceSettings(slug, { idleStopMs: 10 * 60_000 });
  world.passTime(10 * 60_000);
  await eventually(async () => (await instanceStatus(world, slug)) === 'idle', 'the instance to go idle');
});

Given('the instance {string} is stopped', async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  await world.expectOk(world.admin.patch(`/api/instances/${id}`, { enabled: false }), 'disable instance');
  await eventually(async () => (await instanceStatus(world, slug)) === 'stopped', 'the instance to stop');
});

Given('the instance {string} is error', async (world: SynoikiaWorld, slug: string) => {
  world.supervision = { backoff: { initialMs: 60_000, maxMs: 60_000 } };
  await world.restartCore();
  world.pluginFlag('crash', 'init');
  const plugin = (await world.plugin())!;
  await world.expectOk(world.admin.patch(`/api/plugins/${plugin.id}`, { enabled: true }), 'enable plugin');
  const created = await world.expectOk(
    world.admin.post('/api/instances', {
      pluginId: 'tasks',
      slug,
      connection: { url: world.upstream!.url, token: API_TOKEN },
    }),
    'create instance',
  );
  world.instances.set(slug, created.id as string);
  await eventually(async () => (await instanceStatus(world, slug)) === 'error', 'the instance to fail');
});

Then('Prometheus reads {string} as {word}', async (world: SynoikiaWorld, slug: string, state: string) => {
  const text = await scrape(world);
  expect(metric(text, 'synoikia_instance_state', { instance: slug, state })).toBe(1);
  for (const other of ['ready', 'idle', 'stopped', 'error'].filter((s) => s !== state))
    expect(metric(text, 'synoikia_instance_state', { instance: slug, state: other })).toBeUndefined();
});

Given(
  'agent {word} of the admin and agent {word} of user {int} called {string} in the last hour',
  async (world: SynoikiaWorld, a: string, b: string, user: number, slug: string) => {
    world.lists.set('Groceries', [{ title: 'milk', done: false }]);
    await world.tasksInstance(slug);
    await world.user(`user ${user}`, 'shoppers');
    await world.setRoleInstances('shoppers', [slug]);
    await world.setRoleMaximum('shoppers', slug, { group: 'lists' }, 'read');
    await world.credential(a, 'admin', 'write');
    await world.credential(b, `user ${user}`, 'read');
    for (const agent of [a, b]) {
      await world.call(agent, 'show the open tasks', { list: 'Groceries' });
      expect(world.answer).toHaveProperty('result');
    }
  },
);

Then('Prometheus reads 2 active users', async (world: SynoikiaWorld) => {
  expect(metric(await scrape(world), 'synoikia_active_users')).toBe(2);
});

Given(
  'agent {word} connected to {string} from {string} and agent {word} from {string}',
  async (world: SynoikiaWorld, a: string, slug: string, appA: string, b: string, appB: string) => {
    await world.tasksInstance(slug);
    for (const [agent, app] of [
      [a, appA],
      [b, appB],
    ] as const) {
      await world.credential(agent, 'admin', 'read');
      await world.connect(agent, slug, undefined, app);
    }
  },
);

Then(
  'Prometheus reads 1 session from {string} and 1 from {string}',
  async (world: SynoikiaWorld, appA: string, appB: string) => {
    const text = await scrape(world);
    expect(metric(text, 'synoikia_sessions_by_app', { app: appA })).toBe(1);
    expect(metric(text, 'synoikia_sessions_by_app', { app: appB })).toBe(1);
  },
);

Given(
  'agent {word} and agent {word} each have a session open on {string}',
  async (world: SynoikiaWorld, a: string, b: string, slug: string) => {
    await world.tasksInstance(slug);
    for (const agent of [a, b]) {
      await world.credential(agent, 'admin', 'read');
      await world.session(agent, slug);
    }
  },
);

Then('Prometheus reads 2 open sessions on {string}', async (world: SynoikiaWorld, slug: string) => {
  expect(metric(await scrape(world), 'synoikia_sessions_open', { instance: slug })).toBe(2);
});

Given('the admin revoked the token of agent {word}', async (world: SynoikiaWorld, agent: string) => {
  await world.tasksInstance('tasks');
  await world.credential(agent, 'admin', 'read');
  const { tokenId } = world.agents.get(agent)!;
  await world.expectOk(world.admin.del(`/api/me/tokens/${tokenId}`), 'revoke token');
});

When('agent {word} calls {string}', async (world: SynoikiaWorld, agent: string, slug: string) => {
  await expect(world.connect(agent, slug)).rejects.toThrow();
});

Then('Prometheus reads 1 failed agent sign-in', async (world: SynoikiaWorld) => {
  expect(metric(await scrape(world), 'synoikia_agent_sign_in_failures_total')).toBe(1);
});

Then(
  'no metric that Prometheus reads contains {string} or {string}',
  async (world: SynoikiaWorld, secret: string, list: string) => {
    const text = await scrape(world);
    expect(metric(text, 'synoikia_calls_total', { instance: 'tasks', outcome: 'done' })).toBe(1);
    expect(text).not.toContain(secret);
    expect(text).not.toContain(list);
  },
);
