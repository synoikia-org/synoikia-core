import type { Locator } from 'playwright';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { PortalWorld } from '../../support/world.js';

const seen = (locator: Locator) => locator.waitFor({ state: 'visible', timeout: 10_000 });
const USER = 'user 12';
const SWITCHES: Record<string, Record<string, boolean>> = {
  '': {},
  ' with personal levels': { canSetOwnLevels: true },
  ' with personal levels and its status': { canSetOwnLevels: true, canSeeStatus: true },
};
const OPERATIONS: Record<string, string> = { 'add a task': 'tasks.add', 'complete a task': 'tasks.complete' };

const assigned = (world: PortalWorld) => world.page.getByRole('table', { name: 'Assigned endpoints' });
const unassigned = (world: PortalWorld) => world.page.getByRole('table', { name: 'Unassigned endpoints' });
const mainMenu = (world: PortalWorld) => world.page.getByRole('navigation', { name: 'Main' });

/** User 12's own view of the instance at `slug`, as their portal lists it. */
async function myInstance(world: PortalWorld, slug: string) {
  const mine = (await world.expectOk((await world.apiAs(USER)).get('/api/me/endpoints'), 'my instances')) as {
    assigned: { id: string; slug: string }[];
  };
  return mine.assigned.find((e) => e.slug === slug)!;
}

async function openMine(world: PortalWorld, slug: string) {
  const { id } = await myInstance(world, slug);
  await world.openAs(USER, `/my/${id}`);
  await seen(world.page.getByRole('heading', { name: `/${slug}` }));
}

// ── what user 12 has ──

Given(
  /^user 12 has the role "([^"]+)", which has the instance \/([a-z]+)( with personal levels(?: and its status)?)?$/,
  async (world: PortalWorld, role: string, slug: string, switches = '') => {
    await world.user(USER, { name: role });
    await world.roleInstances(role, [slug]);
    if (switches) await world.roleSwitches(role, slug, SWITCHES[switches]!);
  },
);

Given(
  'user 12 has the role {string}, which has the instances {instance} and {instance}',
  async (world: PortalWorld, role: string, first: string, second: string) => {
    await world.user(USER, { name: role });
    await world.roleInstances(role, [first, second]);
  },
);

Given(
  'the role {string} may see other instances, and the instance {instance} exists',
  async (world: PortalWorld, role: string, slug: string) => {
    await world.tasksInstance(slug);
    await world.expectOk(
      (await world.adminApi()).patch(`/api/roles/${await world.role(role)}`, { canSeeOtherEndpoints: true }),
      'see other instances',
    );
  },
);

Given(
  '{string} may at most {level} in the group {string} of {instance}',
  async (world: PortalWorld, role: string, level: string, group: string, slug: string) => {
    await world.roleLevel(role, slug, { group }, level);
  },
);

Given(
  '{string} may at most {level} in the group {string} of {instance}, but nothing for {string}',
  async (world: PortalWorld, role: string, level: string, group: string, slug: string, name: string) => {
    await world.roleLevel(role, slug, { group }, level);
    await world.roleLevel(role, slug, { operation: OPERATIONS[name]! }, 'none');
  },
);

Given('{string} may keep own rules on {instance}', async (world: PortalWorld, role: string, slug: string) => {
  await world.roleSwitches(role, slug, { canManageOwnRules: true });
});

Given(
  '{string} may keep own rules on {instance}, and may at most Ask in the group {string}',
  async (world: PortalWorld, role: string, slug: string, group: string) => {
    await world.roleSwitches(role, slug, { canManageOwnRules: true });
    await world.roleLevel(role, slug, { group }, 'ask');
  },
);

// ── a non-admin's portal ──

When('user 12 signs in to the portal', async (world: PortalWorld) => {
  await world.open('/login');
  await world.signIn(USER);
});

When('user 12 opens the user list in the portal', async (world: PortalWorld) => {
  await world.openAs(USER, '/settings/users');
});

Given("the server's public address is {string}", async (world: PortalWorld, address: string) => {
  await world.restartCore({ PUBLIC_MCP_URL: address });
});

async function seesMyInstances(world: PortalWorld) {
  await seen(world.page.getByRole('heading', { name: 'My endpoints', level: 1 }));
  expect(new URL(world.page.url()).pathname).toBe('/my');
}

Then('user 12 sees My instances with {string}, and no other instances', async (world: PortalWorld, address: string) => {
  await seesMyInstances(world);
  await seen(assigned(world).getByText(address, { exact: true }));
  expect(await world.page.getByRole('heading', { name: 'Unassigned endpoints' }).count()).toBe(0);
});

Then('the portal shows My instances to user 12 instead', async (world: PortalWorld) => {
  await seesMyInstances(world);
});

Then('the menu offers user 12 only {instance} and {string}', async (world: PortalWorld, slug: string, item: string) => {
  const links = (await mainMenu(world).getByRole('link').allTextContents()).map((t) => t.trim());
  expect(links).toEqual(['My endpoints', `/${slug}`, item]);
});

When('user 12 opens {instance} from My instances', async (world: PortalWorld, slug: string) => {
  await world.openAs(USER, '/my');
  const other = unassigned(world)
    .getByRole('row')
    .filter({ hasText: `/${slug}` });
  await seen(other);
  world.noted.otherRow = (await other.textContent()) ?? '';
  await other.getByRole('link', { name: `/${slug}` }).click();
});

Then(
  'the page of {instance} says that user 12 has no access and should contact an administrator',
  async (world: PortalWorld, slug: string) => {
    await seen(world.page.getByRole('heading', { name: `/${slug}` }));
    await seen(
      world.page
        .getByRole('status')
        .filter({ hasText: "You don't have access to this endpoint. Contact an administrator if you need it." }),
    );
  },
);

Then('My instances listed {instance} without its address', (world: PortalWorld, slug: string) => {
  expect(world.noted.otherRow).toContain(`/${slug}`);
  expect(world.noted.otherRow).not.toMatch(/https?:\/\//);
});

// ── personal levels ──

When('user 12 opens {instance} in the portal', async (world: PortalWorld, slug: string) => {
  await openMine(world, slug);
});

Then(
  'user 12 sees the group {string} at {level}, with no level to pick',
  async (world: PortalWorld, group: string, level: string) => {
    const row = world.page.locator(`[data-group="${group}"]`);
    await seen(row.getByText(level[0]!.toUpperCase() + level.slice(1), { exact: true }));
    expect(await world.page.getByRole('radiogroup').count()).toBe(0);
  },
);

When(
  'user 12 sets the group {string} of {instance} to {level}',
  async (world: PortalWorld, group: string, slug: string, level: string) => {
    await openMine(world, slug);
    const saved = world.page.waitForResponse((r) => r.request().method() === 'PUT');
    await world.page
      .getByRole('radiogroup', { name: `Access for ${group}` })
      .getByRole('radio', { name: level[0]!.toUpperCase() + level.slice(1) })
      .click();
    await saved;
  },
);

Then(
  "user 12's own level for the group {string} of {instance} is {level}",
  async (world: PortalWorld, group: string, slug: string, level: string) => {
    const { id } = await myInstance(world, slug);
    const access = (await world.expectOk(
      (await world.apiAs(USER)).get(`/api/me/endpoints/${id}/access`),
      'access',
    )) as {
      groups: { key: string; ownLevel: string | null }[];
    };
    expect(access.groups.find((g) => g.key === group)?.ownLevel).toBe(level);
  },
);

Then('user 12 cannot pick Write for the group {string}', async (world: PortalWorld, group: string) => {
  const write = world.page
    .getByRole('radiogroup', { name: `Access for ${group}` })
    .getByRole('radio', { name: 'Write' });
  expect(await write.isDisabled()).toBe(true);
});

Then('{string} shows {string}, with no level to pick', async (world: PortalWorld, name: string, text: string) => {
  const key = OPERATIONS[name]!;
  await world.page.getByRole('button', { name: 'Expand tasks' }).click();
  await seen(world.page.locator(`[data-op="${key}"]`).getByText(text, { exact: true }));
  expect(await world.page.getByRole('radiogroup', { name: `Level of ${key}` }).count()).toBe(0);
});

Then(
  '{string} shows {string}, and user 12 can still pick Ask for it and for the group {string}',
  async (world: PortalWorld, name: string, text: string, group: string) => {
    const key = OPERATIONS[name]!;
    await world.page.getByRole('button', { name: `Expand ${group}` }).click();
    await seen(world.page.locator(`[data-op="${key}"]`).getByText(text, { exact: true }));
    const ask = (radiogroup: string) =>
      world.page.getByRole('radiogroup', { name: radiogroup }).getByRole('radio', { name: 'Ask', exact: true });
    expect(await ask(`Level of ${key}`).isEnabled()).toBe(true);
    expect(await ask(`Access for ${group}`).isEnabled()).toBe(true);
  },
);

// ── own rules ──

When(
  'user 12 opens {instance} and then {instance} in the portal',
  async (world: PortalWorld, first: string, second: string) => {
    const offers: string[] = [];
    for (const slug of [first, second]) {
      await openMine(world, slug);
      await seen(world.page.getByText(/levels your role|Your role sets the most/).first());
      if ((await world.page.getByRole('tab', { name: 'My pre-approval rules' }).count()) > 0) offers.push(slug);
    }
    world.noted.rulesOn = offers.join(',');
  },
);

Then('only {instance} offered {string}', (world: PortalWorld, slug: string) => {
  expect(world.noted.rulesOn).toBe(slug);
});

When('user 12 starts a rule for {string} on {instance}', async (world: PortalWorld, name: string, slug: string) => {
  await openMine(world, slug);
  world.requests.length = 0;
  await world.page.getByRole('tab', { name: 'My pre-approval rules' }).click();
  await world.page.getByRole('button', { name: 'New rule' }).click();
  await world.page
    .getByRole('dialog')
    .getByRole('listbox', { name: /^Operation/ })
    .selectOption(OPERATIONS[name]!);
});

Then('the rule editor offers the list {string}', async (world: PortalWorld, list: string) => {
  const dialog = world.page.getByRole('dialog');
  await expect.poll(() => dialog.locator(`datalist option[value="${list}"]`).count()).toBeGreaterThan(0);
});

Then('the portal asked the server for no admin data', (world: PortalWorld) => {
  const asked = world.requests.filter((p) => p.startsWith('/api/'));
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.filter((p) => !p.startsWith('/api/me/') && p !== '/api/session')).toEqual([]);
});
