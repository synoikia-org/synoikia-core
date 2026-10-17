import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';

Given(
  'the instance {string} has the list {string} with the open tasks {string}, {string} and {string}',
  async (world: SynoikiaWorld, slug: string, list: string, a: string, b: string, c: string) => {
    world.lists.set(
      list,
      [a, b, c].map((title) => ({ title, done: false })),
    );
    await world.tasksInstance(slug);
  },
);

Given('agent {int} belongs to the admin', async (world: SynoikiaWorld, agent: number) => {
  const created = await world.expectOk(
    world.admin.post('/api/me/tokens', { name: `agent ${agent}`, scope: ['*'] }),
    'create token',
  );
  world.agents.set(agent, { token: created.token as string });
});

Given(
  'the admin sets the group {string} of {string} to {word}',
  async (world: SynoikiaWorld, group: string, slug: string, level: string) => {
    await world.setGroupLevel(slug, group, level);
  },
);

Given(
  'the group {string} of {string} is at level {word}',
  async (world: SynoikiaWorld, group: string, slug: string, level: string) => {
    await world.setGroupLevel(slug, group, level);
  },
);

Given('agent {int} has an open session on {string}', async (world: SynoikiaWorld, agent: number, slug: string) => {
  await world.session(agent, slug);
});

When('the admin sets the group {string} to {word}', async (world: SynoikiaWorld, group: string, level: string) => {
  await world.setGroupLevel(world.lastInstance, group, level);
});

const openTasks = (list: string) =>
  `return (await tasks.call('lists.tasks', { list: ${JSON.stringify(list)} })).map((t) => t.title);`;

When('agent {int} asks for the open tasks of {string}', async (world: SynoikiaWorld, agent: number, list: string) => {
  await world.execute(agent, world.lastInstance, openTasks(list));
});

When(
  'agent {int} asks again for the open tasks of {string} in the same session',
  async (world: SynoikiaWorld, agent: number, list: string) => {
    expect(world.agents.get(agent)!.client).toBeDefined();
    await world.execute(agent, world.lastInstance, openTasks(list));
  },
);

Then(
  'agent {int} gets {string}, {string} and {string}',
  (world: SynoikiaWorld, _agent: number, a: string, b: string, c: string) => {
    expect(world.answer).toEqual({ result: [a, b, c] });
  },
);

Then('agent {int} is told that the admin turned the operation off, and gets no tasks', (world: SynoikiaWorld) => {
  expect(world.answer).toEqual({
    error: 'OPERATION_DISABLED',
    message: expect.stringMatching(/access level None/) as string,
  });
});
