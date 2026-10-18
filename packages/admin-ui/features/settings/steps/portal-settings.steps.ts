import type { Locator } from 'playwright';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { PortalWorld } from '../../support/world.js';

const seen = (locator: Locator) => locator.waitFor({ state: 'visible', timeout: 10_000 });
const sections = (world: PortalWorld) => world.page.getByRole('navigation', { name: 'Settings sections' });
const methods = (world: PortalWorld) => world.page.getByRole('group', { name: 'Enabled client auth methods' });
const saveAction = (world: PortalWorld) => world.page.getByRole('button', { name: 'Save', exact: true });
const policyCard = (world: PortalWorld) => world.page.locator('[data-card="clients"]');
const form = (world: PortalWorld, heading: string) =>
  world.page.locator('form').filter({ has: world.page.getByRole('heading', { name: heading, exact: true }) });
/** A port where nothing listens, on this machine. */
const NOBODY = 'http://127.0.0.1:1';

interface Settings {
  security: { sessionIdleMinutes: number; defaultRoleId: string | null };
  mcp: {
    clientAuth: Record<string, boolean>;
    cfAccess: { teamDomain: string; aud: string };
    clientPolicy: { mode: string; names: string[] };
  };
  audit: { retentionDays: number | null };
  oidc: { enabled: boolean; issuer: string } | null;
}

async function settings(world: PortalWorld) {
  return (await world.expectOk((await world.adminApi()).get('/api/settings'), 'settings')) as unknown as Settings;
}

export async function clientAuth(world: PortalWorld) {
  await world.openAsAdmin('/settings/client-auth');
  await seen(methods(world));
}

export async function userAuth(world: PortalWorld) {
  await world.openAsAdmin('/settings/user-auth');
  await seen(form(world, 'Sign-in'));
}

/** The admin turns on External, saves, and the save is answered. */
export async function saveExternal(world: PortalWorld) {
  await methods(world).getByRole('checkbox', { name: 'External' }).check();
  await saveAction(world).click();
}

// ── sections ──

When('the admin opens the settings', async (world: PortalWorld) => {
  await world.openAsAdmin('/');
  await world.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
  await seen(sections(world));
});

Then(
  'the sections are {string}, {string}, {string}, {string}, {string} and {string}',
  async (world: PortalWorld, ...names: string[]) => {
    const links = (await sections(world).getByRole('link').allTextContents()).map((t) => t.trim());
    expect(links).toEqual(names.slice(0, 6));
  },
);

Then('{string} is open', async (world: PortalWorld, name: string) => {
  await expect.poll(() => new URL(world.page.url()).pathname).toBe(`/settings/${name.toLowerCase().replace(' ', '-')}`);
  await seen(sections(world).locator('a.active', { hasText: name }));
});

When('the admin follows an old link to {string}', async (world: PortalWorld, path: string) => {
  await world.openAsAdmin(path);
});

Then('the portal shows the {string} section', async (world: PortalWorld, name: string) => {
  await expect.poll(() => new URL(world.page.url()).pathname).toBe(`/settings/${name.toLowerCase().replace(' ', '-')}`);
  await seen(sections(world).locator('a.active', { hasText: name }));
});

Then('the portal shows the profile of the admin', async (world: PortalWorld) => {
  await seen(world.page.getByRole('heading', { name: 'My profile', level: 1 }));
  expect(new URL(world.page.url()).pathname).toBe('/profile');
  expect(await sections(world).count()).toBe(0);
});

// ── client auth ──

When('the admin turns off every client auth method', async (world: PortalWorld) => {
  await clientAuth(world);
  for (const box of await methods(world).getByRole('checkbox').all()) await box.uncheck();
});

Then('the settings warn {string}', async (world: PortalWorld, text: string) => {
  await seen(world.page.locator('[data-warn="no-method"]').filter({ hasText: text }));
});

Then('the client auth settings cannot be saved', async (world: PortalWorld) => {
  expect(await saveAction(world).isDisabled()).toBe(true);
});

When('the admin turns on External and saves the client auth settings', async (world: PortalWorld) => {
  await clientAuth(world);
  await saveExternal(world);
});

Then('the settings show the alert {string}', async (world: PortalWorld, text: string) => {
  await seen(world.page.getByRole('alert').filter({ hasText: text }));
});

When(
  'the admin turns on External with the team {string} and the audience {string} and saves',
  async (world: PortalWorld, team: string, aud: string) => {
    await clientAuth(world);
    await methods(world).getByRole('checkbox', { name: 'External' }).check();
    await world.page.getByLabel('Cloudflare team domain').fill(team);
    await world.page.getByLabel('Application audience (AUD)').fill(aud);
    await saveAction(world).click();
  },
);

Then('the client auth settings say {string}', async (world: PortalWorld, text: string) => {
  await seen(world.page.getByRole('status').filter({ hasText: text }));
});

Then('the server accepts External from the team {string}', async (world: PortalWorld, team: string) => {
  const { mcp } = await settings(world);
  expect(mcp.clientAuth.external).toBe(true);
  expect(mcp.cfAccess.teamDomain).toBe(team);
});

// ── client policy ──

When('the admin opens the client auth settings', async (world: PortalWorld) => {
  await clientAuth(world);
});

Then('the client policy warns that it {string}', async (world: PortalWorld, text: string) => {
  await seen(policyCard(world).getByRole('note').filter({ hasText: text }));
});

When('the admin allows only listed clients and lists none', async (world: PortalWorld) => {
  await clientAuth(world);
  await policyCard(world).getByRole('radio', { name: 'Allow only these clients' }).check();
});

Then('the client policy warns {string}', async (world: PortalWorld, text: string) => {
  await seen(policyCard(world).locator('[data-warn="no-client"]').filter({ hasText: text }));
});

When('the admin allows only the client {string} and saves', async (world: PortalWorld, name: string) => {
  await clientAuth(world);
  await policyCard(world).getByRole('radio', { name: 'Allow only these clients' }).check();
  await world.page.getByLabel('Client names').fill(name);
  await world.page.getByLabel('Client names').press('Enter');
  await saveAction(world).click();
  await seen(world.page.getByRole('status').filter({ hasText: 'Saved.' }));
});

Then('the server allows only the client {string}', async (world: PortalWorld, name: string) => {
  expect((await settings(world)).mcp.clientPolicy).toMatchObject({ mode: 'allow', names: [name] });
});

// ── user auth ──

When(
  'the admin makes new accounts administrators and types {string}, then {string}',
  async (world: PortalWorld, first: string, second: string) => {
    await userAuth(world);
    const registration = form(world, 'Self-registration');
    await world.page.getByLabel('Default role of new accounts').selectOption('admin');
    const roles: string[] = [];
    for (const typed of [first, second]) {
      await registration.getByRole('button', { name: 'Save' }).click();
      await world.page.getByRole('dialog').getByRole('textbox').fill(typed);
      const answered = typed === 'ADMIN' ? world.page.waitForResponse((r) => r.request().method() === 'PUT') : null;
      await world.answerQuestion('Save');
      await answered;
      roles.push(String((await settings(world)).security.defaultRoleId));
    }
    world.noted.roles = roles.join(',');
  },
);

Then('new accounts get the role {string} only after {string}', (world: PortalWorld) => {
  expect(world.noted.roles).toBe('null,admin');
});

When(
  'the admin picks {string} for new accounts, sets the idle timeout to {int} and saves only the sign-in section',
  async (world: PortalWorld, _role: string, minutes: number) => {
    await userAuth(world);
    await world.page.getByLabel('Default role of new accounts').selectOption('admin');
    await world.page.getByLabel('Session idle timeout (minutes)').fill(String(minutes));
    await form(world, 'Sign-in').getByRole('button', { name: 'Save' }).click();
    await seen(form(world, 'Sign-in').getByRole('status').filter({ hasText: 'Saved.' }));
  },
);

Then('the server ends idle sessions after {int} minutes', async (world: PortalWorld, minutes: number) => {
  expect((await settings(world)).security.sessionIdleMinutes).toBe(minutes);
});

Then('new accounts still get no role', async (world: PortalWorld) => {
  expect((await settings(world)).security.defaultRoleId).toBeNull();
  expect(await world.page.getByRole('dialog').count()).toBe(0);
});

When(
  'the admin types the issuer {string} and the client {string} for single sign-on, turns it off and on, then off and saves',
  async (world: PortalWorld, issuer: string, client: string) => {
    await userAuth(world);
    const sso = form(world, 'Single sign-on (OIDC)');
    const enabled = sso.getByRole('checkbox', { name: 'Enabled' });
    await enabled.check();
    await sso.getByLabel('Issuer URL').fill(issuer);
    await sso.getByLabel('Client ID').fill(client);
    await enabled.uncheck();
    await enabled.check();
    world.noted.issuer = await sso.getByLabel('Issuer URL').inputValue();
    await enabled.uncheck();
    await sso.getByRole('button', { name: 'Save' }).click();
    await seen(sso.getByRole('status').filter({ hasText: 'Saved.' }));
  },
);

Then('the issuer still said {string} after the second turn on', (world: PortalWorld, issuer: string) => {
  expect(world.noted.issuer).toBe(issuer);
});

Then('single sign-on is off on the server, with that issuer', async (world: PortalWorld) => {
  expect((await settings(world)).oidc).toMatchObject({ enabled: false, issuer: world.noted.issuer });
});

// ── server settings ──

When('the admin sets the audit log retention to {int} days', async (world: PortalWorld, days: number) => {
  await world.openAsAdmin('/settings/server');
  const retention = world.page.getByLabel('Delete entries older than (days)');
  await seen(retention);
  world.noted.retentionHelp = (await world.page.locator('#a-ret-help').textContent()) ?? '';
  await retention.fill(String(days));
  await world.page.getByRole('button', { name: 'Save' }).click();
  await seen(world.page.getByRole('status').filter({ hasText: 'Saved.' }));
});

Then('the retention said {string} before', (world: PortalWorld, text: string) => {
  expect(world.noted.retentionHelp).toContain(text);
});

Then('the server keeps the audit log for {int} days', async (world: PortalWorld, days: number) => {
  expect((await settings(world)).audit.retentionDays).toBe(days);
});

// ── notification channels ──

async function channel(world: PortalWorld, name: string) {
  await world.expectOk(
    (await world.adminApi()).post('/api/notifiers', {
      kind: 'ntfy',
      name,
      config: { server: NOBODY, topic: 'acme-phone' },
      events: ['instance.error'],
    }),
    'add a channel',
  );
}

const channelRow = (world: PortalWorld, name: string) =>
  world.page.getByRole('table', { name: 'Notification channels' }).getByRole('row').filter({ hasText: name });

async function notifications(world: PortalWorld, name: string) {
  await world.openAsAdmin('/settings/notifications');
  await seen(channelRow(world, name));
}

Given('the notification channel {string}', async (world: PortalWorld, name: string) => {
  await channel(world, name);
});

Given('the notification channel {string}, which nothing answers', async (world: PortalWorld, name: string) => {
  await channel(world, name);
});

When('the admin deletes {string} and confirms the question', async (world: PortalWorld, name: string) => {
  await notifications(world, name);
  await channelRow(world, name).getByRole('button', { name: 'Delete' }).click();
  await world.answerQuestion('Delete');
});

Then('there are no notification channels', async (world: PortalWorld) => {
  await expect
    .poll(
      async () =>
        ((await world.expectOk((await world.adminApi()).get('/api/notifiers'), 'channels')) as unknown as []).length,
    )
    .toBe(0);
});

When('the admin tests {string}', async (world: PortalWorld, name: string) => {
  await notifications(world, name);
  await channelRow(world, name).getByRole('button', { name: 'Test' }).click();
});
