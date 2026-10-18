import { Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { eventually, opKey } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';
import { keep } from '../../identity/steps/identity.js';
import { admin, auditRows, refusal, sessionGrants } from './administration.js';

const person = (user: number) => `user ${user}`;

When('the admin tries to delete themselves', async (world: SynoikiaWorld) => {
  await keep(world, world.admin.del(`/api/users/${world.person('admin').id}`));
});

Then('the admin is told that they cannot delete themselves', (world: SynoikiaWorld) => {
  expect(refusal(world)).toBe('self_delete');
});

When('the admin tries to delete a user who does not exist', async (world: SynoikiaWorld) => {
  await keep(world, world.admin.del('/api/users/nobody'));
});

Then('the admin is told that there is no such user', (world: SynoikiaWorld) => {
  expect(refusal(world)).toBe('user_not_found');
});

Then(
  'agent {word} is refused, because its credential was revoked when user {int} was deleted, and the add of {string} was denied',
  async (world: SynoikiaWorld, agent: string, _user: number, title: string) => {
    await world.call(agent, 'show the open tasks', { list: 'Groceries' });
    expect(world.answer.refused).toMatch(/Invalid or expired token/);
    const adds = (await auditRows(world, { kind: 'call', operation: opKey('add a task') })).filter((r) =>
      JSON.stringify(r).includes(title),
    );
    expect(adds.map((r) => r.decision)).toEqual(['denied', 'awaiting_approval']);
    const revoked = await auditRows(world, { decision: 'mcp_tokens_revoked' });
    expect(revoked).toEqual([
      expect.objectContaining({
        detail: expect.objectContaining({ reason: 'user_deleted', tokens: [`agent ${agent}`] }),
      }),
    ]);
  },
);

Then(
  'the audit log shows that the add of {string} was cancelled because user {int} was deleted',
  async (world: SynoikiaWorld, title: string) => {
    const denied = async () =>
      (await auditRows(world, { kind: 'call', operation: opKey('add a task'), decision: 'denied' })).filter((r) =>
        JSON.stringify(r).includes(title),
      );
    await eventually(async () => (await denied()).length > 0, 'the audit of the add');
    expect((await denied()).map((r) => r.detail)).toEqual([expect.objectContaining({ reason: 'user_deleted' })]);
  },
);

When(
  'user {int} pre-approves adding any task to {string} for every user',
  async (world: SynoikiaWorld, user: number, list: string) => {
    const id = await world.tasksInstance(world.lastInstance);
    const op = await world.operation(world.lastInstance, 'add a task');
    await world.expectOk(
      world.person(person(user)).portal!.post(`/api/instances/${id}/rules`, {
        operationId: op.id,
        match: [
          { field: '/list', op: 'prefix', value: list },
          { field: '/title', op: 'any' },
        ],
        reason: `adds to ${list}`,
      }),
      'save rule',
    );
  },
);

const rulesOf = async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  return (await world.expectOk(world.admin.get(`/api/instances/${id}/rules`), 'list rules')) as unknown as {
    reason: string;
    createdBy: string | null;
    owner: unknown;
  }[];
};

Then('the admin sees no rule on {string}', async (world: SynoikiaWorld, slug: string) => {
  expect(await rulesOf(world, slug)).toEqual([]);
});

Then(
  'the admin sees the rule for adding tasks to {string}, with no author',
  async (world: SynoikiaWorld, list: string) => {
    const rules = await rulesOf(world, world.lastInstance);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ reason: `adds to ${list}`, createdBy: null, owner: null });
  },
);

Then(
  'the new user {int} has no session grant on {string}, and the audit log keeps the two users {int} apart',
  async (world: SynoikiaWorld, user: number, slug: string) => {
    expect(await sessionGrants(world, slug)).toEqual([]);
    const { id, username } = world.person(person(user));
    const former = admin(world).formerIds.get(person(user))!;
    const rows = await auditRows(world, { actor: username });
    const flags = (actorId: string) => [
      ...new Set(rows.filter((r) => r.actorId === actorId).map((r) => r.actorDeleted)),
    ];
    expect(flags(former)).toEqual([true]);
    expect(flags(id)).toEqual([false]);
  },
);

Then('the audit log shows that the admin deleted user {int}', async (world: SynoikiaWorld, user: number) => {
  const rows = await auditRows(world, { decision: 'user_deleted' });
  expect(rows).toEqual([
    expect.objectContaining({
      actorName: 'admin',
      detail: expect.objectContaining({ username: world.person(person(user)).username }) as unknown,
    }),
  ]);
});

Then(
  'the earlier events of user {int} show the name {string}, marked as deleted',
  async (world: SynoikiaWorld, user: number, name: string) => {
    const rows = (await auditRows(world, {})).filter((r) => r.actorId === world.person(person(user)).id);
    expect(rows.map((r) => r.decision).sort()).toEqual(['login', 'mcp_token_created']);
    for (const r of rows) expect(r).toMatchObject({ actorName: name, actorDeleted: true });
  },
);

When('the admin filters the audit log by {string} and exports it', async (world: SynoikiaWorld, actor: string) => {
  const s = admin(world);
  s.found = await auditRows(world, { actor });
  s.csv = await (await world.admin.get(`/api/audit/export.csv?actor=${encodeURIComponent(actor)}`)).text();
});

Then(
  'both times the admin finds the sign-in and the new credential of {string}',
  (world: SynoikiaWorld, name: string) => {
    const { found, csv } = admin(world);
    expect(found.map((r) => [r.decision, r.actorName]).sort()).toEqual([
      ['login', name],
      ['mcp_token_created', name],
    ]);
    const lines = csv.trimEnd().split('\n').slice(1);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toContain(`,${name},true,`);
  },
);
