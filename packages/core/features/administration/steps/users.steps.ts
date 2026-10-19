import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { identity, keep, passwordStep } from '../../identity/steps/identity.js';
import { admin, refusal, sessionGrants } from './administration.js';

const person = (user: number) => `user ${user}`;

When('the admin adds user {int} with the role {string}', async (world: SynoikiaWorld, user: number, role: string) => {
  const before = world.people.get(person(user));
  if (before) {
    admin(world).formerIds.set(person(user), before.id);
    world.people.delete(person(user));
  }
  await world.user(person(user), role);
});

Then(
  'user {int} can sign in to the portal with the role {string}',
  async (world: SynoikiaWorld, user: number, role: string) => {
    const browser = await passwordStep(world, person(user));
    expect(identity(world).answer.body).toMatchObject({ status: 'ok' });
    expect(await (await browser.get('/api/session')).json()).toMatchObject({ user: { role: { name: role } } });
  },
);

When(
  'the admin tries to add the user {string} with the role {string}',
  async (world: SynoikiaWorld, username: string, role: string) => {
    const roleId = world.roles.get(role) ?? role;
    await keep(world, world.admin.post('/api/users', { username, password: 'a long enough passphrase', roleId }));
  },
);

Then('the admin is told that the name is taken', (world: SynoikiaWorld) => {
  expect(refusal(world)).toBe('username_taken');
});

Then('the admin is told that the name breaks the user name rules', (world: SynoikiaWorld) => {
  expect(refusal(world)).toBe('invalid_username');
});

Then('the admin is told that there is no such role', (world: SynoikiaWorld) => {
  expect(['unknown_role', 'role_not_found']).toContain(refusal(world));
});

When('the admin tries to disable themselves', async (world: SynoikiaWorld) => {
  await keep(world, world.admin.patch(`/api/users/${world.person('admin').id}`, { disabled: true }));
});

Then('the admin is told that they cannot disable themselves', (world: SynoikiaWorld) => {
  expect(refusal(world)).toBe('self_disable');
});

When('the admin tries to move themselves to the role {string}', async (world: SynoikiaWorld, role: string) => {
  await keep(world, world.admin.patch(`/api/users/${world.person('admin').id}`, { roleId: await world.role(role) }));
});

Then('the admin is told that the last enabled admin keeps the Admin role', (world: SynoikiaWorld) => {
  expect(refusal(world)).toBe('last_admin');
});

Given('the admin gave user {int} the Admin role', async (world: SynoikiaWorld, user: number) => {
  await world.expectOk(
    world.admin.patch(`/api/users/${world.person(person(user)).id}`, { roleId: 'admin' }),
    'give the Admin role',
  );
});

When('the admin moves themselves to the role {string}', async (world: SynoikiaWorld, role: string) => {
  await world.expectOk(
    world.admin.patch(`/api/users/${world.person('admin').id}`, { roleId: await world.role(role) }),
    'change own role',
  );
});

Then(
  'the next administration request of the admin is refused, and user {int} can still administer core',
  async (world: SynoikiaWorld, user: number) => {
    expect((await world.admin.get('/api/instances')).status).toBe(403);
    expect((await world.person(person(user)).portal!.get('/api/instances')).status).toBe(200);
  },
);

Given(
  'user {int} let agent {word} in through the app {string}',
  async (world: SynoikiaWorld, user: number, agent: string, _app: string) => {
    await world.oauthAgent(agent, person(user), world.lastInstance);
  },
);

When('the admin enables user {int} again', async (world: SynoikiaWorld, user: number) => {
  await world.expectOk(
    world.admin.patch(`/api/users/${world.person(person(user)).id}`, { disabled: false }),
    'enable user',
  );
});

const refusedAgent = async (world: SynoikiaWorld, agent: string) => {
  await world.call(agent, 'show the open tasks', { list: 'Groceries' });
  expect(world.answer.refused).toMatch(/Invalid or expired token/);
};

Then(
  'agents {word} and {word} are refused, and the admin sees no session grant on {string}',
  async (world: SynoikiaWorld, first: string, second: string, slug: string) => {
    await refusedAgent(world, first);
    await refusedAgent(world, second);
    expect(await sessionGrants(world, slug)).toEqual([]);
  },
);

Then(
  'agent {word} is still refused, and agent {word} cannot renew its sign-in',
  async (world: SynoikiaWorld, agent: string, oauthAgent: string) => {
    await refusedAgent(world, agent);
    await refusedAgent(world, oauthAgent);
    expect(await world.renewOAuth(oauthAgent)).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
  },
);
