import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { enroll, identity, keep, passwordStep } from '../../identity/steps/identity.js';
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

Given('the admin gave user {int} the Admin role', async (world: SynoikiaWorld, user: number) => {
  await world.expectOk(
    world.admin.patch(`/api/users/${world.person(person(user)).id}`, { roleId: 'admin' }),
    'give the Admin role',
  );
});

When('user {int} moves themselves to the role {string}', async (world: SynoikiaWorld, user: number, role: string) => {
  const me = world.person(person(user));
  await world.expectOk(me.portal!.patch(`/api/users/${me.id}`, { roleId: await world.role(role) }), 'change own role');
});

Then(
  'the next administration request of user {int} is refused, and the admin can still administer core',
  async (world: SynoikiaWorld, user: number) => {
    expect((await world.person(person(user)).portal!.get('/api/instances')).status).toBe(403);
    expect((await world.admin.get('/api/instances')).status).toBe(200);
  },
);

// @id:users, the primary owner (ADR-0025): "the admin" is the World's first account.
const asUser = (world: SynoikiaWorld, user: number) => world.person(person(user)).portal!;
const ownerPath = (world: SynoikiaWorld) => `/api/users/${world.person('admin').id}`;

Then('the admin is told that the primary owner keeps the Admin role', (world: SynoikiaWorld) => {
  expect(refusal(world)).toBe('owner_admin');
});

When('user {int} tries to disable the admin', async (world: SynoikiaWorld, user: number) => {
  await keep(world, asUser(world, user).patch(ownerPath(world), { disabled: true }));
});

Then('user {int} is told that the primary owner cannot be disabled', (world: SynoikiaWorld, _user: number) => {
  expect(refusal(world)).toBe('owner_disable');
});

Then('the admin still signs in to the portal', async (world: SynoikiaWorld) => {
  await passwordStep(world, 'admin');
  expect(identity(world).answer.body).toMatchObject({ status: 'ok' });
});

When(
  'user {int} tries to move the admin to the role {string}',
  async (world: SynoikiaWorld, user: number, role: string) => {
    await keep(world, asUser(world, user).patch(ownerPath(world), { roleId: await world.role(role) }));
  },
);

Then('user {int} is told that the primary owner keeps the Admin role', (world: SynoikiaWorld, _user: number) => {
  expect(refusal(world)).toBe('owner_admin');
});

Then('the admin can still administer core', async (world: SynoikiaWorld) => {
  expect((await world.admin.get('/api/instances')).status).toBe(200);
});

When(
  'user {int} tries to set the password {string} for the admin',
  async (world: SynoikiaWorld, user: number, password: string) => {
    await keep(world, asUser(world, user).patch(ownerPath(world), { password }));
  },
);

Then(
  "user {int} is told that only the start-up admin sets the primary owner's password",
  (world: SynoikiaWorld, _user: number) => {
    expect(refusal(world)).toBe('owner_password');
  },
);

Then(
  'the admin signs in with their old password, and not with {string}',
  async (world: SynoikiaWorld, password: string) => {
    await passwordStep(world, 'admin', password, 'admin with the new password');
    expect(identity(world).answer.status).toBe(401);
    await passwordStep(world, 'admin');
    expect(identity(world).answer.body).toMatchObject({ status: 'ok' });
  },
);

Given(
  'the admin set up an authenticator app, and gave user {int} the Admin role',
  async (world: SynoikiaWorld, user: number) => {
    await enroll(world, 'admin');
    await world.expectOk(
      world.admin.patch(`/api/users/${world.person(person(user)).id}`, { roleId: 'admin' }),
      'give the Admin role',
    );
  },
);

When('user {int} tries to reset two-factor for the admin', async (world: SynoikiaWorld, user: number) => {
  await keep(world, asUser(world, user).post(`${ownerPath(world)}/reset-totp`));
});

Then(
  "user {int} is told that only the start-up admin resets the primary owner's two-factor sign-in",
  (world: SynoikiaWorld, _user: number) => {
    expect(refusal(world)).toBe('owner_totp');
  },
);

Then('the admin still needs a code from the app to sign in', async (world: SynoikiaWorld) => {
  await passwordStep(world, 'admin');
  expect(identity(world).answer.body).toEqual({ status: 'totp_required' });
});

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
