import type { Locator } from 'playwright';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { PortalWorld } from '../../support/world.js';

const seen = (locator: Locator) => locator.waitFor({ state: 'visible', timeout: 10_000 });
const events = (world: PortalWorld) => world.page.getByRole('table', { name: 'Audit events' });
/** The rows of events, without the rows of opened details. */
const eventRows = (world: PortalWorld) => events(world).locator('tbody tr.clickable');
const actorOf = (row: Locator) => row.getByRole('cell').last();
const kinds = async (world: PortalWorld) =>
  (await eventRows(world).locator('td:nth-child(2)').allTextContents()).map((t) => t.trim());

export async function auditLog(world: PortalWorld) {
  await world.openAsAdmin('/audit');
  await expect.poll(() => events(world).getAttribute('aria-busy')).toBe('false');
  await seen(eventRows(world).first());
}

Given(
  '{string} signed in once with the role {string} and was then deleted',
  async (world: PortalWorld, name: string, role: string) => {
    await world.user(name, { name: role });
    await world.apiAs(name);
    const admin = await world.adminApi();
    const users = (await world.expectOk(admin.get('/api/users'), 'users')) as unknown as {
      id: string;
      username: string;
    }[];
    await world.expectOk(admin.del(`/api/users/${users.find((u) => u.username === name)!.id}`), 'delete user');
  },
);

Given('the admin made {int} roles', async (world: PortalWorld, count: number) => {
  for (let i = 1; i <= count; i++) await world.role(`role ${i}`);
});

When('the admin opens the audit log', async (world: PortalWorld) => {
  await auditLog(world);
});

Then('the sign-in of {string} shows the actor {string}', async (world: PortalWorld, _name: string, actor: string) => {
  const row = eventRows(world)
    .filter({ hasText: 'login' })
    .filter({ has: world.page.getByText(actor) });
  expect(await actorOf(row.first()).textContent()).toBe(actor);
});

Then('the creation of {string} shows the actor {string}', async (world: PortalWorld, _name: string, actor: string) => {
  const row = eventRows(world).filter({ hasText: 'user_created' }).first();
  expect((await actorOf(row).textContent())?.trim()).toBe(actor);
});

Then(
  'the catalog sync of {instance} shows the actor {string}',
  async (world: PortalWorld, slug: string, actor: string) => {
    const row = eventRows(world).filter({ hasText: 'catalog_synced' }).filter({ hasText: slug }).first();
    expect((await actorOf(row).textContent())?.trim()).toBe(actor);
  },
);

When('the admin picks the kind {string} in the audit log', async (world: PortalWorld, kind: string) => {
  await auditLog(world);
  world.requests.length = 0;
  await world.page.getByLabel('Kind').selectOption({ label: kind });
});

Then('the audit log still shows the catalog sync', async (world: PortalWorld) => {
  await seen(eventRows(world).filter({ hasText: 'catalog_synced' }).first());
  expect(world.requests.filter((p) => p.startsWith('/api/audit'))).toEqual([]);
});

Then('after Apply, it shows only sign-ins', async (world: PortalWorld) => {
  await world.page.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(async () => [...new Set(await kinds(world))]).toEqual(['auth']);
});

When('the admin opens the older events in the audit log', async (world: PortalWorld) => {
  await auditLog(world);
  expect(await eventRows(world).count()).toBe(100);
  await world.page.getByRole('button', { name: 'Older' }).click();
});

Then('the audit log shows events 101 and on of the total', async (world: PortalWorld) => {
  const pager = world.page.getByText(/^101–\d+ of \d+$/);
  await seen(pager);
  // While the page loads, the pager can still show the full range of 100.
  const range = async () =>
    /^101–(\d+) of (\d+)$/
      .exec((await pager.textContent()) ?? '')!
      .slice(1)
      .map(Number);
  await expect.poll(async () => new Set(await range()).size).toBe(1);
  const [, total] = await range();
  expect(total).toBeGreaterThan(105);
  await expect.poll(() => eventRows(world).count()).toBe(total! - 100);
});
