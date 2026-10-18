import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { opKey } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

const anyTaskIn = (list: string) => [
  { field: '/list', op: 'prefix', value: list },
  { field: '/title', op: 'any' },
];

const lastRule = (world: SynoikiaWorld) => world.rules.at(-1)!;

const ruleOf = async (world: SynoikiaWorld) => {
  const rule = (await world.ruleList(world.lastInstance)).find((r) => r.id === lastRule(world));
  if (!rule) throw new Error('The rule is gone');
  return rule;
};

const addsOf = async (world: SynoikiaWorld, title: string) =>
  (
    (await world.audit({ kind: 'call', operation: opKey('add a task') })) as {
      decision: string;
      params?: Record<string, unknown> | null;
      detail: Record<string, unknown> | null;
    }[]
  ).filter((r) => r.params?.title === title);

Given('the admin pre-approves adding any task to {string}', async (world: SynoikiaWorld, list: string) => {
  await world.rule(world.lastInstance, 'add a task', anyTaskIn(list));
});

Given(
  'user {int} pre-approves adding any task to {string}',
  async (world: SynoikiaWorld, user: number, list: string) => {
    await world.rule(world.lastInstance, 'add a task', anyTaskIn(list), { owner: `user ${user}` });
  },
);

Given(
  'the admin pre-approves adding any task to {string} with any due date',
  async (world: SynoikiaWorld, list: string) => {
    await world.rule(world.lastInstance, 'add a task', [...anyTaskIn(list), { field: '/due', op: 'any' }]);
  },
);

Given('the admin pre-approves adding any task to {string} once an hour', async (world: SynoikiaWorld, list: string) => {
  await world.rule(world.lastInstance, 'add a task', anyTaskIn(list), {
    extra: { rateLimit: 1, windowSeconds: 3600 },
  });
});

Given(
  'the admin pre-approves adding any task to {string}, but the rule expired yesterday',
  async (world: SynoikiaWorld, list: string) => {
    const yesterday = new Date(Date.now() - 24 * 3_600_000).toISOString();
    await world.rule(world.lastInstance, 'add a task', anyTaskIn(list), { extra: { expiresAt: yesterday } });
  },
);

Given(
  'the admin pre-approves adding any task to {string}, but the rule is turned off',
  async (world: SynoikiaWorld, list: string) => {
    await world.rule(world.lastInstance, 'add a task', anyTaskIn(list), { extra: { enabled: false } });
  },
);

Given('the admin pre-approves showing the open tasks of {string}', async (world: SynoikiaWorld, list: string) => {
  await world.rule(world.lastInstance, 'show the open tasks', [{ field: '/list', op: 'eq', value: list }]);
});

Given('the admin pre-approves {string} with an empty rule', async (world: SynoikiaWorld, name: string) => {
  await world.rule(world.lastInstance, name, []);
});

Given('the admin pre-approves {string} with any parameter', async (world: SynoikiaWorld, name: string) => {
  await world.rule(world.lastInstance, name, [{ field: '', op: 'any' }]);
});

Given(
  'the admin pre-approves adding tasks to {string} with the tags {string} or {string}, a priority from {int} to {int} and a star',
  async (world: SynoikiaWorld, list: string, a: string, b: string, min: number, max: number) => {
    await world.rule(world.lastInstance, 'add a task', [
      ...anyTaskIn(list),
      { field: '/tags', op: 'in', value: [a, b] },
      { field: '/priority', op: 'range', value: { min, max } },
      { field: '/starred', op: 'bool', value: true },
    ]);
  },
);

Given('the admin pre-approves completing tasks in the list {string}', async (world: SynoikiaWorld, list: string) => {
  await world.rule(world.lastInstance, 'complete a task', [{ field: '$targets', scopes: { list: [list] } }]);
});

Given('Acme also has the lists {string} and {string}', (world: SynoikiaWorld, a: string, b: string) => {
  world.lists.set(a, []);
  world.lists.set(b, []);
});

Given(
  'the role {string} lets its users write their own rules on {string}',
  async (world: SynoikiaWorld, role: string, slug: string) => {
    await world.setRoleSwitches(role, slug, { canManageOwnRules: true });
  },
);

Given(
  'the admin turns off own rules for {string} on {string}',
  async (world: SynoikiaWorld, role: string, slug: string) => {
    await world.setRoleSwitches(role, slug, { canManageOwnRules: false });
  },
);

When(
  'agent {word} adds {string} to {string} due on {string}',
  async (world: SynoikiaWorld, agent: string, title: string, list: string, due: string) => {
    await world.call(agent, 'add a task', { list, title, due });
  },
);

When(
  'agent {word} adds {string} due on {string} and {string} with no due date to {string}',
  async (world: SynoikiaWorld, agent: string, first: string, due: string, second: string, list: string) => {
    await world.call(agent, 'add a task', { list, title: first, due });
    expect(world.answer).toMatchObject({ result: { title: first } });
    await world.call(agent, 'add a task', { list, title: second });
  },
);

When('agent {word} counts the open tasks of every list', async (world: SynoikiaWorld, agent: string) => {
  await world.call(agent, 'count the tasks', {});
});

When(
  'agent {word} adds {string} to {string} with the tags {string}, the priority {string} and the star {string}',
  async (
    world: SynoikiaWorld,
    agent: string,
    title: string,
    list: string,
    tags: string,
    priority: string,
    star: string,
  ) => {
    await world.call(agent, 'add a task', {
      list,
      title,
      tags: tags.split(', '),
      ...(priority === 'none' ? {} : { priority: /^\d+$/.test(priority) ? Number(priority) : priority }),
      starred: star === 'yes' ? true : star === 'no' ? false : star.replace(/^the word /, ''),
    });
  },
);

When(
  'agent {word} completes {string} in {string} and {string}',
  async (world: SynoikiaWorld, agent: string, title: string, a: string, b: string) => {
    await world.call(agent, 'complete a task', { list: [a, b], title });
  },
);

When('the admin tries to pre-approve completing tasks with no list and no task', async (world: SynoikiaWorld) => {
  await world.rule(world.lastInstance, 'complete a task', [{ field: '$targets' }], { expect: 'refused' });
});

When(
  'the admin tries to pre-approve completing tasks in the folder {string}',
  async (world: SynoikiaWorld, folder: string) => {
    await world.rule(world.lastInstance, 'complete a task', [{ field: '$targets', scopes: { folder: [folder] } }], {
      expect: 'refused',
    });
  },
);

When('the admin tries to pre-approve deleting the list {string}', async (world: SynoikiaWorld, list: string) => {
  await world.rule(world.lastInstance, 'delete a list', [{ field: '/list', op: 'eq', value: list }], {
    expect: 'refused',
  });
});

Then('the audit log shows that the rule approved the add of {string}', async (world: SynoikiaWorld, title: string) => {
  expect((await addsOf(world, title)).map((r) => r.decision)).toEqual([`auto-approved:rule:${lastRule(world)}`]);
});

Then(
  'the audit log shows that the add of {string} passed the rule because it reached its limit',
  async (world: SynoikiaWorld, title: string) => {
    const [row] = (await addsOf(world, title)).filter((r) => r.decision === 'awaiting_approval');
    expect(row?.detail).toMatchObject({ rateLimitedRules: [lastRule(world)] });
  },
);

Then(
  'the admin sees that the rule missed a call because of a parameter it does not name',
  async (world: SynoikiaWorld) => {
    expect((await ruleOf(world)).strictMissAt).toEqual(expect.any(String));
  },
);

Then('agent {word} is told that {int} tasks are open', (world: SynoikiaWorld, _agent: string, open: number) => {
  expect(world.answer).toEqual({ result: { open } });
});

Then(
  'agent {word} gets the new task {string} without a question',
  (world: SynoikiaWorld, _agent: string, title: string) => {
    expect(world.answer).toEqual({ result: { title, done: false } });
  },
);

Then('agent {word} gets the task done without a question', (world: SynoikiaWorld) => {
  expect(world.answer).toEqual({ result: { completed: [expect.any(String)] } });
});

Then('the admin is told to select at least one task or list', (world: SynoikiaWorld) => {
  expect(JSON.stringify(world.portalAnswer.body)).toContain('select at least one target id or scope value');
});

Then(
  'the admin is told that {string} cannot select tasks by {string}',
  (world: SynoikiaWorld, name: string, scope: string) => {
    expect(world.portalAnswer.body).toMatchObject({ message: `${opKey(name)} can't select targets by "${scope}"` });
  },
);

Then(
  'the admin is told that {string} is locked and can never be pre-approved',
  (world: SynoikiaWorld, name: string) => {
    expect(world.portalAnswer.body).toMatchObject({
      message: `${opKey(name)} is locked and can never be pre-approved`,
    });
  },
);

Then(
  'the admin sees that the rule is inert, because the level is {word}',
  async (world: SynoikiaWorld, level: string) => {
    expect((await ruleOf(world)).inert).toBe(`level_${level}`);
  },
);

Then('the admin sees that the rule is live', async (world: SynoikiaWorld) => {
  expect((await ruleOf(world)).inert).toBeNull();
});
