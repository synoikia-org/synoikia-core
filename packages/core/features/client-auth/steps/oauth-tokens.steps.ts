import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import type { Flow } from './client-auth.js';
import {
  clientAuth,
  decide,
  exchange,
  expectRefusal,
  flowFor,
  keepAnswer,
  knock,
  mcpSettings,
  putMcp,
  refresh,
  signInForFlow,
  tokenService,
} from './client-auth.js';

const flowOf = (world: SynoikiaWorld): Flow => {
  const flow = clientAuth(world).flow;
  if (!flow) throw new Error('nobody opened a sign-in yet');
  return flow;
};

/** The agent holds the access and refresh token that the last exchange gave. */
const holds = (world: SynoikiaWorld, agent: string, owner: string) => {
  const { answer } = clientAuth(world);
  const flow = flowOf(world);
  world.agents.set(agent, {
    token: answer.body.access_token as string,
    tokenId: '',
    owner,
    oauth: {
      clientId: flow.app.clientId,
      refreshToken: answer.body.refresh_token as string,
      resource: `${world.mcpBase}/tasks`,
    },
  });
};

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

Given('user {int} approved the request of {string}', async (world: SynoikiaWorld, user: number, name: string) => {
  const flow = flowFor(clientAuth(world).apps.get(name)!);
  await signInForFlow(world, flow, `user ${user}`);
  await decide(world, flow, 'approve');
  expect(flow.code).toBeTruthy();
});

When(
  /^"([^"]+)" exchanges the code with the right proof for agent (\w+)$/,
  async (world: SynoikiaWorld, _name: string, agent: string) => {
    const answer = await exchange(world, flowOf(world));
    if (answer.status === 200) holds(world, agent, 'user 12');
  },
);

Given('{string} exchanged the code for agent {word}', async (world: SynoikiaWorld, _name: string, agent: string) => {
  expect((await exchange(world, flowOf(world))).status).toBe(200);
  holds(world, agent, 'user 12');
});

Then(
  'agent {word} gets a session on {string}, and is told that its sign-in is not for {string}',
  async (world: SynoikiaWorld, agent: string, open: string, closed: string) => {
    const token = world.agents.get(agent)!.token;
    expect(await knock(world, open, bearer(token))).toMatchObject({ status: 200 });
    expect(await knock(world, closed, bearer(token))).toMatchObject({
      status: 403,
      body: { error: 'insufficient_scope', error_description: 'This token was not granted for this endpoint' },
    });
  },
);

When('{string} exchanges the code with a wrong proof, and then with the right one', async (world: SynoikiaWorld) => {
  const s = clientAuth(world);
  s.answers.push(await exchange(world, flowOf(world), { code_verifier: 'w'.repeat(43) }));
  s.answers.push(await exchange(world, flowOf(world)));
});

Then('the token service refuses the code both times', (world: SynoikiaWorld) => {
  const [wrong, right] = clientAuth(world).answers;
  expect(wrong).toMatchObject({
    status: 400,
    body: { error: 'invalid_grant', error_description: 'PKCE verification failed' },
  });
  expect(right).toMatchObject({
    status: 400,
    body: { error: 'invalid_grant', error_description: 'Authorization code already used' },
  });
});

When('{string} exchanges the same code again', async (world: SynoikiaWorld) => {
  await exchange(world, flowOf(world));
});

Then('the token service refuses the code with {string}', (world: SynoikiaWorld, why: string) => {
  expect(clientAuth(world).answer).toMatchObject({
    status: 400,
    body: { error: 'invalid_grant', error_description: why },
  });
});

When(
  '{string} exchanges the code with the return address {string}',
  async (world: SynoikiaWorld, _name: string, uri: string) => {
    await exchange(world, flowOf(world), { redirect_uri: uri });
  },
);

When(
  '{string} renews the sign-in of agent {word}, and then sends the first refresh token again',
  async (world: SynoikiaWorld) => {
    const s = clientAuth(world);
    const [first] = s.pairs;
    expect((await refresh(world, flowOf(world), first!.refresh_token)).status).toBe(200);
    s.answers.push(await refresh(world, flowOf(world), first!.refresh_token));
  },
);

Then('the token service refuses the first refresh token the second time', (world: SynoikiaWorld) => {
  expect(clientAuth(world).answers.at(-1)).toMatchObject({
    status: 400,
    body: { error: 'invalid_grant', error_description: 'Refresh token was already used' },
  });
});

Then('the renewed access token and refresh token of agent {word} no longer work', async (world: SynoikiaWorld) => {
  const renewed = clientAuth(world).pairs[1]!;
  expect(await knock(world, 'tasks', bearer(renewed.access_token))).toMatchObject({ status: 401 });
  expect(await refresh(world, flowOf(world), renewed.refresh_token)).toMatchObject({
    status: 400,
    body: { error: 'invalid_grant' },
  });
});

When('30 days and one minute go by', (world: SynoikiaWorld) => {
  world.passTime(30 * 86_400_000 + 60_000);
});

Then(
  'the token service had said that the access lasts one hour, and the refresh token of agent {word} is refused',
  async (world: SynoikiaWorld) => {
    const [first] = clientAuth(world).pairs as unknown as { expires_in: number; refresh_token: string }[];
    expect(first!.expires_in).toBe(3600);
    expect(await refresh(world, flowOf(world), first!.refresh_token)).toMatchObject({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'Refresh token expired or revoked' },
    });
  },
);

When(
  'the admin sets the access lifetime to {int} and to {int} minutes, and the refresh lifetime to {int} and to {int} days',
  async (world: SynoikiaWorld, a1: number, a2: number, r1: number, r2: number) => {
    await world.expectOk(putMcp(world, { accessTokenTtlMinutes: a1 }), 'set access lifetime');
    await keepAnswer(world, putMcp(world, { accessTokenTtlMinutes: a2 }));
    await world.expectOk(putMcp(world, { refreshTokenTtlDays: r1 }), 'set refresh lifetime');
    await keepAnswer(world, putMcp(world, { refreshTokenTtlDays: r2 }));
  },
);

Then(
  'the admin is told that {int} minutes and {int} days are out of bounds, and the lifetimes are {int} minutes and {int} days',
  async (world: SynoikiaWorld, _a: number, _r: number, minutes: number, days: number) => {
    const [access, refreshed] = clientAuth(world).answers;
    expectRefusal(access!, 'invalid_settings');
    expect(access!.text).toContain('accessTokenTtlMinutes');
    expectRefusal(refreshed!, 'invalid_settings');
    expect(refreshed!.text).toContain('refreshTokenTtlDays');
    expect(await mcpSettings(world)).toMatchObject({ accessTokenTtlMinutes: minutes, refreshTokenTtlDays: days });
  },
);

When(
  'the admin renames {string} to {string} and makes a new instance {string}',
  async (world: SynoikiaWorld, from: string, to: string, again: string) => {
    const id = await world.tasksInstance(from);
    await world.expectOk(world.admin.patch(`/api/instances/${id}`, { slug: to }), 'rename instance');
    world.instances.delete(from);
    world.instances.set(to, id);
    await world.tasksInstance(again);
  },
);

Then(
  'agent {word} gets a session on {string}, and is told that its sign-in is not for the new {string}',
  async (world: SynoikiaWorld, agent: string, open: string, closed: string) => {
    const token = world.agents.get(agent)!.token;
    expect(await knock(world, open, bearer(token))).toMatchObject({ status: 200 });
    expect(await knock(world, closed, bearer(token))).toMatchObject({
      status: 403,
      body: { error_description: 'This token was not granted for this endpoint' },
    });
  },
);

When('the admin deletes the instance {string}', async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  const res = await world.admin.del(`/api/instances/${id}`, { confirm: slug });
  expect(res.status, await res.clone().text()).toBe(204);
  world.instances.delete(slug);
});

const grants = async (world: SynoikiaWorld) =>
  (await world.expectOk(world.admin.get('/api/oauth/grants'), 'list grants')) as unknown as {
    id: string;
    revokedAt: string | null;
    user: { username: string };
  }[];

Then(
  'the admin sees the sign-in of agent {word} as revoked, and agent {word} cannot renew it',
  async (world: SynoikiaWorld, agent: string) => {
    const all = await grants(world);
    expect(all).toHaveLength(1);
    expect(all[0]!.revokedAt).toBeTruthy();
    const renewed = await world.renewOAuth(agent);
    expect(renewed.status).toBe(400);
  },
);

When('the admin revokes the sign-in of agent {word}', async (world: SynoikiaWorld) => {
  const [grant] = await grants(world);
  const res = await world.admin.del(`/api/oauth/grants/${grant!.id}`);
  expect(res.status).toBe(204);
});

When(
  '{string} revokes the refresh token of agent {word}',
  async (world: SynoikiaWorld, _name: string, agent: string) => {
    const a = world.agents.get(agent)!;
    const answer = await tokenService(
      world,
      { token: a.oauth!.refreshToken, client_id: a.oauth!.clientId },
      '/oauth/revoke',
    );
    expect(answer.status).toBe(200);
  },
);
