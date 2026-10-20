import type { Locator } from 'playwright';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { PortalWorld } from '../../support/world.js';

const seen = (locator: Locator) => locator.waitFor({ state: 'visible', timeout: 10_000 });
const dialog = (world: PortalWorld) => world.page.getByRole('dialog');
const tokensTable = (world: PortalWorld) => world.page.getByRole('table', { name: 'Bearer tokens' });
const tokenRow = (world: PortalWorld, name: string) =>
  tokensTable(world)
    .getByRole('row')
    .filter({ has: world.page.getByRole('cell', { name, exact: true }) });

export async function clientsPage(world: PortalWorld) {
  await world.openAsAdmin('/clients');
  await seen(world.page.getByRole('heading', { name: 'Bearer tokens' }));
  await expect.poll(() => tokensTable(world).getAttribute('aria-busy'), { timeout: 10_000 }).toBe('false');
}

async function newToken(world: PortalWorld, name: string) {
  await clientsPage(world);
  await world.page.getByRole('button', { name: 'New token' }).click();
  await dialog(world).getByLabel('Name').fill(name);
}

Given('the instance {instance}', async (world: PortalWorld, slug: string) => {
  await world.tasksInstance(slug);
});

Given('the admin has the bearer token {string}', async (world: PortalWorld, name: string) => {
  await world.expectOk(
    (await world.adminApi()).post('/api/tokens', { name, scope: ['*'], access: 'read' }),
    'make a token',
  );
});

When('the admin opens the clients page', async (world: PortalWorld) => {
  await clientsPage(world);
});

When(
  'the admin makes the bearer token {string} for {instance}',
  async (world: PortalWorld, name: string, slug: string) => {
    await newToken(world, name);
    await dialog(world)
      .getByRole('checkbox', { name: `/${slug}` })
      .check();
    await dialog(world).getByRole('button', { name: 'Create token' }).click();
  },
);

Then('the portal shows the new token once, with {string}', async (world: PortalWorld, text: string) => {
  await seen(dialog(world).getByText(text));
  world.noted.token = (await dialog(world).locator('pre').textContent()) ?? '';
  expect(world.noted.token).toMatch(/^\S{32,}$/);
  await dialog(world).getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => dialog(world).count()).toBe(0);
});

Then('the portal shows why, and lists no token', async (world: PortalWorld) => {
  await seen(world.page.getByRole('alert'));
  expect((await world.page.getByRole('alert').textContent())?.trim()).not.toBe('');
  expect(await tokensTable(world).locator('tbody tr').count()).toBe(0);
  await seen(world.page.getByText('No bearer tokens.'));
});

Then('the clients page lists {string} without its value', async (world: PortalWorld, name: string) => {
  await seen(tokenRow(world, name));
  expect(await world.page.content()).not.toContain(world.noted.token);
});

When(
  'the admin makes the bearer token {string} for all instances, which expired yesterday',
  async (world: PortalWorld, name: string) => {
    await newToken(world, name);
    await dialog(world)
      .getByRole('checkbox', { name: /^All endpoints/ })
      .check();
    const yesterday = new Date(Date.now() - 86_400_000 - new Date().getTimezoneOffset() * 60_000);
    await dialog(world).getByLabel('Expires').fill(yesterday.toISOString().slice(0, 16));
    await dialog(world).getByRole('button', { name: 'Create token' }).click();
  },
);

Then('the token dialog shows the alert {string}', async (world: PortalWorld, text: string) => {
  await seen(dialog(world).getByRole('alert').filter({ hasText: text }));
});

When('the admin revokes {string} and confirms the question', async (world: PortalWorld, name: string) => {
  await clientsPage(world);
  await tokenRow(world, name).getByRole('button', { name: 'Revoke' }).click();
  await world.answerQuestion('Revoke');
});

Then('the clients page no longer lists {string}', async (world: PortalWorld, name: string) => {
  await expect.poll(() => tokenRow(world, name).count()).toBe(0);
  const tokens = (await world.expectOk((await world.adminApi()).get('/api/tokens'), 'tokens')) as unknown as {
    name: string;
    revokedAt: string | null;
  }[];
  expect(tokens.find((t) => t.name === name)?.revokedAt).not.toBeNull();
});
