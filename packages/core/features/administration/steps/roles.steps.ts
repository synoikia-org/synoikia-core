import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { opKey } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';
import { identity, keep } from '../../identity/steps/identity.js';
import { admin, auditRows, levelsOf, refusal, roleIdOf } from './administration.js';

type RoleRow = { id: string; name: string; endpoints: Record<string, unknown>[] };

const roleList = async (world: SynoikiaWorld) =>
  (await world.expectOk(world.admin.get('/api/roles'), 'list roles')) as unknown as RoleRow[];

/** Keeps each answer of `requests`, for a Then that checks them all. */
const keepAll = async (world: SynoikiaWorld, requests: Promise<Response>[]) => {
  const answers: { status: number; body: Record<string, unknown> }[] = [];
  for (const r of requests) {
    const res = await r;
    answers.push({ status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> });
  }
  admin(world).seen.answers = answers;
};
const keptAll = (world: SynoikiaWorld) =>
  admin(world).seen.answers as { status: number; body: Record<string, unknown> }[];

// ── the Admin role ──

When('the admin tries to rename the Admin role and to delete it', async (world: SynoikiaWorld) => {
  await keepAll(world, [world.admin.patch('/api/roles/admin', { name: 'Root' }), world.admin.del('/api/roles/admin')]);
});

When(
  'the admin tries to change a switch and the maximum of the group {string} of the Admin role on {string}',
  async (world: SynoikiaWorld, group: string, slug: string) => {
    const id = await world.tasksInstance(slug);
    await keepAll(world, [
      world.admin.patch(`/api/roles/admin/endpoints/${id}`, { canSeeStatus: false }),
      world.admin.put(`/api/roles/admin/endpoints/${id}/groups/${group}`, { level: 'read' }),
    ]);
  },
);

Then('both changes are refused, because the Admin role is fixed', async (world: SynoikiaWorld) => {
  expect(keptAll(world).map((a) => a.body.error)).toEqual(['built_in_role', 'built_in_role']);
  expect((await roleList(world)).find((r) => r.id === 'admin')).toMatchObject({ name: 'Admin' });
});

// ── names ──

When('the admin tries to add the role {string}', async (world: SynoikiaWorld, name: string) => {
  await keep(world, world.admin.post('/api/roles', { name }));
});

Then('the admin is told that a role with that name exists', (world: SynoikiaWorld) => {
  expect(refusal(world)).toBe('role_name_taken');
});

When('the admin renames the role {string} to {string}', async (world: SynoikiaWorld, from: string, to: string) => {
  await world.expectOk(world.admin.patch(`/api/roles/${await roleIdOf(world, from)}`, { name: to }), 'rename role');
});

Then('user {int} has the role {string} in the portal', async (world: SynoikiaWorld, user: number, name: string) => {
  const portal = world.person(`user ${user}`).portal!;
  expect(await (await portal.get('/api/session')).json()).toMatchObject({ user: { role: { name } } });
});

// ── deletes ──

When('the admin tries to delete the role {string}', async (world: SynoikiaWorld, name: string) => {
  await keep(world, world.admin.del(`/api/roles/${await roleIdOf(world, name)}`));
});

Then('the admin is told that {int} user has the role', (world: SynoikiaWorld, n: number) => {
  expect(refusal(world)).toBe('role_in_use');
  expect(identity(world).answer.body.message).toContain(`${n} user(s)`);
});

Then('the admin is told that {string} is the default role for new users', (world: SynoikiaWorld) => {
  expect(refusal(world)).toBe('default_role');
});

When('the admin deletes the role {string}', async (world: SynoikiaWorld, name: string) => {
  const res = await world.admin.del(`/api/roles/${await roleIdOf(world, name)}`);
  expect(res.status).toBe(204);
});

Then('the admin sees only the roles {string} and {string}', async (world: SynoikiaWorld, a: string, b: string) => {
  expect((await roleList(world)).map((r) => r.name)).toEqual([a, b]);
});

// ── switches ──

When(
  'the admin turns on own rules for {string} on {string}',
  async (world: SynoikiaWorld, role: string, slug: string) => {
    await world.setRoleSwitches(role, slug, { canManageOwnRules: true });
  },
);

const switchesOf = async (world: SynoikiaWorld, role: string, slug: string) => {
  const id = await world.tasksInstance(slug);
  const row = (await roleList(world)).find((r) => r.name === role)!;
  return row.endpoints.find((e) => e.instanceId === id);
};

Then(
  '{string} may set its own levels and write its own rules on {string}, but not see its status',
  async (world: SynoikiaWorld, role: string, slug: string) => {
    expect(await switchesOf(world, role, slug)).toMatchObject({
      canSetOwnLevels: true,
      canManageOwnRules: true,
      canSeeStatus: false,
    });
  },
);

Then(
  'the audit log shows the switch change of {string} on {string}',
  async (world: SynoikiaWorld, _role: string, slug: string) => {
    const rows = await auditRows(world, {
      decision: 'role_endpoint_changed',
      instance: await world.tasksInstance(slug),
    });
    expect(rows[0]!.detail).toMatchObject({
      before: { canSetOwnLevels: true, canManageOwnRules: false },
      changes: { canManageOwnRules: true },
    });
  },
);

When(
  'the admin sends an empty switch change and then the switch value {string} for {string} on {string}',
  async (world: SynoikiaWorld, value: string, role: string, slug: string) => {
    const path = `/api/roles/${await world.role(role)}/endpoints/${await world.tasksInstance(slug)}`;
    await keepAll(world, [world.admin.patch(path, {}), world.admin.patch(path, { canSeeStatus: value })]);
  },
);

Then('both changes are refused as not valid', (world: SynoikiaWorld) => {
  expect(keptAll(world).map((a) => [a.status, a.body.error])).toEqual([
    [400, 'invalid_request'],
    [400, 'invalid_request'],
  ]);
});

Given('Acme Tasks also runs as the instance {string}', async (world: SynoikiaWorld, slug: string) => {
  const last = world.lastInstance;
  await world.tasksInstance(slug);
  if (last) world.lastInstance = last;
});

When(
  'the admin tries to let {string} see the status of {string}',
  async (world: SynoikiaWorld, role: string, slug: string) => {
    const path = `/api/roles/${await world.role(role)}/endpoints/${await world.tasksInstance(slug)}`;
    await keep(world, world.admin.patch(path, { canSeeStatus: true }));
  },
);

Then('the admin is told to add {string} to the role first', (world: SynoikiaWorld) => {
  expect(refusal(world)).toBe('not_in_role');
});

When(
  'the admin gives {string} the instance {string} as well',
  async (world: SynoikiaWorld, role: string, slug: string) => {
    const row = (await roleList(world)).find((r) => r.name === role)!;
    const ids = row.endpoints.map((e) => e.instanceId as string);
    const id = await world.tasksInstance(slug);
    await world.expectOk(
      world.admin.put(`/api/roles/${row.id}/instances`, { instanceIds: [...ids, id] }),
      'add an instance to the role',
    );
  },
);

When(
  'the admin gives {string} the instance {string} again',
  async (world: SynoikiaWorld, role: string, slug: string) => {
    await world.setRoleInstances(role, [slug]);
  },
);

Then(
  '{string} has every switch off on {string}, and keeps its switches on {string}',
  async (world: SynoikiaWorld, role: string, added: string, kept: string) => {
    expect(await switchesOf(world, role, added)).toMatchObject({
      canSetOwnLevels: false,
      canManageOwnRules: false,
      canSeeStatus: false,
    });
    expect(await switchesOf(world, role, kept)).toMatchObject({ canSetOwnLevels: true });
  },
);

// ── maximums ──

Then(
  'the admin sees that {string} gets {word} for {string} and {word} for {string}',
  async (world: SynoikiaWorld, role: string, first: string, op1: string, second: string, op2: string) => {
    const view = await levelsOf(world, role, world.lastInstance);
    const level = (name: string) => view.operations.find((o) => o.key === opKey(name))?.level;
    expect([level(op1), level(op2)]).toEqual([first, second]);
  },
);

When(
  'the admin tries to set the maximum of {string} for {string} to {word}',
  async (world: SynoikiaWorld, role: string, name: string, level: string) => {
    const id = await world.tasksInstance(world.lastInstance);
    const op = await world.operation(world.lastInstance, name);
    await keep(
      world,
      world.admin.put(`/api/roles/${await world.role(role)}/endpoints/${id}/operations/${op.id}`, { level }),
    );
  },
);

Then('the admin is told that {string} cannot take that level', (world: SynoikiaWorld) => {
  expect(refusal(world)).toBe('level_not_allowed');
});

When(
  'the admin tries to set the maximum of {string} for the group {string} of {string} to {word}',
  async (world: SynoikiaWorld, role: string, group: string, slug: string, level: string) => {
    const id = await world.tasksInstance(slug);
    await keep(
      world,
      world.admin.put(`/api/roles/${await world.role(role)}/endpoints/${id}/groups/${group}`, { level }),
    );
  },
);

Then('{string} reaches nothing on {string}', async (world: SynoikiaWorld, role: string, slug: string) => {
  const view = await levelsOf(world, role, slug);
  expect(view.operations.length).toBeGreaterThan(5);
  for (const op of view.operations) expect(op).toMatchObject({ roleMax: 'none', reachable: false });
});

Then(
  '{string} has the maximum none for the new group {string}',
  async (world: SynoikiaWorld, role: string, group: string) => {
    const view = await levelsOf(world, role, world.lastInstance);
    const views = view.operations.filter((o) => o.group === group);
    expect(views).toHaveLength(2);
    for (const op of views) expect(op).toMatchObject({ roleMax: 'none', reachable: false });
    expect(view.operations.find((o) => o.key === opKey('show the open tasks'))).toMatchObject({ reachable: true });
  },
);

// ── only admins ──

/** Requests that only an admin may make, one for each part of administration. */
const ADMIN_ONLY: [string, string][] = [
  ['GET', '/api/overview'],
  ['GET', '/api/instances'],
  ['POST', '/api/instances'],
  ['GET', '/api/instances/x'],
  ['PATCH', '/api/instances/x'],
  ['DELETE', '/api/instances/x'],
  ['GET', '/api/instances/x/connection'],
  ['POST', '/api/instances/x/connection/test'],
  ['POST', '/api/instances/x/sync'],
  ['GET', '/api/instances/x/operations'],
  ['PATCH', '/api/instances/x/groups/x'],
  ['GET', '/api/instances/x/rules'],
  ['POST', '/api/instances/x/rules'],
  ['GET', '/api/instances/x/session-grants'],
  ['GET', '/api/roles'],
  ['POST', '/api/roles'],
  ['PATCH', '/api/roles/x'],
  ['DELETE', '/api/roles/x'],
  ['PUT', '/api/roles/x/instances'],
  ['PATCH', '/api/roles/x/endpoints/x'],
  ['PUT', '/api/roles/x/endpoints/x/groups/x'],
  ['GET', '/api/plugins'],
  ['POST', '/api/plugins/rescan'],
  ['POST', '/api/plugins/install'],
  ['GET', '/api/plugin-repos'],
  ['GET', '/api/notifiers'],
  ['POST', '/api/notifiers'],
  ['GET', '/api/audit'],
  ['GET', '/api/audit/export.csv'],
  ['GET', '/api/tokens'],
  ['POST', '/api/tokens'],
  ['GET', '/api/oauth/clients'],
  ['GET', '/api/oauth/grants'],
  ['GET', '/api/users'],
  ['POST', '/api/users'],
  ['PATCH', '/api/users/x'],
  ['DELETE', '/api/users/x'],
  ['POST', '/api/users/x/reset-totp'],
  ['GET', '/api/settings'],
  ['PUT', '/api/settings/security'],
  ['PUT', '/api/settings/oidc'],
  ['GET', '/api/settings/mcp/clients-seen'],
  ['GET', '/api/events'],
];

When('user {int} tries each part of administration', async (world: SynoikiaWorld, user: number) => {
  const portal = world.person(`user ${user}`).portal!;
  const answers: string[] = [];
  for (const [method, path] of ADMIN_ONLY) {
    const res = await portal.req(method, path, method === 'GET' ? undefined : {});
    answers.push(`${method} ${path} ${res.status}`);
    await res.body?.cancel();
  }
  admin(world).seen.adminOnly = answers;
});

Then(
  'user {int} is refused each time, while their profile and their own instances work',
  async (world: SynoikiaWorld, user: number) => {
    expect(admin(world).seen.adminOnly).toEqual(ADMIN_ONLY.map(([m, p]) => `${m} ${p} 403`));
    const portal = world.person(`user ${user}`).portal!;
    expect((await portal.get('/api/profile')).status).toBe(200);
    expect((await portal.get('/api/me/endpoints')).status).toBe(200);
  },
);
