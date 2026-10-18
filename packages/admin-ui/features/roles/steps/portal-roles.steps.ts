import type { Locator } from 'playwright';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { PortalWorld } from '../../support/world.js';

const seen = (locator: Locator) => locator.waitFor({ state: 'visible', timeout: 10_000 });
const LEVELS: Record<string, string> = { none: 'None', read: 'Read', ask: 'Ask', write: 'Write' };

const card = (world: PortalWorld, role: string) => world.page.locator(`[data-role="${role}"]`);
const onInstance = (world: PortalWorld, role: string, slug: string) =>
  card(world, role).locator(`[data-endpoint="${slug}"]`);
const switches = (world: PortalWorld, role: string, slug: string) =>
  world.page.getByRole('group', { name: `${role}: switches on /${slug}` });

interface Role {
  id: string;
  name: string;
  users: number;
  endpoints: { instanceId: string; canSetOwnLevels: boolean }[];
}

export async function roleRows(world: PortalWorld) {
  return (await world.expectOk((await world.adminApi()).get('/api/roles'), 'roles')) as unknown as Role[];
}

async function roleRow(world: PortalWorld, name: string) {
  return (await roleRows(world)).find((r) => r.name === name);
}

export async function rolesPage(world: PortalWorld) {
  await world.openAsAdmin('/settings/roles');
  await seen(world.page.getByRole('textbox', { name: 'New role name' }));
  await seen(card(world, 'Admin'));
}

async function roleLevels(world: PortalWorld, role: string, slug: string) {
  const id = await world.tasksInstance(slug);
  return (await world.expectOk(
    (await world.adminApi()).get(`/api/roles/${await world.role(role)}/endpoints/${id}/access`),
    'role levels',
  )) as unknown as { groups: { key: string; roleLevel: string | null }[] };
}

// ── setup ──

Given('the role {string}', async (world: PortalWorld, name: string) => {
  await world.role(name);
});

Given('the role {string} and the instance {instance}', async (world: PortalWorld, name: string, slug: string) => {
  await world.role(name);
  await world.tasksInstance(slug);
});

Given('the role {string} has the instance {instance}', async (world: PortalWorld, name: string, slug: string) => {
  await world.roleInstances(name, [slug]);
});

// ── instances and switches ──

When(
  'the admin adds {instance} to {string} and turns on {string} on the roles page',
  async (world: PortalWorld, slug: string, role: string, label: string) => {
    await rolesPage(world);
    await onInstance(world, role, slug)
      .getByRole('checkbox', { name: `/${slug}` })
      .check();
    const box = switches(world, role, slug).getByRole('checkbox', { name: label });
    await box.check();
    await expect.poll(() => box.isChecked()).toBe(true);
  },
);

Then(
  '{string} has {instance} with personal levels, and the portal asked nothing',
  async (world: PortalWorld, role: string, slug: string) => {
    const id = await world.tasksInstance(slug);
    await expect
      .poll(async () => (await roleRow(world, role))?.endpoints.find((e) => e.instanceId === id)?.canSetOwnLevels)
      .toBe(true);
    expect(await world.page.getByRole('dialog').count()).toBe(0);
  },
);

When(
  /^the admin removes \/([a-z0-9-]+) from "([^"]+)" on the roles page and (confirms|cancels) the question$/,
  async (world: PortalWorld, slug: string, role: string, answer: string) => {
    await rolesPage(world);
    await onInstance(world, role, slug)
      .getByRole('checkbox', { name: `/${slug}` })
      .uncheck();
    await world.answerQuestion(answer === 'confirms' ? 'Remove' : 'Cancel');
  },
);

Then(
  'the question said that {string} loses its maximum levels, personal levels and own rules on {instance}',
  (world: PortalWorld, role: string, slug: string) => {
    for (const part of [role, `/${slug}`, 'maximum levels', 'personal levels', 'own rules'])
      expect(world.question.text).toContain(part);
  },
);

Then('{string} no longer has {instance}', async (world: PortalWorld, role: string, slug: string) => {
  await expect.poll(async () => (await roleRow(world, role))?.endpoints.length).toBe(0);
  await expect.poll(() => switches(world, role, slug).count()).toBe(0);
});

Then(
  '{string} still has {instance}, and still may at most {level} in the group {string}',
  async (world: PortalWorld, role: string, slug: string, level: string, group: string) => {
    await expect.poll(() => world.page.getByRole('dialog').count()).toBe(0);
    const box = onInstance(world, role, slug).getByRole('checkbox', { name: `/${slug}` });
    expect(await box.isChecked()).toBe(true);
    await seen(switches(world, role, slug));
    const id = await world.tasksInstance(slug);
    expect((await roleRow(world, role))?.endpoints.map((e) => e.instanceId)).toEqual([id]);
    expect((await roleLevels(world, role, slug)).groups.find((g) => g.key === group)?.roleLevel).toBe(level);
  },
);

Given(
  'the admin opened the roles page, and another admin removed {instance} from {string} meanwhile',
  async (world: PortalWorld, slug: string, role: string) => {
    await rolesPage(world);
    await seen(switches(world, role, slug));
    await world.expectOk(
      (await world.adminApi()).put(`/api/roles/${await world.role(role)}/instances`, { instanceIds: [] }),
      'remove the instance',
    );
  },
);

When(
  'the admin turns on {string} for {string} on {instance}',
  async (world: PortalWorld, label: string, role: string, slug: string) => {
    await switches(world, role, slug).getByRole('checkbox', { name: label }).click();
  },
);

Then('the portal says to add the instance to the role first', async (world: PortalWorld) => {
  await seen(world.page.getByRole('alert').filter({ hasText: 'Add the endpoint to the role first' }));
});

// ── maximum levels ──

When(
  'the admin follows the levels of {string} on {instance} and sets the group {string} to {level}',
  async (world: PortalWorld, role: string, slug: string, group: string, level: string) => {
    await rolesPage(world);
    await onInstance(world, role, slug).getByRole('link', { name: 'levels…' }).click();
    await seen(world.page.getByRole('heading', { name: `/${slug}` }));
    const saved = world.page.waitForResponse((r) => r.request().method() === 'PUT');
    await world.page
      .getByRole('radiogroup', { name: `Access for ${group}` })
      .getByRole('radio', { name: LEVELS[level] })
      .click();
    await saved;
  },
);

Then(
  '{string} now may at most {level} in the group {string} of {instance}',
  async (world: PortalWorld, role: string, level: string, group: string, slug: string) => {
    expect((await roleLevels(world, role, slug)).groups.find((g) => g.key === group)?.roleLevel).toBe(level);
  },
);

When(
  'the admin sets all groups of {string} on {instance} to {level} and confirms the question',
  async (world: PortalWorld, role: string, slug: string, level: string) => {
    await world.openAsAdmin(`/endpoints/${slug}/access?role=${await world.role(role)}`);
    await seen(world.page.getByRole('radiogroup').first());
    await world.page.getByRole('combobox', { name: 'Set every group to one level' }).selectOption(level);
    const saved = world.page.waitForResponse((r) => r.request().method() === 'POST');
    await world.answerQuestion('Set all groups');
    await saved;
  },
);

Then(
  '{string} now may at most {level} in every group of {instance}',
  async (world: PortalWorld, role: string, level: string, slug: string) => {
    const { groups } = await roleLevels(world, role, slug);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.map((g) => g.roleLevel)).toEqual(groups.map(() => level));
  },
);

// ── rename and delete ──

async function rename(world: PortalWorld, role: string) {
  await rolesPage(world);
  await card(world, role).getByRole('button', { name: 'Rename' }).click();
  await seen(world.page.getByRole('dialog'));
}

When(
  'the admin renames {string} to {string} on the roles page',
  async (world: PortalWorld, role: string, name: string) => {
    await rename(world, role);
    await world.page.getByRole('dialog').getByLabel('New name').fill(name);
    await world.answerQuestion('Rename');
  },
);

Then('the roles page shows the role {string}', async (world: PortalWorld, name: string) => {
  await seen(world.page.getByRole('heading', { name, exact: true }));
  expect((await roleRows(world)).map((r) => r.name)).toContain(name);
});

When(
  /^the admin renames "([^"]+)" on the roles page and (cancels the question|keeps the name as it is)$/,
  async (world: PortalWorld, role: string, answer: string) => {
    world.requests.length = 0;
    await rename(world, role);
    await world.answerQuestion(answer === 'cancels the question' ? 'Cancel' : 'Rename');
  },
);

Then('the role {string} keeps its name, and nothing was saved', async (world: PortalWorld, name: string) => {
  await expect.poll(() => world.page.getByRole('dialog').count()).toBe(0);
  await seen(card(world, name));
  expect(world.requests.filter((p) => p.startsWith('/api/roles/'))).toEqual([]);
  expect((await roleRows(world)).map((r) => r.name)).toContain(name);
});

When(
  'the admin deletes {string} on the roles page and confirms the question',
  async (world: PortalWorld, role: string) => {
    await rolesPage(world);
    await card(world, role).getByRole('button', { name: 'Delete' }).click();
    await world.answerQuestion('Delete');
  },
);

Then('the roles page no longer shows {string}', async (world: PortalWorld, role: string) => {
  await expect.poll(() => card(world, role).count()).toBe(0);
  expect(await roleRow(world, role)).toBeUndefined();
});

// ── refusals ──

When('the admin adds the role {string} on the roles page', async (world: PortalWorld, name: string) => {
  await rolesPage(world);
  await world.page.getByRole('textbox', { name: 'New role name' }).fill(name);
  await world.page.getByRole('button', { name: 'Add role' }).click();
});

Then('the portal says that 1 user has the role, who must move to another role first', async (world: PortalWorld) => {
  await seen(world.page.getByRole('alert').filter({ hasText: '1 user(s) have this role; move them first' }));
});
