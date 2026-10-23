import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { bearerOf, clientAuth, expectRefusal, keepAnswer, knock, ping } from './client-auth.js';

const MADE_UP = { authorization: 'Bearer syn_madeUpCredentialThatCoreNeverIssued0000' };

const tokensOf = async (world: SynoikiaWorld) =>
  (await world.expectOk(world.admin.get('/api/tokens'), 'list tokens')) as unknown as Record<string, unknown>[];

When(
  'the admin makes the credential {string} for {string}',
  async (world: SynoikiaWorld, name: string, slug: string) => {
    const id = await world.tasksInstance(slug);
    await keepAnswer(world, world.admin.post('/api/tokens', { name, scope: [id] }));
  },
);

Then('the admin sees its secret once, and the list of credentials never shows it', async (world: SynoikiaWorld) => {
  const { answer } = clientAuth(world);
  expect(answer.status).toBe(201);
  const secret = answer.body.token as string;
  expect(secret).toMatch(/^syn_\S{20,}$/);
  const listed = JSON.stringify(await tokensOf(world));
  expect(listed).toContain(answer.body.id as string);
  expect(listed).not.toContain(secret);
  expect(listed).not.toContain(secret.slice(4, 16));
});

When(
  'the admin tries to make a credential for an unknown instance, and one that expired yesterday',
  async (world: SynoikiaWorld) => {
    const id = await world.tasksInstance('tasks');
    await keepAnswer(world, world.admin.post('/api/tokens', { name: 'stray', scope: ['no-such-instance'] }));
    const yesterday = new Date(world.nowMs() - 86_400_000).toISOString();
    await keepAnswer(world, world.admin.post('/api/tokens', { name: 'late', scope: [id], expiresAt: yesterday }));
  },
);

Then(
  'the admin is told that the instance is unknown, and that the expiry must be in the future',
  async (world: SynoikiaWorld) => {
    const [unknown, late] = clientAuth(world).answers;
    expectRefusal(unknown!, 'unknown_instance');
    expectRefusal(late!, 'invalid_expiry');
    expect(await tokensOf(world)).toEqual([]);
  },
);

Then('agent {word} is asked to sign in, as with a made-up credential', async (world: SynoikiaWorld, agent: string) => {
  const got = clientAuth(world).knocks.get(`agent ${agent}`)!;
  const madeUp = await knock(world, world.lastInstance, MADE_UP);
  expect(got.status).toBe(401);
  expect({ www: got.www, body: got.body }).toEqual({ www: madeUp.www, body: madeUp.body });
});

Then(
  'agent {word} is asked to sign in, as with a made-up credential, and gets no tasks',
  async (world: SynoikiaWorld, agent: string) => {
    expect(world.answer.result).toBeUndefined();
    const got = await ping(world, world.lastInstance, bearerOf(world, agent), world.sessionId(agent)!);
    const madeUp = await knock(world, world.lastInstance, MADE_UP);
    expect(got.status).toBe(401);
    expect({ www: got.www, body: got.body }).toEqual({ www: madeUp.www, body: madeUp.body });
  },
);

Given(
  'user {int} has the role {string}, which has the instances {string} and {string}',
  async (world: SynoikiaWorld, user: number, role: string, a: string, b: string) => {
    await world.user(`user ${user}`, role);
    await world.setRoleInstances(role, [a, b]);
  },
);

Given(
  'agent {word} belongs to user {int} with a credential for {string} only',
  async (world: SynoikiaWorld, agent: string, user: number, slug: string) => {
    const id = await world.tasksInstance(slug);
    const created = await world.expectOk(
      world.person(`user ${user}`).portal!.post('/api/me/tokens', { name: `agent ${agent}`, scope: [id] }),
      'create token',
    );
    world.agents.set(agent, { token: created.token as string, tokenId: created.id as string, owner: `user ${user}` });
  },
);

Then(
  'agent {word} is told that its credential is not for {string}, and is not asked to sign in',
  (world: SynoikiaWorld, agent: string) => {
    const got = clientAuth(world).knocks.get(`agent ${agent}`)!;
    expect(got.status).toBe(403);
    expect(got.www).toBe('');
    expect(got.body).toEqual({
      error: 'insufficient_scope',
      error_description: 'This token is not valid for this endpoint',
    });
  },
);

When(
  'a stranger opens a session on {string} with no credential, and then with a made-up one',
  async (world: SynoikiaWorld, slug: string) => {
    const { knocks } = clientAuth(world);
    knocks.set('no credential', await knock(world, slug));
    knocks.set('made up', await knock(world, slug, MADE_UP));
  },
);

Then(
  'the stranger is asked to sign in both times, and pointed to the OAuth description of {string}',
  (world: SynoikiaWorld, slug: string) => {
    const pointer = `resource_metadata="${world.mcpBase}/.well-known/oauth-protected-resource/${slug}"`;
    const { knocks } = clientAuth(world);
    expect(knocks.get('no credential')).toMatchObject({ status: 401, www: `Bearer ${pointer}` });
    expect(knocks.get('made up')).toMatchObject({
      status: 401,
      www: `Bearer ${pointer}, error="invalid_token"`,
    });
  },
);

When(
  'the admin moves the role {string} from {string} to {string}',
  async (world: SynoikiaWorld, role: string, _from: string, to: string) => {
    await world.setRoleInstances(role, [to]);
  },
);

Then(
  'agent {word} gets a session on {string}, and is refused on {string}',
  async (world: SynoikiaWorld, agent: string, open: string, closed: string) => {
    expect(await knock(world, open, bearerOf(world, agent))).toMatchObject({ status: 200 });
    expect(await knock(world, closed, bearerOf(world, agent))).toMatchObject({
      status: 403,
      body: { error: 'insufficient_scope', error_description: 'This endpoint is not available to your role' },
    });
  },
);

Given(
  'agent {word} has a credential of the admin that expires in one hour',
  async (world: SynoikiaWorld, agent: string) => {
    await world.tasksInstance('tasks');
    const expiresAt = new Date(world.nowMs() + 3_600_000).toISOString();
    const created = await world.expectOk(
      world.admin.post('/api/me/tokens', { name: `agent ${agent}`, scope: ['*'], expiresAt }),
      'create token',
    );
    world.agents.set(agent, { token: created.token as string, tokenId: created.id as string, owner: 'admin' });
  },
);

When(
  'agent {word} opens a session on {string} now, after 30 seconds and after 90 seconds',
  async (world: SynoikiaWorld, agent: string, slug: string) => {
    await world.tasksInstance(slug);
    const uses: unknown[] = [];
    for (const wait of [0, 30_000, 60_000]) {
      world.passTime(wait);
      expect(await knock(world, slug, bearerOf(world, agent))).toMatchObject({ status: 200 });
      const mine = (await tokensOf(world)).find((t) => t.id === world.agents.get(agent)!.tokenId);
      uses.push(mine?.lastUsedAt);
    }
    clientAuth(world).seen.uses = uses;
  },
);

Then(
  'the admin sees the last use of agent {word} move only at the first and the third session',
  (world: SynoikiaWorld) => {
    const [first, second, third] = clientAuth(world).seen.uses as string[];
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(new Date(third!).getTime() - new Date(first!).getTime()).toBeGreaterThanOrEqual(90_000);
  },
);

Given(
  'agent {word} belongs to user {int}, whose role {string} has the instance {string}',
  async (world: SynoikiaWorld, agent: string, user: number, role: string, slug: string) => {
    await world.user(`user ${user}`, role);
    await world.setRoleInstances(role, [slug]);
    await world.credential(agent, `user ${user}`, 'write');
  },
);

Then(
  'agent {word} is refused at its next call on {string}, and gets a session on {string}',
  async (world: SynoikiaWorld, agent: string, closed: string, open: string) => {
    expect(await ping(world, closed, bearerOf(world, agent), world.sessionId(agent)!)).toMatchObject({
      status: 403,
      body: { error: 'insufficient_scope', error_description: 'This endpoint is not available to your role' },
    });
    expect(await knock(world, open, bearerOf(world, agent))).toMatchObject({ status: 200 });
  },
);
