import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import {
  bearerOf,
  clientAuth,
  expectRefusal,
  instanceMethods,
  keepAnswer,
  knock,
  mcpSettings,
  ping,
  putMcp,
} from './client-auth.js';

const METHODS: Record<string, string> = { credentials: 'bearer', OAuth: 'oauth', 'the access gateway': 'external' };
const methodsIn = (text: string) =>
  [...text.matchAll(/credentials|OAuth|the access gateway/g)].map((m) => METHODS[m[0]]!);

const effective = async (world: SynoikiaWorld, slug: string) => {
  const overview = await world.expectOk(world.admin.get('/api/overview'), 'read overview');
  const found = (overview.instances as { slug: string; effectiveAuthMethods: string[] }[]).find((i) => i.slug === slug);
  return found?.effectiveAuthMethods;
};

// ── the methods of the server ──

When('the admin reads the agent sign-in methods', async (world: SynoikiaWorld) => {
  clientAuth(world).seen.settings = await mcpSettings(world);
});

Then('credentials and OAuth are on, and the access gateway is off', (world: SynoikiaWorld) => {
  expect(clientAuth(world).seen.settings).toMatchObject({
    clientAuth: { bearer: true, oauth: true, external: false },
  });
});

When('the admin tries to turn off credentials and OAuth', async (world: SynoikiaWorld) => {
  await keepAnswer(world, putMcp(world, { clientAuth: { bearer: false, oauth: false } }));
});

Then('the admin is told that at least one sign-in method must stay on', async (world: SynoikiaWorld) => {
  const { answer } = clientAuth(world);
  expectRefusal(answer, 'invalid_settings');
  expect(answer.text).toContain('enable at least one method');
  expect((await mcpSettings(world)).clientAuth).toMatchObject({ bearer: true, oauth: true });
});

When(
  'the admin tries to turn on the access gateway without its team, to pick an unknown provider, and to clear the team',
  async (world: SynoikiaWorld) => {
    await keepAnswer(world, putMcp(world, { clientAuth: { external: true } }));
    await keepAnswer(world, putMcp(world, { external: { provider: 'acme-gate' } }));
    await world.accessGateway();
    await keepAnswer(world, putMcp(world, { cfAccess: { teamDomain: '' } }));
  },
);

Then('the admin is told each time that the access gateway is not set up', async (world: SynoikiaWorld) => {
  const [noTeam, provider, cleared] = clientAuth(world).answers;
  for (const answer of [noTeam!, provider!, cleared!]) expectRefusal(answer, 'invalid_settings');
  expect(noTeam!.text).toContain('configure Cloudflare Access before you enable external auth');
  expect(provider!.text).toContain('external.provider');
  expect(cleared!.text).toContain('configure Cloudflare Access');
  expect((await mcpSettings(world)).cfAccess.teamDomain).not.toBe('');
});

When('the admin turns off only credentials', async (world: SynoikiaWorld) => {
  await world.expectOk(putMcp(world, { clientAuth: { bearer: false } }), 'turn off credentials');
});

Then(
  'OAuth and the access gateway stay on, with the team and application of the access gateway',
  async (world: SynoikiaWorld) => {
    expect(await mcpSettings(world)).toMatchObject({
      clientAuth: { bearer: false, oauth: true, external: true },
      cfAccess: { teamDomain: 'acme.cloudflareaccess.com', aud: 'acme-tasks-access' },
    });
  },
);

When(
  'the admin saves the sign-in options {string} and {string} of release 0.10',
  async (world: SynoikiaWorld, a: string, b: string) => {
    await keepAnswer(world, putMcp(world, { [a]: 'bearer', [b]: 'x-user' }));
  },
);

Then(
  'the admin is told that {string} and {string} are no longer supported',
  (world: SynoikiaWorld, a: string, b: string) => {
    const { answer } = clientAuth(world);
    expectRefusal(answer, 'invalid_settings');
    expect(answer.text).toContain(`${a}: no longer supported`);
    expect(answer.text).toContain(`${b}: no longer supported`);
  },
);

// ── the methods of an instance ──

Given('Acme Tasks runs as the instance {string}', async (world: SynoikiaWorld, slug: string) => {
  await world.tasksInstance(slug);
});

Given(/^the admin lets "([^"]+)" take (.+)$/, async (world: SynoikiaWorld, slug: string, methods: string) => {
  await instanceMethods(world, slug, methodsIn(methods));
});

Then('{string} takes credentials and OAuth', async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  const instance = await world.expectOk(world.admin.get(`/api/instances/${id}`), 'read instance');
  expect(instance.authMethods).toEqual(['bearer', 'oauth']);
});

When('the admin tries to let {string} take {string}', async (world: SynoikiaWorld, slug: string, method: string) => {
  const id = await world.tasksInstance(slug);
  await keepAnswer(world, world.admin.patch(`/api/instances/${id}`, { authMethods: ['bearer', method] }));
});

Then('the admin is told that {string} is not a sign-in method', async (world: SynoikiaWorld, method: string) => {
  const { answer } = clientAuth(world);
  expect(answer.status).toBe(400);
  expect(answer.text).toContain('authMethods');
  expect(answer.text).not.toContain(`"authMethods":["bearer","${method}"]`);
  const id = await world.tasksInstance(world.lastInstance);
  expect((await world.expectOk(world.admin.get(`/api/instances/${id}`), 'read instance')).authMethods).toBeNull();
});

Then('{string} takes only OAuth', async (world: SynoikiaWorld, slug: string) => {
  expect(await effective(world, slug)).toEqual(['oauth']);
});

When(
  'agent {word} opens a session on {string} with its credential',
  async (world: SynoikiaWorld, agent: string, slug: string) => {
    await world.tasksInstance(slug);
    clientAuth(world).knocks.set(`agent ${agent}`, await knock(world, slug, bearerOf(world, agent)));
  },
);

Then(
  'agent {word} is told that {string} does not take its kind of credential',
  (world: SynoikiaWorld, agent: string) => {
    const got = clientAuth(world).knocks.get(`agent ${agent}`)!;
    expect(got.status).toBe(401);
    expect(got.body).toMatchObject({ error_description: 'This endpoint does not accept that kind of token' });
  },
);

When(
  'agent {word} and a stranger each open a session on {string}',
  async (world: SynoikiaWorld, agent: string, slug: string) => {
    const { knocks } = clientAuth(world);
    knocks.set(`agent ${agent}`, await knock(world, slug, bearerOf(world, agent)));
    knocks.set('the stranger', await knock(world, slug));
    knocks.set('the stranger at nope', await knock(world, 'nope'));
  },
);

Then('agent {word} is told that {string} accepts no sign-in method', (world: SynoikiaWorld, agent: string) => {
  const got = clientAuth(world).knocks.get(`agent ${agent}`)!;
  expect(got.status).toBe(403);
  expect(got.body).toMatchObject({ error_description: 'This endpoint accepts no client auth method' });
});

Then('the stranger is asked to sign in, as at an instance that does not exist', (world: SynoikiaWorld) => {
  const { knocks } = clientAuth(world);
  const here = knocks.get('the stranger')!;
  const nowhere = knocks.get('the stranger at nope')!;
  expect(here.status).toBe(401);
  expect({ status: here.status, www: here.www, body: here.body }).toEqual({
    status: nowhere.status,
    www: nowhere.www,
    body: nowhere.body,
  });
});

// ── the order of the methods ──

When(
  'agent {word} opens a session on {string} with its credential, and user {int} through the access gateway',
  async (world: SynoikiaWorld, agent: string, slug: string, user: number) => {
    const { knocks } = clientAuth(world);
    knocks.set(`agent ${agent}`, await knock(world, slug, bearerOf(world, agent)));
    const email = world.person(`user ${user}`).username;
    const assertion = await world.gatewayAssertion({ sub: `acme-${user}`, email });
    knocks.set(`user ${user}`, await knock(world, slug, { 'cf-access-jwt-assertion': assertion }));
  },
);

Then('both get a session on {string}', (world: SynoikiaWorld) => {
  const all = [...clientAuth(world).knocks.values()];
  expect(all).toHaveLength(2);
  for (const got of all) {
    expect(got.status, got.text).toBe(200);
    expect(got.sessionId).toBeTruthy();
  }
});

Given('the server has a public address for agents', async (world: SynoikiaWorld) => {
  await world.publicMcpAddress();
});

When(
  'a stranger opens a session on {string} with no credential and no gateway identity',
  async (world: SynoikiaWorld, slug: string) => {
    await world.tasksInstance(slug);
    clientAuth(world).knocks.set('the stranger', await knock(world, slug));
  },
);

Then(
  'the stranger is asked to sign in, and pointed to the OAuth description of {string}',
  (world: SynoikiaWorld, slug: string) => {
    const got = clientAuth(world).knocks.get('the stranger')!;
    expect(got.status).toBe(401);
    expect(got.www).toBe(`Bearer resource_metadata="${world.mcpBase}/.well-known/oauth-protected-resource/${slug}"`);
  },
);

// ── strangers ──

Given('the admin disabled the instance {string}', async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  await world.expectOk(world.admin.patch(`/api/instances/${id}`, { enabled: false }), 'disable instance');
});

When(
  'a stranger opens a session on {string}, on {string} and on {string}',
  async (world: SynoikiaWorld, a: string, b: string, c: string) => {
    await world.tasksInstance(a);
    for (const slug of [a, b, c]) clientAuth(world).knocks.set(slug, await knock(world, slug));
  },
);

Then('the stranger gets the same request to sign in each time', (world: SynoikiaWorld) => {
  const all = [...clientAuth(world).knocks.values()].map((k) => ({ status: k.status, www: k.www, body: k.body }));
  expect(all).toHaveLength(3);
  expect(all[0]).toEqual({
    status: 401,
    www: 'Bearer',
    body: { error: 'unauthorized', error_description: 'Authentication required' },
  });
  expect(all[1]).toEqual(all[0]);
  expect(all[2]).toEqual(all[0]);
});

When(
  'agent {word} opens a session on {string} and on {string} with its credential',
  async (world: SynoikiaWorld, agent: string, a: string, b: string) => {
    for (const slug of [a, b]) clientAuth(world).knocks.set(slug, await knock(world, slug, bearerOf(world, agent)));
  },
);

Then(
  'agent {word} is told that {string} does not exist and that {string} is unavailable',
  (world: SynoikiaWorld, _agent: string, missing: string, disabled: string) => {
    const { knocks } = clientAuth(world);
    expect(knocks.get(missing)).toMatchObject({ status: 404, body: { error: { message: 'Unknown MCP endpoint' } } });
    expect(knocks.get(disabled)).toMatchObject({
      status: 503,
      body: { error: { message: 'This instance is unavailable' } },
    });
  },
);

// ── sessions ──

When(
  'agent {word} continues the session that agent {word} opened on {string}',
  async (world: SynoikiaWorld, agent: string, other: string, slug: string) => {
    const opened = await knock(world, slug, bearerOf(world, other));
    expect(opened.sessionId).toBeTruthy();
    clientAuth(world).knocks.set(`agent ${agent}`, await ping(world, slug, bearerOf(world, agent), opened.sessionId!));
  },
);

Then('agent {word} is told that the session does not exist', (world: SynoikiaWorld, agent: string) => {
  expect(clientAuth(world).knocks.get(`agent ${agent}`)).toMatchObject({
    status: 404,
    body: { error: { message: 'Session not found' } },
  });
});

When(
  'agent {word} opens {int} sessions on {string}',
  async (world: SynoikiaWorld, agent: string, n: number, slug: string) => {
    await world.tasksInstance(slug);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const got = await knock(world, slug, bearerOf(world, agent));
      expect(got.status, got.text).toBe(200);
      ids.push(got.sessionId!);
    }
    clientAuth(world).seen.sessions = ids;
  },
);

Then(
  'the first session of agent {word} no longer exists, and the second one still works',
  async (world: SynoikiaWorld, agent: string) => {
    const [first, second] = clientAuth(world).seen.sessions as string[];
    const slug = world.lastInstance;
    expect(await ping(world, slug, bearerOf(world, agent), first!)).toMatchObject({ status: 404 });
    expect(await ping(world, slug, bearerOf(world, agent), second!)).toMatchObject({ status: 200 });
  },
);
