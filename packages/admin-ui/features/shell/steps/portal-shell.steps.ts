import type { Locator } from 'playwright';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { PortalWorld } from '../../support/world.js';

const seen = (locator: Locator) => locator.waitFor({ state: 'visible', timeout: 10_000 });
const mainMenu = (world: PortalWorld) => world.page.getByRole('navigation', { name: 'Main' });

When('the admin opens the portal', async (world: PortalWorld) => {
  await world.openAsAdmin('/');
  await seen(mainMenu(world).getByRole('link', { name: 'Overview' }));
});

Then(
  'the menu starts with {string} and ends with {string}, {string}, {string} and {string}',
  async (world: PortalWorld, first: string, ...last: string[]) => {
    const links = (await mainMenu(world).getByRole('link').allTextContents()).map((t) => t.trim());
    expect(links[0]).toBe(first);
    expect(links.slice(-4)).toEqual(last.slice(0, 4));
  },
);

Then('the menu shows the version of the server and a link to report issues', async (world: PortalWorld) => {
  await seen(world.page.getByText(/^v\d+\.\d+\.\d+/));
  const issues = world.page.getByRole('link', { name: 'Report a bug or request a feature on GitHub' });
  expect(await issues.getAttribute('href')).toMatch(/\/issues$/);
});

Given('the admin has the overview open', async (world: PortalWorld) => {
  await world.overviewOpen();
});

When('another admin makes the instance {instance}', async (world: PortalWorld, slug: string) => {
  await world.tasksInstance(slug);
});

Then('the overview lists {instance} without a reload', async (world: PortalWorld, slug: string) => {
  await seen(world.page.getByRole('main').getByText(`/${slug}`, { exact: true }).first());
  expect(await world.sameLoad()).toBe(true);
});
