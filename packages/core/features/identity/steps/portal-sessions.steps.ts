import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import {
  approvalLink,
  asksToSignIn,
  consentPage,
  consentSignIn,
  identity,
  keep,
  newPortal,
  passwordStep,
} from './identity.js';

const person = (user: number) => `user ${user}`;

const statuses = new WeakMap<SynoikiaWorld, number[]>();

/** The session cookie of the consent page or the approval page, as the browser keeps it. */
const sessionOf = (jar: Map<string, string>, cookie: 'syn_mcp_oauth' | 'syn_mcp_approve') => {
  const raw = jar.get(cookie);
  if (!raw) throw new Error(`the browser has no ${cookie}`);
  return raw;
};

const portalStatus = async (world: SynoikiaWorld, user: number) =>
  (await world.person(person(user)).portal!.get('/api/profile')).status;

const securitySettings = async (world: SynoikiaWorld) =>
  (await world.expectOk(world.admin.get('/api/settings'), 'read settings')).security as Record<string, unknown>;

const roleNames = async (world: SynoikiaWorld) =>
  ((await world.expectOk(world.admin.get('/api/roles'), 'list roles')) as unknown as { name: string }[]).map(
    (r) => r.name,
  );

// ── idle and total limits ──

When(
  'user {int} comes back to the portal after {int} idle minutes',
  async (world: SynoikiaWorld, user: number, minutes: number) => {
    world.passTime(minutes * 60_000);
    statuses.set(world, [await portalStatus(world, user)]);
  },
);

Then('user {int} is still signed in', (world: SynoikiaWorld, _user: number) => {
  expect(statuses.get(world)).toEqual([200]);
});

Then('user {int} must sign in again', (world: SynoikiaWorld, _user: number) => {
  expect(statuses.get(world)).toEqual([401]);
});

When(
  'user {int} uses the portal every {int} minutes for {int} hours',
  async (world: SynoikiaWorld, user: number, every: number, hours: number) => {
    const seen: number[] = [];
    for (let t = every; t <= hours * 60; t += every) {
      world.passTime(every * 60_000);
      seen.push(await portalStatus(world, user));
    }
    statuses.set(world, seen);
  },
);

Then(
  'user {int} stays signed in until the 12th hour, and must then sign in again',
  (world: SynoikiaWorld, _user: number) => {
    const seen = statuses.get(world)!;
    expect(seen.slice(0, -1).every((s) => s === 200)).toBe(true);
    expect(seen.at(-1)).toBe(401);
  },
);

When(
  'the admin tries the idle limits {int} and {int} minutes, and the total limits {int} and {int} hours',
  async (world: SynoikiaWorld, idleLow: number, idleHigh: number, totalLow: number, totalHigh: number) => {
    const tries = [
      { sessionIdleMinutes: idleLow },
      { sessionIdleMinutes: idleHigh },
      { sessionAbsoluteHours: totalLow },
      { sessionAbsoluteHours: totalHigh },
    ];
    const seen: number[] = [];
    for (const change of tries) seen.push((await world.admin.put('/api/settings/security', change)).status);
    statuses.set(world, seen);
  },
);

Then('the admin is told each time that the limit is out of bounds', async (world: SynoikiaWorld) => {
  expect(statuses.get(world)).toEqual([400, 400, 400, 400]);
  expect(await securitySettings(world)).toMatchObject({ sessionIdleMinutes: 30, sessionAbsoluteHours: 12 });
});

When(
  'the admin sets the idle limits {int} and {int} minutes, and the total limits {int} and {int} hours',
  async (world: SynoikiaWorld, idleLow: number, idleHigh: number, totalLow: number, totalHigh: number) => {
    for (const change of [
      { sessionIdleMinutes: idleLow },
      { sessionIdleMinutes: idleHigh },
      { sessionAbsoluteHours: totalLow },
      { sessionAbsoluteHours: totalHigh },
    ])
      await world.expectOk(world.admin.put('/api/settings/security', change), 'set a session limit');
  },
);

Then(
  'the admin sees the idle limit {int} minutes and the total limit {int} hours',
  async (world: SynoikiaWorld, idle: number, total: number) => {
    expect(await securitySettings(world)).toMatchObject({ sessionIdleMinutes: idle, sessionAbsoluteHours: total });
  },
);

// ── the kinds of sign-in ──

Given('user {int} signed in on the consent page', async (world: SynoikiaWorld, user: number) => {
  const page = await consentSignIn(world, person(user));
  expect(page.status).toBe(303);
});

When('the session of the consent page is taken to the portal', async (world: SynoikiaWorld) => {
  const portal = await newPortal(world);
  portal.jar.set('syn_admin', sessionOf(identity(world).consent!.browser.jar, 'syn_mcp_oauth'));
  await keep(world, portal.get('/api/session'));
});

Then('the portal asks for a sign-in', (world: SynoikiaWorld) => {
  expect(identity(world).answer.body).toMatchObject({ authenticated: false });
});

When('the session of the approval page is taken to the consent page', async (world: SynoikiaWorld) => {
  const raw = sessionOf(identity(world).approval!.browser.jar, 'syn_mcp_approve');
  const { path } = await consentPage(world);
  const browser = world.pageBrowser();
  browser.jar.set('syn_mcp_oauth', raw);
  identity(world).answer = { status: 0, text: (await browser.send(path)).html, body: {} };
});

Then('the consent page asks for a sign-in', (world: SynoikiaWorld) => {
  expect(identity(world).answer.text).toContain('Sign in to let Acme Chat use your MCP endpoints.');
});

When('the session of the consent page is taken to an approval page', async (world: SynoikiaWorld) => {
  const raw = sessionOf(identity(world).consent!.browser.jar, 'syn_mcp_oauth');
  const link = await approvalLink(world);
  const browser = world.pageBrowser();
  browser.jar.set('syn_mcp_approve', raw);
  identity(world).answer = { status: 0, text: (await browser.send(link)).html, body: {} };
});

Then('the approval page asks for a sign-in', (world: SynoikiaWorld) => {
  expect(asksToSignIn({ status: 0, csp: '', cookies: [], html: identity(world).answer.text })).toBe(true);
});

// ── password changes and disabled users ──

Given('user {int} is signed in to the portal in a second browser', async (world: SynoikiaWorld, user: number) => {
  await passwordStep(world, person(user), undefined, 'second');
  expect(identity(world).answer.status).toBe(200);
});

Given(
  'user {int} let the app {string} use the instance {string}',
  async (world: SynoikiaWorld, user: number, _app: string, slug: string) => {
    await world.setRoleInstances('family', [slug]);
    await consentSignIn(world, person(user));
    const { browser, path } = identity(world).consent!;
    const page = await browser.send(path);
    const form = /name="form" value="([^"]+)"/.exec(page.html)?.[1];
    const resource = /name="resource" value="([^"]+)"/.exec(page.html)?.[1];
    if (!form || !resource) throw new Error(`no consent form: ${page.html}`);
    const done = await browser.send('/oauth/consent', { form, resource, access: 'read', decision: 'approve' });
    expect(done.location).toMatch(/^http:\/\/127\.0\.0\.1:9\/callback\?code=/);
  },
);

When('user {int} changes their password in their first browser', async (world: SynoikiaWorld, user: number) => {
  const who = world.person(person(user));
  const newPassword = `${who.password} changed`;
  await world.expectOk(
    who.portal!.post('/api/profile/password', { currentPassword: who.password, newPassword }),
    'change password',
  );
  who.password = newPassword;
});

When('user {int} changes their password with a wrong current password', async (world: SynoikiaWorld, user: number) => {
  const who = world.person(person(user));
  await keep(
    world,
    who.portal!.post('/api/profile/password', {
      currentPassword: 'not my passphrase',
      newPassword: 'a new long passphrase',
    }),
  );
});

When('the admin sets a new password for user {int}', async (world: SynoikiaWorld, user: number) => {
  const who = world.person(person(user));
  await world.expectOk(
    world.admin.patch(`/api/users/${who.id}`, { password: 'set by the admin, long enough' }),
    'set password',
  );
});

Then('only the first browser of user {int} stays signed in', async (world: SynoikiaWorld, user: number) => {
  expect(await portalStatus(world, user)).toBe(200);
  expect((await identity(world).browsers.get('second')!.get('/api/profile')).status).toBe(401);
});

Then(
  'the admin sees that the grant of {string} for user {int} is revoked',
  async (world: SynoikiaWorld, app: string, user: number) => {
    const grants = (await world.expectOk(world.admin.get('/api/oauth/grants'), 'list grants')) as unknown as {
      revokedAt: string | null;
      client: { name: string };
      user: { username: string };
    }[];
    const mine = grants.filter((g) => g.client.name === app && g.user.username === world.person(person(user)).username);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.revokedAt).not.toBeNull();
  },
);

Then('no browser of user {int} stays signed in', async (world: SynoikiaWorld, user: number) => {
  expect(await portalStatus(world, user)).toBe(401);
  expect((await identity(world).browsers.get('second')!.get('/api/profile')).status).toBe(401);
});

Then('user {int} still signs in with the old password', async (world: SynoikiaWorld, user: number) => {
  await passwordStep(world, person(user));
  expect(identity(world).answer.body).toMatchObject({ status: 'ok' });
});

Then('the open portal of user {int} stops working', async (world: SynoikiaWorld, user: number) => {
  expect(await portalStatus(world, user)).toBe(401);
});

// ── changes from another website ──

When(
  'a page on another website sends a new role {string} in the browser of the admin',
  async (world: SynoikiaWorld, name: string) => {
    await keep(world, world.admin.post('/api/roles', { name }, { origin: 'https://evil.example' }));
  },
);

When(
  'the admin sends a new role {string} without the anti-forgery token of the portal',
  async (world: SynoikiaWorld, name: string) => {
    await keep(world, world.admin.post('/api/roles', { name }, { 'x-csrf-token': '' }));
  },
);

Then(
  'the change is refused as cross-origin, and there is no role {string}',
  async (world: SynoikiaWorld, name: string) => {
    expect(identity(world).answer).toMatchObject({ status: 403, body: { error: 'bad_origin' } });
    expect(await roleNames(world)).not.toContain(name);
  },
);

Then(
  'the change is refused for a missing token, and there is no role {string}',
  async (world: SynoikiaWorld, name: string) => {
    expect(identity(world).answer).toMatchObject({ status: 403, body: { error: 'csrf' } });
    expect(await roleNames(world)).not.toContain(name);
  },
);

When('the admin adds the role {string} in the portal', async (world: SynoikiaWorld, name: string) => {
  await world.expectOk(world.admin.post('/api/roles', { name }), 'add role');
});

Then('the admin sees the role {string}', async (world: SynoikiaWorld, name: string) => {
  expect(await roleNames(world)).toContain(name);
});
