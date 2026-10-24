import type { Locator } from 'playwright';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { PortalWorld } from '../../support/world.js';

const seen = (locator: Locator) => locator.waitFor({ state: 'visible', timeout: 10_000 });
const USER = 'user 12';
const EDIT = 'https://github.com/synoikia-org/synoikia-core/edit/main/packages/admin-ui/src/help/';
const dialog = (world: PortalWorld) => world.page.getByRole('dialog');
/** The help drawer: the one landmark with "Close help" in it. */
const help = (world: PortalWorld) =>
  world.page.getByRole('complementary').filter({ has: world.page.getByRole('button', { name: 'Close help' }) });
const title = (world: PortalWorld, name: string) => seen(help(world).getByRole('heading', { level: 2, name }));
const heading = (world: PortalWorld, name: string) =>
  seen(help(world).getByRole('heading', { level: 3, name, exact: true }));

async function rulesOf(world: PortalWorld, slug: string) {
  await world.tasksInstance(slug);
  await world.openAsAdmin(`/endpoints/${slug}/rules`);
  await seen(world.page.getByRole('heading', { name: `/${slug}` }));
}

async function openHelp(world: PortalWorld) {
  await world.page.getByRole('button', { name: 'Help for this page' }).click();
  await seen(help(world));
}

async function newRule(world: PortalWorld, slug: string, reason?: string) {
  await rulesOf(world, slug);
  await world.page.getByRole('button', { name: 'New rule' }).click();
  await dialog(world)
    .getByRole('listbox', { name: /^Operation/ })
    .selectOption('tasks.add');
  if (reason)
    await dialog(world)
      .getByLabel(/^Reason/)
      .fill(reason);
}

async function myInstancesHelp(world: PortalWorld) {
  await world.openAs(USER, '/my');
  await seen(world.page.getByRole('heading', { name: 'My endpoints', level: 1 }));
  await openHelp(world);
}

// ── each page and its help ──

Given('the admin has the rules of {instance} open', async (world: PortalWorld, slug: string) => {
  await rulesOf(world, slug);
});

When('the admin opens the help', async (world: PortalWorld) => {
  await openHelp(world);
});

Then('the admin reads {string}, with {string} in it', async (world: PortalWorld, topic: string, section: string) => {
  await title(world, topic);
  await heading(world, section);
});

Then('the rules page itself does not explain matching', async (world: PortalWorld) => {
  expect(await world.page.locator('main').innerText()).not.toMatch(/match/i);
});

When('user 12 opens the help on My instances', async (world: PortalWorld) => {
  await myInstancesHelp(world);
});

Then('user 12 reads {string}, with {string} in it', async (world: PortalWorld, topic: string, section: string) => {
  await title(world, topic === 'My instances' ? 'My endpoints' : topic);
  await heading(world, section);
});

Given('the admin has the help of the rules of {instance} open', async (world: PortalWorld, slug: string) => {
  await rulesOf(world, slug);
  await openHelp(world);
});

When('the admin hits Escape', async (world: PortalWorld) => {
  await world.page.keyboard.press('Escape');
});

Then('the help is closed, with the focus on {string}', async (world: PortalWorld, name: string) => {
  await expect.poll(() => help(world).count()).toBe(0);
  await expect
    .poll(() => world.page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''))
    .toBe(name);
});

Given('the admin has a new rule open on {instance}', async (world: PortalWorld, slug: string) => {
  await newRule(world, slug);
});

When('the admin reads the reason of the new rule', async (world: PortalWorld) => {
  const reason = dialog(world).getByLabel(/^Reason/);
  world.noted.label = (
    await dialog(world)
      .locator(`label[for="${await reason.getAttribute('id')}"]`)
      .innerText()
  ).trim();
  world.noted.described = await reason.evaluate((el) =>
    (el.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => (id ? (document.getElementById(id)?.textContent?.trim() ?? '') : ''))
      .join(' ')
      .trim(),
  );
});

Then('the admin sees {string} and nothing more', (world: PortalWorld, text: string) => {
  expect(world.noted.label).toBe('Reason');
  expect(world.noted.described).toBe(text);
});

Then('the help of the rules says why a reason is needed', async (world: PortalWorld) => {
  await world.page.keyboard.press('Escape');
  await expect.poll(() => dialog(world).count()).toBe(0);
  await openHelp(world);
  await seen(
    help(world)
      .locator('section')
      .filter({ has: world.page.getByRole('heading', { name: 'Reason', exact: true }) })
      .filter({ hasText: 'without asking' }),
  );
});

// ── from one help to another ──

When('the admin searches the help for {string}', async (world: PortalWorld, text: string) => {
  await help(world).getByRole('searchbox', { name: 'Search all help topics' }).fill(text);
});

Then(
  'the admin reads {string} from User auth, still on the rules of {instance}',
  async (world: PortalWorld, section: string, slug: string) => {
    await help(world).getByRole('list', { name: 'Search results' }).getByRole('button').first().click();
    await title(world, 'User auth');
    await heading(world, section);
    expect(new URL(world.page.url()).pathname).toBe(`/endpoints/${slug}/rules`);
  },
);

Then('one step takes the admin back to {string}', async (world: PortalWorld, topic: string) => {
  await help(world)
    .getByRole('button', { name: `← Back to ${topic}` })
    .click();
  await title(world, topic);
});

When('the admin follows the related help {string}', async (world: PortalWorld, name: string) => {
  await help(world).getByRole('navigation', { name: 'Related help' }).getByRole('link', { name }).click();
});

Then(
  'the admin reads {string}, with {string} in it, still on the rules of {instance}',
  async (world: PortalWorld, topic: string, section: string, slug: string) => {
    await title(world, topic);
    await heading(world, section);
    expect(new URL(world.page.url()).pathname).toBe(`/endpoints/${slug}/rules`);
  },
);

// ── one part of a long help ──

Given(
  "the admin typed {string} in a new rule's reason on {instance}",
  async (world: PortalWorld, reason: string, slug: string) => {
    await newRule(world, slug, reason);
  },
);

When('the admin opens the help on {string}', async (world: PortalWorld, label: string) => {
  await dialog(world)
    .getByRole('button', { name: `Help on ${label}` })
    .click();
});

Then(
  'the admin reads {string}, with the new rule still open and {string} kept',
  async (world: PortalWorld, section: string, reason: string) => {
    await heading(world, section);
    await expect
      .poll(() =>
        help(world).evaluate((box) => box.contains(document.activeElement) && document.activeElement?.textContent),
      )
      .toBe(section);
    expect(
      await dialog(world)
        .getByLabel(/^Reason/)
        .inputValue(),
    ).toBe(reason);
  },
);

Given(
  "the admin typed {string} in a new rule's reason on {instance} and opened the help in it",
  async (world: PortalWorld, reason: string, slug: string) => {
    await newRule(world, slug, reason);
    await dialog(world).getByRole('button', { name: 'Help on Only when' }).click();
    await seen(help(world));
  },
);

Then('the first Escape closed only the help, with {string} kept', (world: PortalWorld, reason: string) => {
  expect(JSON.parse(world.noted.afterFirst!)).toEqual({ dialogs: 1, reason });
});

// ── what only an admin reads ──

When('user 12 searches the help for {string}', async (world: PortalWorld, text: string) => {
  await myInstancesHelp(world);
  await help(world).getByRole('searchbox', { name: 'Search all help topics' }).fill(text);
});

Then('user 12 is told that no help matches {string}', async (world: PortalWorld, text: string) => {
  await seen(
    help(world)
      .getByRole('status')
      .filter({ hasText: `No help matches “${text}”.` }),
  );
});

When('user 12 opens the help on {instance}', async (world: PortalWorld, slug: string) => {
  const mine = (await world.expectOk((await world.apiAs(USER)).get('/api/me/endpoints'), 'my instances')) as {
    assigned: { id: string; slug: string }[];
  };
  await world.openAs(USER, `/my/${mine.assigned.find((e) => e.slug === slug)!.id}`);
  await seen(world.page.getByRole('heading', { name: `/${slug}` }));
  await openHelp(world);
});

Then(
  'user 12 reads how their own levels work, and nothing on how an admin sets the levels of {instance}',
  async (world: PortalWorld) => {
    await heading(world, 'Your own levels');
    expect(await help(world).innerText()).not.toMatch(/admin sets/i);
  },
);

// ── what the help describes, and a fix ──

Given('user 12 has the help of My instances open', async (world: PortalWorld) => {
  await world.user(USER, { name: 'family' });
  await myInstancesHelp(world);
});

When('user 12 suggests an edit', async (world: PortalWorld) => {
  await world.context.route('https://github.com/**', (route) => route.fulfill({ body: 'GitHub' }));
  const [tab] = await Promise.all([
    world.context.waitForEvent('page'),
    help(world)
      .getByRole('link', { name: /Suggest an edit/ })
      .click(),
  ]);
  await tab.waitForLoadState();
  world.noted.landed = tab.url();
});

Then('user 12 lands on GitHub, on the proposal of a change to the help of My instances', (world: PortalWorld) => {
  expect(world.noted.landed).toBe(`${EDIT}my-endpoints.md`);
});

Given('the server runs Synoikia {word}', async (world: PortalWorld, version: string) => {
  world.coreVersion = version;
  await world.restartCore({});
});

When('the admin opens the help on the overview', async (world: PortalWorld) => {
  await world.openAsAdmin('/');
  await seen(world.page.getByRole('heading', { name: 'Overview', level: 1 }));
  await openHelp(world);
});

Then('the help says it is for Synoikia {word}', async (world: PortalWorld, version: string) => {
  await seen(help(world).getByText(`Help for Synoikia ${version}`));
});
