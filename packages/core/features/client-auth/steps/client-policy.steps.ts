import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { auditRows } from '../../administration/steps/administration.js';
import type { Knock } from './client-auth.js';
import {
  bearerOf,
  clientAuth,
  expectRefusal,
  initialize,
  keepAnswer,
  knock,
  mcpSettings,
  ping,
  putMcp,
} from './client-auth.js';

const NOT_ALLOWED = 'This MCP client is not allowed on this server';

/** Agent's app opens a session on the instance and gives this name (and version) for itself. */
const connectAs = async (world: SynoikiaWorld, agent: string, slug: string, name?: unknown, version?: string) => {
  const got = await knock(world, slug, bearerOf(world, agent), initialize(name, version));
  clientAuth(world).seen.all = [...((clientAuth(world).seen.all as Knock[] | undefined) ?? []), got];
  return got;
};
const all = (world: SynoikiaWorld) => (clientAuth(world).seen.all as Knock[] | undefined) ?? [];

const refusedByPolicy = (got: Knock | undefined) =>
  expect(got).toMatchObject({ status: 403, body: { error: { code: -32003, message: NOT_ALLOWED } } });

const seenNames = async (world: SynoikiaWorld) =>
  (await world.expectOk(world.admin.get('/api/settings/mcp/clients-seen'), 'list seen clients')) as unknown as {
    name: string;
    version: string;
  }[];

const policy = (world: SynoikiaWorld, mode: string, names: string[]) =>
  world.expectOk(putMcp(world, { clientPolicy: { mode, names } }), 'set client policy');

Given('the admin lets only the app {string} connect', async (world: SynoikiaWorld, name: string) => {
  await policy(world, 'allow', [name]);
});

Given('the admin refuses the app {string}', async (world: SynoikiaWorld, name: string) => {
  await policy(world, 'deny', [name]);
});

When(
  'agent {word} connects to {string} as {string}',
  async (world: SynoikiaWorld, agent: string, slug: string, name: string) => {
    await connectAs(world, agent, slug, name);
  },
);

Then('agent {word} gets a session as {string}', async (world: SynoikiaWorld, _agent: string, name: string) => {
  const [got] = all(world);
  expect(got!.status, got!.text).toBe(200);
  expect(got!.sessionId).toBeTruthy();
  expect((await seenNames(world)).map((n) => n.name)).toEqual([name]);
});

When(
  'agent {word} connects to {string} as {string}, with no name, and with the number {int}',
  async (world: SynoikiaWorld, agent: string, slug: string, name: string, n: number) => {
    await connectAs(world, agent, slug, name);
    await connectAs(world, agent, slug);
    await connectAs(world, agent, slug, n);
  },
);

Then('each time agent {word} is told that the app is not allowed on this server', (world: SynoikiaWorld) => {
  const got = all(world);
  expect(got.length).toBeGreaterThanOrEqual(2);
  for (const g of got) refusedByPolicy(g);
});

Then(
  'the audit log shows the refusals of {string} and of two apps with no name',
  async (world: SynoikiaWorld, name: string) => {
    const rows = await auditRows(world, { decision: 'client_refused' });
    expect(rows.map((r) => r.detail?.clientName).sort()).toEqual([name, null, null].sort());
    for (const r of rows) expect(r.detail).toMatchObject({ slug: 'tasks', mode: 'allow' });
  },
);

When(
  'agent {word} connects to {string} as {string}, as {string} in a batch of one message, and as {string}',
  async (world: SynoikiaWorld, agent: string, slug: string, a: string, b: string, c: string) => {
    await connectAs(world, agent, slug, a);
    const batch = await knock(world, slug, bearerOf(world, agent), [initialize(b)]);
    clientAuth(world).seen.all = [...all(world), batch];
    await connectAs(world, agent, slug, c);
  },
);

Then(
  'the first two are told that the app is not allowed, {string} gets a session, and the server log names {string}',
  (world: SynoikiaWorld, _fine: string, name: string) => {
    const [first, batch, fine] = all(world);
    refusedByPolicy(first);
    refusedByPolicy(batch);
    expect(fine!.status).toBe(200);
    expect(
      world.serverLog.some((l) => l.startsWith('WARN MCP request refused') && l.includes(` clientName=${name} `)),
    ).toBe(true);
  },
);

Given(
  'agent {word} has a session on {string} as {string}',
  async (world: SynoikiaWorld, agent: string, slug: string, name: string) => {
    const got = await knock(world, slug, bearerOf(world, agent), initialize(name));
    expect(got.status).toBe(200);
    clientAuth(world).seen.session = got.sessionId;
  },
);

When(
  'agent {word} continues its session, and again after the admin turned the policy off',
  async (world: SynoikiaWorld, agent: string) => {
    const id = clientAuth(world).seen.session as string;
    const first = await ping(world, 'tasks', bearerOf(world, agent), id);
    await policy(world, 'off', []);
    const second = await ping(world, 'tasks', bearerOf(world, agent), id);
    clientAuth(world).seen.all = [first, second];
  },
);

Then(
  'agent {word} is told first that the app is not allowed, and then that the session does not exist',
  (world: SynoikiaWorld) => {
    const [first, second] = all(world);
    refusedByPolicy(first);
    expect(second).toMatchObject({ status: 404, body: { error: { message: 'Session not found' } } });
  },
);

Given(
  'agent {word} has two sessions on {string} as {string}',
  async (world: SynoikiaWorld, agent: string, slug: string, name: string) => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const got = await knock(world, slug, bearerOf(world, agent), initialize(name));
      expect(got.status).toBe(200);
      ids.push(got.sessionId!);
    }
    clientAuth(world).seen.sessions = ids;
  },
);

When(
  'agent {word} listens on its first session, and ends its second session',
  async (world: SynoikiaWorld, agent: string) => {
    const [first, second] = clientAuth(world).seen.sessions as string[];
    const on = (id: string) => ({ ...bearerOf(world, agent), 'mcp-session-id': id });
    clientAuth(world).seen.all = [
      await knock(world, 'tasks', on(first!), undefined, 'GET'),
      await knock(world, 'tasks', on(second!), undefined, 'DELETE'),
    ];
  },
);

When(
  'the admin lets only {string} and {string} connect, and then switches to refusing them',
  async (world: SynoikiaWorld, a: string, b: string) => {
    await policy(world, 'allow', [a, b]);
    await world.expectOk(putMcp(world, { clientPolicy: { mode: 'deny' } }), 'switch the mode');
  },
);

Then('the policy refuses only {string}', async (world: SynoikiaWorld, name: string) => {
  expect((await mcpSettings(world)).clientPolicy).toEqual({ mode: 'deny', names: [name] });
});

When(
  'the admin tries an allow list with no name, an empty name, a name of 101 characters or 51 names, and the mode {string}',
  async (world: SynoikiaWorld, mode: string) => {
    const lists = [[], [''], ['x'.repeat(101)], Array.from({ length: 51 }, (_, i) => `app-${i}`)];
    for (const names of lists) await keepAnswer(world, putMcp(world, { clientPolicy: { mode: 'allow', names } }));
    await keepAnswer(world, putMcp(world, { clientPolicy: { mode, names: ['app'] } }));
  },
);

Then(
  'the admin is told each time that the policy is not valid, and the policy stays off',
  async (world: SynoikiaWorld) => {
    const { answers } = clientAuth(world);
    expect(answers).toHaveLength(5);
    for (const a of answers) expectRefusal(a, 'invalid_settings');
    expect((await mcpSettings(world)).clientPolicy).toEqual({ mode: 'off', names: [] });
  },
);

When(
  'agent {word} connects to {string} as {string} to {string}, and then as {string} with the version {string}',
  async (
    world: SynoikiaWorld,
    agent: string,
    slug: string,
    from: string,
    to: string,
    last: string,
    version: string,
  ) => {
    const prefix = from.replace(/\d+$/, '');
    const [start, end] = [from, to].map((n) => Number(/\d+$/.exec(n)![0]));
    for (let i = start!; i <= end!; i++) await connectAs(world, agent, slug, `${prefix}${i}`);
    await connectAs(world, agent, slug, last, version);
  },
);

Then(
  'the admin sees {int} names from {string} at version {string} back to {string}',
  async (world: SynoikiaWorld, count: number, newest: string, version: string, oldest: string) => {
    const names = await seenNames(world);
    expect(names).toHaveLength(count);
    expect(names[0]).toMatchObject({ name: newest, version });
    expect(names.at(-1)).toMatchObject({ name: oldest });
    expect(names.filter((n) => n.name.toLowerCase() === newest.toLowerCase())).toHaveLength(1);
  },
);

Then('user {int} may not see the names', async (world: SynoikiaWorld, user: number) => {
  const res = await world.person(`user ${user}`).portal!.get('/api/settings/mcp/clients-seen');
  expect(res.status).toBe(403);
});

When(
  'agent {word} connects to {string} as {string}, as a name of {int} characters, and as {string}',
  async (world: SynoikiaWorld, agent: string, slug: string, padded: string, length: number, blank: string) => {
    await connectAs(world, agent, slug, padded);
    await connectAs(world, agent, slug, 'L'.repeat(length));
    await connectAs(world, agent, slug, blank);
  },
);

Then(
  'the admin sees {string} and the first {int} characters of the long name, and no blank name',
  async (world: SynoikiaWorld, padded: string, clip: number) => {
    for (const got of all(world)) expect(got.status).toBe(200);
    expect((await seenNames(world)).map((n) => n.name)).toEqual(['L'.repeat(clip), padded]);
  },
);

When(
  'agent {word} sends a broken first message to {string}, and then one over the size limit',
  async (world: SynoikiaWorld, agent: string, slug: string) => {
    clientAuth(world).seen.all = [
      await knock(world, slug, bearerOf(world, agent), '{"jsonrpc":"2.0","method":"initialize",'),
      await knock(
        world,
        slug,
        bearerOf(world, agent),
        JSON.stringify(initialize('blocked', 'x'.repeat(5 * 1024 * 1024))),
      ),
    ];
  },
);

Then(
  'agent {word} is told that the message could not be read and that it is too large, and nothing is audited or kept',
  async (world: SynoikiaWorld) => {
    const [broken, large] = all(world);
    expect(broken).toMatchObject({ status: 400, body: { error: { code: -32700 } } });
    expect(large).toMatchObject({ status: 413 });
    expect(await auditRows(world, { decision: 'client_refused' })).toEqual([]);
    expect(await seenNames(world)).toEqual([]);
    expect(world.serverLog.some((l) => l.startsWith('WARN MCP request rejected by the transport'))).toBe(true);
  },
);
