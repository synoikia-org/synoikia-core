import type { Locator, Page } from 'playwright';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { PortalWorld } from '../../support/world.js';

const seen = (locator: Locator) => locator.waitFor({ state: 'visible', timeout: 10_000 });
const dialog = (world: PortalWorld) => world.page.getByRole('dialog');
/** The app's one polite live region: what a screen reader says without interrupting. */
const spoken = (world: PortalWorld) => world.page.locator('[aria-live="polite"]');
const mainMenu = (world: PortalWorld) => world.page.getByRole('navigation', { name: 'Main' });

/** The accessible name of the focused element, as a screen reader would say it. */
const focusedName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return '';
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled)
      return labelled
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ');
    const input = el as HTMLInputElement;
    return (el.getAttribute('aria-label') ?? input.labels?.[0]?.textContent ?? el.textContent ?? '').trim();
  });

/** How many visible controls `root` has, and those without an accessible name, by their outer markup. */
const unnamed = (root: Locator) =>
  root.evaluate((box) => {
    const shown = [...box.querySelectorAll<HTMLElement>('input, select, textarea, button')].filter(
      (el) => el.getClientRects().length > 0 && (el as HTMLInputElement).type !== 'hidden',
    );
    const missing = shown
      .filter((el) => {
        const byIds = (el.getAttribute('aria-labelledby') ?? '')
          .split(' ')
          .map((id) => (id ? (document.getElementById(id)?.textContent ?? '') : ''))
          .join('');
        const labels = [...((el as HTMLInputElement).labels ?? [])].map((l) => l.textContent ?? '').join('');
        const own = el.tagName === 'BUTTON' ? (el.textContent ?? '') : '';
        return !(byIds + (el.getAttribute('aria-label') ?? '') + labels + own + (el.title ?? '')).trim();
      })
      .map((el) => el.outerHTML.slice(0, 120));
    return { shown: shown.length, missing };
  });

/** The text of the elements that describe `control`. */
const description = (control: Locator) =>
  control.evaluate((el) =>
    (el.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => (id ? (document.getElementById(id)?.textContent?.trim() ?? '') : ''))
      .join(' '),
  );

async function instancePage(world: PortalWorld, slug: string, section: string) {
  await world.tasksInstance(slug);
  await world.openAsAdmin(`/endpoints/${slug}/${section}`);
  await seen(world.page.getByRole('heading', { name: `/${slug}` }));
}

// ── landing on pages ──

When('the admin uses {string} from the keyboard', async (world: PortalWorld, name: string) => {
  await world.page.keyboard.press('Tab');
  expect(await focusedName(world.page)).toBe(name);
  await world.page.keyboard.press('Enter');
});

Then('the focus is on the content of the page', async (world: PortalWorld) => {
  await expect.poll(() => world.page.evaluate(() => document.activeElement?.id)).toBe('main');
});

When('the admin goes to the audit log from the menu', async (world: PortalWorld) => {
  world.noted.firstPage = (await spoken(world).textContent()) ?? '';
  await mainMenu(world).getByRole('link', { name: 'Audit Log' }).click();
});

Then('a screen reader heard nothing on the first page', (world: PortalWorld) => {
  expect(world.noted.firstPage).toBe('');
});

Then('a screen reader hears {string}, with the focus on the content', async (world: PortalWorld, text: string) => {
  await expect.poll(() => spoken(world).textContent()).toBe(text);
  expect(await world.page.evaluate(() => document.activeElement?.id)).toBe('main');
});

Given('the admin has the connection page of {instance} open', async (world: PortalWorld, slug: string) => {
  await instancePage(world, slug, 'connection');
});

When('the admin goes to the access page of {instance}', async (world: PortalWorld, _slug: string) => {
  await world.page.getByRole('navigation', { name: 'Endpoint sections' }).getByRole('link', { name: 'Access' }).click();
});

Then('a screen reader hears {string}', async (world: PortalWorld, text: string) => {
  await expect.poll(() => spoken(world).textContent()).toBe(text);
});

// ── the menu ──

When('the admin opens the rules of {instance}', async (world: PortalWorld, slug: string) => {
  await instancePage(world, slug, 'rules');
});

Then(
  'the menu {string} marks {instance} as the current page, and {string} is not marked',
  async (world: PortalWorld, menu: string, slug: string, other: string) => {
    const nav = world.page.getByRole('navigation', { name: menu });
    expect(await nav.getByRole('link', { name: `/${slug}` }).getAttribute('aria-current')).toBe('page');
    expect(await nav.getByRole('link', { name: other, exact: true }).getAttribute('aria-current')).toBeNull();
    await seen(world.page.getByRole('navigation', { name: 'Endpoint sections' }));
  },
);

Given('the admin has the overview open on a small screen, with the menu open', async (world: PortalWorld) => {
  await world.page.setViewportSize({ width: 400, height: 800 });
  await world.openAsAdmin('/');
  await world.page.getByRole('button', { name: 'Menu' }).click();
  await seen(mainMenu(world).getByRole('link', { name: 'Audit Log' }));
});

When('the admin hits Escape in the menu', async (world: PortalWorld) => {
  await mainMenu(world).getByRole('link', { name: 'Audit Log' }).focus();
  await world.page.keyboard.press('Escape');
});

Then('the menu is closed, with the focus on {string}', async (world: PortalWorld, name: string) => {
  const toggle = world.page.getByRole('button', { name });
  await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
  expect(await focusedName(world.page)).toBe(name);
});

// ── dialogs ──

When('the admin opens the add dialog on the user list', async (world: PortalWorld) => {
  await world.openAsAdmin('/settings/users');
  await world.page.getByRole('button', { name: 'Add user' }).click();
  await seen(dialog(world));
});

Then('the focus is on {string}', async (world: PortalWorld, name: string) => {
  await expect.poll(() => focusedName(world.page)).toBe(name);
});

Then(
  'Tab from the last control goes to {string}, and the page behind the dialog is inert',
  async (world: PortalWorld, name: string) => {
    await dialog(world).getByRole('button', { name: 'Cancel' }).focus();
    await world.page.keyboard.press('Tab');
    expect(await focusedName(world.page)).toBe(name);
    expect(await world.page.locator('#app').getAttribute('inert')).not.toBeNull();
  },
);

When('the admin hits Escape twice', async (world: PortalWorld) => {
  await world.page.keyboard.press('Escape');
  await expect.poll(() => world.page.getByRole('button', { name: 'Close help' }).count()).toBe(0);
  world.noted.afterFirst = JSON.stringify({
    dialogs: await dialog(world).count(),
    reason: await dialog(world)
      .getByLabel(/^Reason/)
      .inputValue(),
  });
  await world.page.keyboard.press('Escape');
});

Then('the second Escape closed the dialog', async (world: PortalWorld) => {
  await expect.poll(() => dialog(world).count()).toBe(0);
});

When('the admin starts to delete {string} on the roles page', async (world: PortalWorld, role: string) => {
  await world.openAsAdmin('/settings/roles');
  await world.page.locator(`[data-role="${role}"]`).getByRole('button', { name: 'Delete' }).click();
  await seen(dialog(world));
});

// ── tabs ──

When('the admin moves through the plugin tabs with the arrow keys, Home and End', async (world: PortalWorld) => {
  await world.openAsAdmin('/plugins');
  const tabs = world.page.getByRole('tab');
  await seen(tabs.first());
  await tabs.first().focus();
  const steps: string[] = [];
  for (const key of ['ArrowRight', 'End', 'ArrowRight', 'ArrowLeft', 'Home']) {
    await world.page.keyboard.press(key);
    const picked = (await world.page.getByRole('tab', { selected: true }).textContent())?.trim() ?? '';
    const stops = await tabs.evaluateAll((all) => all.filter((t) => t.getAttribute('tabindex') === '0').length);
    steps.push(`${key}:${(await focusedName(world.page)).split(' ')[0]}:${picked.split(' ')[0]}:${stops}`);
  }
  world.noted.tabSteps = steps.join(' ');
});

Then('each key picked the expected tab, and only the picked tab takes Tab', (world: PortalWorld) => {
  expect(world.noted.tabSteps).toBe(
    'ArrowRight:Available:Available:1 End:Repositories:Repositories:1 ArrowRight:Installed:Installed:1 ' +
      'ArrowLeft:Repositories:Repositories:1 Home:Installed:Installed:1',
  );
});

When(
  'user 12 moves from {string} to the next tab of {instance} with the right arrow',
  async (world: PortalWorld, from: string, slug: string) => {
    const client = await world.apiAs('user 12');
    const mine = (await world.expectOk(client.get('/api/me/endpoints'), 'my instances')) as {
      assigned: { id: string; slug: string }[];
    };
    await world.openAs('user 12', `/my/${mine.assigned.find((e) => e.slug === slug)!.id}`);
    await world.page.getByRole('tab', { name: from }).focus();
    await world.page.keyboard.press('ArrowRight');
  },
);

Then('{string} is picked and focused, and its panel shows', async (world: PortalWorld, name: string) => {
  const tab = world.page.getByRole('tab', { name });
  await expect.poll(() => tab.getAttribute('aria-selected')).toBe('true');
  expect(await focusedName(world.page)).toBe(name);
  await seen(world.page.getByRole('tabpanel').getByText('No pre-approval rules', { exact: false }));
});

// ── option groups ──

When(
  'the admin moves from {string} to the next theme with the down arrow on their profile',
  async (world: PortalWorld, from: string) => {
    await world.openAsAdmin('/profile');
    await world.page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: from }).focus();
    await world.page.keyboard.press('ArrowDown');
  },
);

Then('the theme {string} is picked and focused, and the portal is light', async (world: PortalWorld, name: string) => {
  const radio = world.page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name });
  await expect.poll(() => radio.getAttribute('aria-checked')).toBe('true');
  expect(await focusedName(world.page)).toBe(name);
  expect(await world.page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
});

When(
  'the admin moves through the levels of {string} with the right arrow',
  async (world: PortalWorld, group: string) => {
    await instancePage(world, 'groceries', 'access');
    world.requests.length = 0;
    const levels = world.page.getByRole('radiogroup', { name: `Access for ${group}` });
    await levels.getByRole('radio', { name: 'Ask' }).focus();
    const focused: string[] = [];
    for (let i = 0; i < 2; i++) {
      await world.page.keyboard.press('ArrowRight');
      focused.push(await focusedName(world.page));
    }
    world.noted.focused = focused.join(',');
  },
);

Then(
  'the focus moved to Write and then None, and {string} is still at Ask',
  async (world: PortalWorld, group: string) => {
    expect(world.noted.focused).toBe('Write,None');
    const levels = world.page.getByRole('radiogroup', { name: `Access for ${group}` });
    expect(await levels.getByRole('radio', { name: 'Ask' }).getAttribute('aria-checked')).toBe('true');
    expect(world.requests.filter((p) => p.includes('/groups/'))).toEqual([]);
  },
);

// ── names, busy states and results ──

Then(
  'the tables are named {string}, {string} and {string}, each with an {string} column',
  async (world: PortalWorld, ...args: string[]) => {
    const column = args[3]!;
    for (const name of args.slice(0, 3)) {
      const table = world.page.getByRole('table', { name, exact: true });
      await seen(table);
      expect((await table.locator('thead th').last().textContent())?.trim()).toBe(column);
    }
  },
);

Then('the revoke of {string} is described by {string}', async (world: PortalWorld, token: string, text: string) => {
  const revoke = world.page
    .getByRole('table', { name: 'Bearer tokens' })
    .getByRole('row')
    .filter({ hasText: token })
    .getByRole('button', { name: 'Revoke' });
  expect(await description(revoke)).toBe(text);
});

When(
  'the admin saves the client auth settings, then saves them with External and no Cloudflare Access',
  async (world: PortalWorld) => {
    await world.openAsAdmin('/settings/client-auth');
    const save = world.page.getByRole('button', { name: 'Save', exact: true });
    await save.click();
    const status = world.page.getByRole('status').filter({ hasText: 'Saved.' });
    await seen(status);
    world.noted.status = (await status.textContent())?.trim() ?? '';
    await world.page
      .getByRole('group', { name: 'Enabled client auth methods' })
      .getByRole('checkbox', { name: 'External' })
      .check();
    await save.click();
  },
);

Then('a screen reader heard the status {string} and then an alert', async (world: PortalWorld, text: string) => {
  expect(world.noted.status).toBe(text);
  await seen(world.page.getByRole('alert').filter({ hasText: 'Cloudflare Access' }));
});

When(
  'the admin adds {string} to the allowed clients and then removes {string}',
  async (world: PortalWorld, added: string, removed: string) => {
    await world.openAsAdmin('/settings/client-auth');
    await world.page.getByRole('radio', { name: 'Allow only these clients' }).check();
    const names = world.page.getByLabel('Client names');
    await names.fill(added);
    await names.press('Enter');
    await expect.poll(() => spoken(world).textContent()).not.toBe('');
    world.noted.heard = (await spoken(world).textContent()) ?? '';
    await world.page.getByRole('button', { name: `Remove ${removed}` }).click();
  },
);

Then('a screen reader heard {string} and then {string}', async (world: PortalWorld, first: string, second: string) => {
  expect(world.noted.heard).toBe(first);
  await expect.poll(() => spoken(world).textContent()).toBe(second);
});

Then('every control in the rule editor has a name', async (world: PortalWorld) => {
  const { shown, missing } = await unnamed(dialog(world));
  expect(shown).toBeGreaterThan(10);
  expect(missing).toEqual([]);
});

When('the admin turns on single sign-on in the user auth settings', async (world: PortalWorld) => {
  await world.openAsAdmin('/settings/user-auth');
  const sso = world.page
    .locator('form')
    .filter({ has: world.page.getByRole('heading', { name: 'Single sign-on (OIDC)', exact: true }) });
  await sso.getByRole('checkbox', { name: 'Enabled' }).check();
  await seen(sso.getByLabel('Issuer URL'));
});

Then(
  'every single sign-on control has a name, and {string} is described by its hint',
  async (world: PortalWorld, name: string) => {
    const sso = world.page
      .locator('form')
      .filter({ has: world.page.getByRole('heading', { name: 'Single sign-on (OIDC)', exact: true }) });
    const { shown, missing } = await unnamed(sso);
    expect(shown).toBeGreaterThan(8);
    expect(missing).toEqual([]);
    expect(await description(sso.getByLabel(name))).toContain('*@');
  },
);

When('the admin opens the first event in the audit log', async (world: PortalWorld) => {
  await world.openAsAdmin('/audit');
  const first = world.page.getByRole('table', { name: 'Audit events' }).locator('tbody tr.clickable').first();
  await seen(first);
  world.noted.collapsed = (await first.getByRole('button').getAttribute('aria-expanded')) ?? '';
  await first.getByRole('button').click();
});

Then('the event says it is expanded, and its details show', async (world: PortalWorld) => {
  expect(world.noted.collapsed).toBe('false');
  const toggle = world.page.getByRole('table', { name: 'Audit events' }).locator('tbody tr.clickable button').first();
  expect(await toggle.getAttribute('aria-expanded')).toBe('true');
  const details = world.page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`);
  await seen(details.getByText('"params"', { exact: false }));
});
