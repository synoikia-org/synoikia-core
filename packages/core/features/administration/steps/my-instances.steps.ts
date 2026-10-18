import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { opKey } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';
import { identity, keep } from '../../identity/steps/identity.js';
import { admin, refusal, roleIdOf } from './administration.js';
import type { LevelView } from './administration.js';

const person = (user: number) => `user ${user}`;
const portalOf = (world: SynoikiaWorld, user: number) => world.person(person(user)).portal!;

type Mine = {
  assigned: { id: string; slug: string; status?: Record<string, unknown> }[];
  unassigned: Record<string, unknown>[];
};

const myView = async (world: SynoikiaWorld, who: string, slug: string) => {
  const id = await world.tasksInstance(slug);
  const res = await world.person(who).portal!.get(`/api/me/endpoints/${id}/access`);
  return { status: res.status, view: (await res.json()) as LevelView };
};

Given(
  'the role {string} lets its users see the status of {string}',
  async (world: SynoikiaWorld, role: string, slug: string) => {
    await world.setRoleSwitches(role, slug, { canSeeStatus: true });
  },
);

Given('the role {string} lets its users see other instances', async (world: SynoikiaWorld, role: string) => {
  await world.expectOk(
    world.admin.patch(`/api/roles/${await roleIdOf(world, role)}`, { canSeeOtherEndpoints: true }),
    'let the role see other instances',
  );
});

When(
  'the admin turns off own levels for {string} on {string}',
  async (world: SynoikiaWorld, role: string, slug: string) => {
    await world.setRoleSwitches(role, slug, { canSetOwnLevels: false });
  },
);

const lookAtInstances = async (world: SynoikiaWorld, who: string) => {
  admin(world).seen.mine = (await world.expectOk(
    world.person(who).portal!.get('/api/me/endpoints'),
    'list my instances',
  )) as unknown as Mine;
};

When('user {int} looks at their instances', async (world: SynoikiaWorld, user: number) => {
  await lookAtInstances(world, person(user));
});

When('the admin looks at their instances', async (world: SynoikiaWorld) => {
  await lookAtInstances(world, 'admin');
});

const mine = (world: SynoikiaWorld) => admin(world).seen.mine as Mine;

Then(
  'user {int} sees only {string}, with the reads they can call and no status, and {string} is not found',
  async (world: SynoikiaWorld, user: number, slug: string, other: string) => {
    expect(mine(world).assigned.map((e) => [e.slug, e.status])).toEqual([[slug, undefined]]);
    const { view } = await myView(world, person(user), slug);
    expect(view.operations.map((o) => o.key).sort()).toEqual(['lists.count', 'lists.share', 'lists.tasks']);
    expect((await myView(world, person(user), other)).status).toBe(404);
  },
);

Then(
  'user {int} sees the status of {string} and every operation, each one that is off with its reason',
  async (world: SynoikiaWorld, user: number, slug: string) => {
    expect(mine(world).assigned[0]).toMatchObject({ slug, status: { enabled: true, state: 'ready' } });
    const { view } = await myView(world, person(user), slug);
    expect(view.operations.map((o) => o.key)).toEqual((await world.operations(slug)).map((o) => o.key));
    for (const op of view.operations) {
      expect(op.reachable).toBe(false);
      expect(op.reason).toEqual(expect.any(String));
    }
  },
);

Then('user {int} is shown no other instances', (world: SynoikiaWorld) => {
  expect(mine(world).unassigned).toEqual([]);
});

Then('the admin is shown no other instances', async (world: SynoikiaWorld) => {
  expect(mine(world).assigned).toHaveLength(2);
  expect(mine(world).unassigned).toEqual([]);
  const shopping = await world.tasksInstance('shopping');
  expect((await world.admin.get(`/api/me/endpoints/${shopping}/about`)).status).toBe(404);
});

When(
  'user {int} sets their own level of the group {string} to {word} on {string} and on {string}',
  async (world: SynoikiaWorld, user: number, group: string, level: string, first: string, second: string) => {
    const statuses: number[] = [];
    for (const slug of [first, second]) {
      const id = await world.tasksInstance(slug);
      statuses.push((await portalOf(world, user).put(`/api/me/endpoints/${id}/groups/${group}`, { level })).status);
    }
    admin(world).seen.statuses = statuses;
  },
);

Then('it works on {string} and is refused on {string}', (world: SynoikiaWorld) => {
  expect(admin(world).seen.statuses).toEqual([200, 403]);
});

Then(
  'agent {word} gets the open tasks of {string} again, and the own level of user {int} counts again with the switch on',
  async (world: SynoikiaWorld, agent: string, list: string, _user: number) => {
    await world.call(agent, 'show the open tasks', { list });
    expect(world.answer).toMatchObject({ result: [{ title: 'milk' }, { title: 'bread' }, { title: 'eggs' }] });
    await world.setRoleSwitches('family', world.lastInstance, { canSetOwnLevels: true });
    await world.call(agent, 'show the open tasks', { list });
    expect(JSON.stringify(world.answer)).toMatch(/access level None/);
  },
);

When('user {int} looks at {string}', async (world: SynoikiaWorld, user: number, slug: string) => {
  const id = await world.tasksInstance(slug);
  await keep(world, portalOf(world, user).get(`/api/me/endpoints/${id}/about`));
});

Then(
  'user {int} sees the name, plugin and description of {string}, but no levels and no credential, and agent {word} is refused there',
  async (world: SynoikiaWorld, user: number, slug: string, agent: string) => {
    expect(identity(world).answer).toMatchObject({
      status: 200,
      body: {
        slug,
        plugin: 'Acme Tasks (World fixture)',
        description: 'Keeps the to-do lists of Acme Tasks.',
        role: 'family',
      },
    });
    const id = await world.tasksInstance(slug);
    expect((await myView(world, person(user), slug)).status).toBe(404);
    const token = await portalOf(world, user).post('/api/me/tokens', { name: 'for shopping', scope: [id] });
    expect(token.status).toBe(400);
    await world.execute(agent, slug, 'return 1;');
    expect(world.answer.refused).toMatch(/not available to your role/);
  },
);

When(
  'user {int} tries the own levels write, none and no own level for the group {string}',
  async (world: SynoikiaWorld, user: number, group: string) => {
    const id = await world.tasksInstance(world.lastInstance);
    const statuses: number[] = [];
    for (const level of ['write', 'none', null])
      statuses.push((await portalOf(world, user).put(`/api/me/endpoints/${id}/groups/${group}`, { level })).status);
    admin(world).seen.statuses = statuses;
  },
);

Then(
  'only write is refused, and {string} follows the role at {word}',
  async (world: SynoikiaWorld, name: string, level: string) => {
    expect(admin(world).seen.statuses).toEqual([400, 200, 200]);
    const { view } = await myView(world, 'user 12', world.lastInstance);
    expect(view.operations.find((o) => o.key === opKey(name))).toMatchObject({ level, ownLevel: null });
  },
);

Then(
  'user {int} still sees {string} at {word}',
  async (world: SynoikiaWorld, user: number, name: string, level: string) => {
    const { view } = await myView(world, person(user), world.lastInstance);
    expect(view.operations.find((o) => o.key === opKey(name))).toMatchObject({ level, ownLevel: level });
  },
);

type OwnRule = { id: string; editable: boolean; ownerUserId: string | null; owner: { username: string } | null };

Then(
  'user {int} can change only their own rule, and the admin sees user {int} as its owner',
  async (world: SynoikiaWorld, user: number) => {
    const id = await world.tasksInstance(world.lastInstance);
    const base = `/api/me/endpoints/${id}/rules`;
    const rules = (await (await portalOf(world, user).get(base)).json()) as OwnRule[];
    const own = rules.find((r) => r.editable)!;
    const adminRule = rules.find((r) => !r.editable)!;
    expect(rules).toHaveLength(2);
    expect((await portalOf(world, user).patch(`${base}/${own.id}`, { reason: 'my own adds' })).status).toBe(200);
    expect((await portalOf(world, user).patch(`${base}/${adminRule.id}`, { reason: 'mine now' })).status).toBe(404);
    expect((await portalOf(world, user).del(`${base}/${adminRule.id}`)).status).toBe(404);
    const all = (await world.expectOk(
      world.admin.get(`/api/instances/${id}/rules`),
      'list rules',
    )) as unknown as OwnRule[];
    expect(all.find((r) => r.id === own.id)?.owner).toMatchObject({ username: world.person(person(user)).username });
  },
);

When(
  'user {int} tries to pre-approve adding any task to {string}',
  async (world: SynoikiaWorld, user: number, list: string) => {
    await world.rule(
      world.lastInstance,
      'add a task',
      [
        { field: '/list', op: 'prefix', value: list },
        { field: '/title', op: 'any' },
      ],
      { owner: person(user), expect: 'refused' },
    );
  },
);

Then('user {int} is told that they can write rules only for what they can call', (world: SynoikiaWorld) => {
  expect(world.portalAnswer.body.error).toBe('operation_not_reachable');
});

When('user {int} asks the rule editor for lists to pick', async (world: SynoikiaWorld, user: number) => {
  const id = await world.tasksInstance(world.lastInstance);
  await keep(world, portalOf(world, user).get(`/api/me/endpoints/${id}/registry?kind=list`));
});

Then(
  'user {int} gets the list {string} to pick, with nothing else that Acme keeps on it',
  (world: SynoikiaWorld, _user: number, list: string) => {
    const { status, body } = identity(world).answer;
    expect(status).toBe(200);
    const entries = body as unknown as Record<string, unknown>[];
    expect(entries.map((e) => e.name)).toEqual([list]);
    for (const e of entries) expect(Object.keys(e).sort()).toEqual(['id', 'kind', 'name', 'parentId', 'scopes']);
  },
);

When(
  'user {int} asks the rule editor for saved views, for a source of options and for the lists of {string}',
  async (world: SynoikiaWorld, user: number, other: string) => {
    const id = await world.tasksInstance('tasks');
    const otherId = await world.tasksInstance(other);
    const answers: unknown[] = [];
    for (const path of [
      `/api/me/endpoints/${id}/registry?kind=view`,
      `/api/me/endpoints/${id}/options/lists`,
      `/api/me/endpoints/${otherId}/registry?kind=list`,
    ]) {
      const res = await portalOf(world, user).get(path);
      answers.push([res.status, ((await res.json()) as { error: string }).error]);
    }
    admin(world).seen.answers = answers;
  },
);

Then('user {int} is told each time that there is no such thing', (world: SynoikiaWorld) => {
  expect(admin(world).seen.answers).toEqual([
    [404, 'registry_not_found'],
    [404, 'options_not_found'],
    [404, 'instance_not_found'],
  ]);
});

Then('user {int} is told that their role does not allow it', (world: SynoikiaWorld) => {
  expect(refusal(world)).toBe('forbidden');
});
