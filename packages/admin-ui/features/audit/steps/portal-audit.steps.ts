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
  // The older page arrives late, so the next step sees the pager while it loads.
  await world.page.route(/\/api\/audit\?.*offset=100/, async (route) => {
    await new Promise((done) => setTimeout(done, 1000));
    await route.continue();
  });
  await world.page.getByRole('button', { name: 'Older' }).click();
});

/** The table's busy state, its rows and the pager's range, read at the same moment. */
const onScreen = (world: PortalWorld) =>
  world.page.evaluate(() => {
    const table = document.querySelector('table[aria-label="Audit events"]')!;
    const range = [...document.querySelectorAll('span')]
      .map((s) => s.textContent?.trim() ?? '')
      .find((t) => /^\d+–\d+ of \d+$/.test(t));
    return {
      busy: table.getAttribute('aria-busy') === 'true',
      rows: table.querySelectorAll('tbody tr.clickable').length,
      range,
    };
  });

Then('the audit log shows events 101 and on of the total', async (world: PortalWorld) => {
  const seenStates: Awaited<ReturnType<typeof onScreen>>[] = [];
  for (let at = Date.now(); Date.now() - at < 10_000;) {
    const state = await onScreen(world);
    seenStates.push(state);
    if (!state.busy && state.rows < 100) break;
  }
  const total = Number(/of (\d+)$/.exec(seenStates.at(-1)?.range ?? '')?.[1]);
  expect(total).toBeGreaterThan(105);
  // The first page holds 100 rows and the older page fewer, so the row count tells which page is on screen.
  for (const state of seenStates)
    expect(state.range).toBe(state.rows === 100 ? `1–100 of ${total}` : `101–${total} of ${total}`);
  expect(seenStates.some((state) => state.busy && state.rows === 100)).toBe(true);
  expect(seenStates.at(-1)).toEqual({ busy: false, rows: total - 100, range: `101–${total} of ${total}` });
});
