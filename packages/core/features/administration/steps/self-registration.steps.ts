import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { identity, keep, newPortal } from '../../identity/steps/identity.js';
import { admin, auditRows, refusal } from './administration.js';

type Portal = Awaited<ReturnType<SynoikiaWorld['portalBrowser']>>;
const SOURCES: Record<string, string> = { 'sign-up': 'signup', 'Acme ID': 'oidc', 'the access gateway': 'external' };

const usersNamed = async (world: SynoikiaWorld, username: string) =>
  ((await world.expectOk(world.admin.get('/api/users'), 'list users')) as unknown as { id: string; username: string }[])
    .filter((u) => u.username === username)
    .map((u) => u.id);

Given('the admin has not opened sign-up', () => {});

Given('the admin turns on sign-up without a default role', async (world: SynoikiaWorld) => {
  await world.expectOk(world.admin.put('/api/settings/security', { localSignup: true }), 'turn on sign-up');
});

When('someone signs up as {string}', async (world: SynoikiaWorld, username: string) => {
  const browser = await newPortal(world);
  admin(world).seen.newcomer = browser;
  await keep(world, browser.post('/auth/register', { username, password: 'a newcomer passphrase' }));
});

Then('the sign-up is refused, because the server does not accept new accounts', (world: SynoikiaWorld) => {
  expect(identity(world).answer.status).toBe(403);
  expect(refusal(world)).toBe('registration_closed');
});

Then(
  '{string} is in the portal with the role {string}, and is refused in administration',
  async (world: SynoikiaWorld, username: string, role: string) => {
    expect(identity(world).answer.status).toBe(201);
    const browser = admin(world).seen.newcomer as Portal;
    expect(await (await browser.get('/api/session')).json()).toMatchObject({
      user: { username, role: { name: role } },
    });
    expect((await browser.get('/api/instances')).status).toBe(403);
  },
);

When('the admin tries to make {string} the default role for new users', async (world: SynoikiaWorld, role: string) => {
  await keep(world, world.admin.put('/api/settings/security', { defaultRoleId: role }));
});

Then('the sign-up is refused with {string}', (world: SynoikiaWorld, message: string) => {
  const { answer } = identity(world);
  expect(answer.status).toBe(400);
  expect(answer.body).toMatchObject({ error: 'registration_failed', message });
});

Then('the sign-up is refused, because the name breaks the user name rules', (world: SynoikiaWorld) => {
  expect(refusal(world)).toBe('invalid_username');
});

Given(
  'Acme ID people of the group {string} get accounts with {string}',
  async (world: SynoikiaWorld, group: string, role: string) => {
    await world.setUpAcmeId({ autoProvision: true, allowPolicy: { emails: [], subjects: [], group } });
    const defaultRoleId = await world.role(role);
    await world.expectOk(world.admin.put('/api/settings/security', { defaultRoleId }), 'set the default role');
  },
);

Given('the access gateway makes accounts with the role {string}', async (world: SynoikiaWorld, role: string) => {
  await world.tasksInstance('tasks');
  await world.accessGateway();
  const defaultRoleId = await world.role(role);
  await world.expectOk(world.admin.put('/api/settings/security', { defaultRoleId }), 'set the default role');
});

When(
  '{string} reaches {string} through the access gateway',
  async (world: SynoikiaWorld, email: string, slug: string) => {
    const assertion = await world.gatewayAssertion({ sub: `acme-${email}`, email });
    const res = await fetch(`${world.mcpBase}/${slug}`, {
      method: 'POST',
      headers: {
        'cf-access-jwt-assertion': assertion,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'gateway agent', version: '1' },
        },
      }),
    });
    await res.body?.cancel();
  },
);

Then(
  /^the audit log shows that "([^"]+)" made their own account through (sign-up|Acme ID|the access gateway)$/,
  async (world: SynoikiaWorld, username: string, source: string) => {
    const rows = (await auditRows(world, { decision: 'user_registered' })).filter(
      (r) => r.detail?.username === username,
    );
    expect(rows.map((r) => r.detail?.source)).toEqual([SOURCES[source]]);
    expect(await usersNamed(world, username)).toHaveLength(1);
  },
);

Given('the admin deleted the user {string}', async (world: SynoikiaWorld, username: string) => {
  const [id] = await usersNamed(world, username);
  if (!id) throw new Error(`no user "${username}"`);
  admin(world).formerIds.set(username, id);
  const res = await world.admin.del(`/api/users/${id}`);
  if (res.status !== 204) throw new Error(`delete user: ${res.status} ${await res.text()}`);
});

Then(
  '{string} is a new user, with a second registration in the audit log',
  async (world: SynoikiaWorld, username: string) => {
    const ids = await usersNamed(world, username);
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(admin(world).formerIds.get(username));
    const rows = (await auditRows(world, { decision: 'user_registered' })).filter(
      (r) => r.detail?.username === username,
    );
    expect(rows).toHaveLength(2);
  },
);
