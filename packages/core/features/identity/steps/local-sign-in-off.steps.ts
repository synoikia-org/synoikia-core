import { Given, Then } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { consentPage, identity } from './identity.js';

const passwordSignIn = (world: SynoikiaWorld, on: boolean) =>
  world.admin.put('/api/settings/security', { disableLocalLogin: !on });

Given('password sign-in is off', async (world: SynoikiaWorld) => {
  await world.expectOk(passwordSignIn(world, false), 'turn off password sign-in');
});

Given('the admin turned off password sign-in, with no single sign-on set up', async (world: SynoikiaWorld) => {
  const settings = (await world.expectOk(world.admin.get('/api/settings'), 'read settings')) as {
    oidc: { enabled?: boolean } | null;
  };
  expect(settings.oidc?.enabled ?? false).toBe(false);
  await world.expectOk(passwordSignIn(world, false), 'turn off password sign-in');
});

Then(
  'user {int} is told {string} in the portal and on the consent page',
  async (world: SynoikiaWorld, user: number, message: string) => {
    expect(identity(world).answer).toMatchObject({ status: 403, body: { message } });
    const { browser, path } = await consentPage(world);
    const { username, password } = world.person(`user ${user}`);
    const csrf = browser.jar.get('syn_mcp_csrf')!;
    const posted = await browser.send('/oauth/login', { csrf, continue: path, username, password });
    expect(posted.status).toBe(401);
    expect(posted.html).toContain(`${message}.`);
  },
);
