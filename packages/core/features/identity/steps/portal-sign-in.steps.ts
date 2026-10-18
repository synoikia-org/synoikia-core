import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { eventually } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';
import {
  appOf,
  approvalBrowser,
  asksToSignIn,
  codeStep,
  consentCode,
  consentPage,
  consentSignIn,
  enroll,
  identity,
  keep,
  newPortal,
  passwordStep,
  wrongCode,
} from './identity.js';

const WRONG = 'not my passphrase';
const person = (user: number) => `user ${user}`;

type AuditRow = { decision: string; actorId?: string | null; detail: Record<string, unknown> | null };
const authRows = async (world: SynoikiaWorld) => (await world.audit({ kind: 'auth' })) as AuditRow[];

async function signedIn(world: SynoikiaWorld, name: string, username: string) {
  const session = await world.expectOk(identity(world).browsers.get(name)!.get('/api/session'), 'read session');
  expect(session).toMatchObject({ authenticated: true, user: { username } });
}

/** Every file of the data directory as one buffer, without the plugins. */
function dataFiles(dir: string): Buffer {
  return Buffer.concat(
    readdirSync(dir)
      .filter((name) => name !== 'plugins')
      .map((name) => path.join(dir, name))
      .map((file) => (statSync(file).isDirectory() ? dataFiles(file) : readFileSync(file))),
  );
}

// ── people and their sign-ins ──

Given('user {int} has the role {string}', async (world: SynoikiaWorld, user: number, role: string) => {
  await world.user(person(user), role);
});

When('user {int} signs in to the portal with their password', async (world: SynoikiaWorld, user: number) => {
  await passwordStep(world, person(user));
});

When('the admin signs in to the portal with their password', async (world: SynoikiaWorld) => {
  await passwordStep(world, 'admin');
});

When(
  'user {int} signs in to the portal with the password {string}',
  async (world: SynoikiaWorld, user: number, password: string) => {
    await passwordStep(world, person(user), password);
  },
);

When(
  'someone signs in to the portal as {string} with the password {string}',
  async (world: SynoikiaWorld, username: string, password: string) => {
    await passwordStep(world, username, password);
  },
);

Given('user {int} gave a wrong password {int} times', async (world: SynoikiaWorld, user: number, times: number) => {
  for (let i = 0; i < times; i++) await passwordStep(world, person(user), WRONG, 'failures');
  expect(identity(world).answer.status).toBe(401);
});

When('user {int} gives a wrong password twice more', async (world: SynoikiaWorld, user: number) => {
  for (let i = 0; i < 2; i++) await passwordStep(world, person(user), WRONG, 'failures');
});

Given(
  'someone gave a wrong password as {string} {int} times and as {string} {int} times',
  async (world: SynoikiaWorld, a: string, timesA: number, b: string, timesB: number) => {
    for (let i = 0; i < timesA; i++) await passwordStep(world, a, WRONG, 'failures');
    for (let i = 0; i < timesB; i++) await passwordStep(world, b, WRONG, 'failures');
  },
);

Given(
  'user {int} gave a wrong password once, and 4 times more 14 minutes later',
  async (world: SynoikiaWorld, user: number) => {
    await passwordStep(world, person(user), WRONG, 'failures');
    world.passTime(14 * 60_000);
    for (let i = 0; i < 4; i++) await passwordStep(world, person(user), WRONG, 'failures');
  },
);

Given('{int} minutes go by', (world: SynoikiaWorld, minutes: number) => {
  world.passTime(minutes * 60_000);
});

Then('user {int} is in the portal', async (world: SynoikiaWorld, user: number) => {
  await signedIn(world, person(user), world.person(person(user)).username);
});

Then('the admin is in the portal', async (world: SynoikiaWorld) => {
  await signedIn(world, 'admin', world.person('admin').username);
});

Then('after a sign-out, user {int} must sign in again', async (world: SynoikiaWorld, user: number) => {
  const browser = identity(world).browsers.get(person(user))!;
  await world.expectOk(browser.post('/auth/logout'), 'sign out');
  expect((await browser.get('/api/profile')).status).toBe(401);
});

Then('the sign-in is refused with {string}', (world: SynoikiaWorld, message: string) => {
  const { answer } = identity(world);
  expect(answer.status).toBeGreaterThanOrEqual(400);
  expect(answer.text).toContain(message);
});

Then('user {int} is told {string}', (world: SynoikiaWorld, _user: number, message: string) => {
  const { answer } = identity(world);
  expect(answer.status).toBeGreaterThanOrEqual(400);
  expect(answer.text).toContain(message);
});

// ── the consent page ──

Given(
  'someone gave a wrong password as {string} {int} times on the consent page',
  async (world: SynoikiaWorld, username: string, times: number) => {
    await consentPage(world);
    for (let i = 0; i < times; i++) await consentSignIn(world, username, WRONG);
    expect(identity(world).answer.status).toBe(401);
  },
);

When('the admin signs in on the consent page with their password', async (world: SynoikiaWorld) => {
  await consentSignIn(world, 'admin');
});

Given('user {int} gave their password on the consent page', async (world: SynoikiaWorld, user: number) => {
  const page = await consentSignIn(world, person(user));
  expect(page.html).toContain('name="mfa"');
});

When('user {int} gives a wrong code on the consent page', async (world: SynoikiaWorld, user: number) => {
  await consentCode(world, wrongCode(world, person(user)));
  expect(identity(world).answer.status).toBe(401);
});

// ── the budget of one address ──

Given('people sign in from the address {string}', async (world: SynoikiaWorld, address: string) => {
  await world.publicMcpAddress();
  await world.restartCore({ TRUST_PROXY: '1' });
  identity(world).address = address;
});

Given('someone tried to sign in {int} times', async (world: SynoikiaWorld, times: number) => {
  const browser = await newPortal(world);
  for (let i = 0; i < times; i++) {
    const res = await browser.post('/auth/login', { username: 'ghost', password: WRONG });
    expect(res.status).not.toBe(200);
  }
});

Given(
  'user {int} gave their password in the portal, and someone then tried to sign in {int} times',
  async (world: SynoikiaWorld, user: number, times: number) => {
    await passwordStep(world, person(user));
    expect(identity(world).answer.body.status).toBe('totp_required');
    const browser = await newPortal(world);
    for (let i = 0; i < times; i++) await browser.post('/auth/login', { username: 'ghost', password: WRONG });
  },
);

When(
  'sign-up, client registration, the consent page and the connection test are each tried',
  async (world: SynoikiaWorld) => {
    const s = identity(world);
    const from = { 'x-forwarded-for': s.address! };
    const instance = await world.tasksInstance('tasks');
    await consentPage(world);
    const signUp = await (
      await newPortal(world)
    ).post('/auth/register', { username: 'new.person', password: 'new person passphrase' });
    const registration = await fetch(`${world.mcpBase}/oauth/register`, {
      method: 'POST',
      headers: { ...from, 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Other Chat', redirect_uris: ['http://127.0.0.1:9/other'] }),
    });
    const consent = await consentSignIn(world, person(12));
    const test = await world.admin.post(`/api/instances/${instance}/connection/test`, {}, from);
    s.answer = {
      status: 0,
      text: '',
      body: { statuses: [signUp.status, registration.status, consent.status, test.status] },
    };
  },
);

Then('each one is refused as too many attempts', (world: SynoikiaWorld) => {
  expect(identity(world).answer.body.statuses).toEqual([429, 429, 429, 429]);
});

// ── the audit log and the notification of a lock ──

Then(
  'the audit log shows a failed sign-in of user {int} from {string}',
  async (world: SynoikiaWorld, user: number, address: string) => {
    const rows = (await authRows(world)).filter((r) => r.decision === 'login_failed');
    expect(rows.map((r) => r.detail)).toContainEqual({ username: world.person(person(user)).username, ip: address });
  },
);

Given('the admin gets a notification when a sign-in is locked', async (world: SynoikiaWorld) => {
  identity(world).inbox = await world.notificationInbox(['auth.lockout']);
});

Then('the audit log shows that the fifth failure locked user {int}', async (world: SynoikiaWorld, user: number) => {
  const { username } = world.person(person(user));
  const mine = (await authRows(world)).filter((r) => r.detail?.username === username);
  expect(mine.filter((r) => r.decision === 'login_failed')).toHaveLength(4);
  expect(mine.filter((r) => r.decision === 'login_locked')).toHaveLength(1);
});

Then('the admin got one notification {string}', async (world: SynoikiaWorld, title: string) => {
  const inbox = identity(world).inbox!;
  await eventually(() => inbox.length > 0, 'a notification');
  await new Promise((r) => setTimeout(r, 300));
  expect(inbox.map((n) => n.title)).toEqual([title]);
});

Then('the audit log shows a failed code of user {int}', async (world: SynoikiaWorld, user: number) => {
  const { username } = world.person(person(user));
  const rows = (await authRows(world)).filter((r) => r.decision === 'totp_failed');
  expect(rows.map((r) => r.detail?.username)).toContain(username);
});

// ── the authenticator app and the code step ──

Given('user {int} has an authenticator app', async (world: SynoikiaWorld, user: number) => {
  await enroll(world, person(user));
});

Given('user {int} has an authenticator app and 10 recovery codes', async (world: SynoikiaWorld, user: number) => {
  const app = await enroll(world, person(user));
  expect(app.recoveryCodes).toHaveLength(10);
});

Given('user {int} set up an authenticator app 2 minutes ago', async (world: SynoikiaWorld, user: number) => {
  await enroll(world, person(user));
  world.passTime(2 * 60_000);
});

Given(
  'user {int} gave their password in the portal and was asked for a code',
  async (world: SynoikiaWorld, user: number) => {
    await passwordStep(world, person(user));
    expect(identity(world).answer.body).toEqual({ status: 'totp_required' });
  },
);

Given('user {int} signed in with the current code in another browser', async (world: SynoikiaWorld, user: number) => {
  await passwordStep(world, person(user), undefined, 'other browser');
  await codeStep(world, person(user), world.totpCode(appOf(world, person(user)).secret), 'other browser');
  expect(identity(world).answer.body).toEqual({ status: 'ok' });
});

Given('user {int} gave their password and then a wrong code 5 times', async (world: SynoikiaWorld, user: number) => {
  await passwordStep(world, person(user));
  for (let i = 0; i < 5; i++) await codeStep(world, person(user), wrongCode(world, person(user)));
  expect(identity(world).answer.status).toBe(401);
});

When('user {int} gives the current code', async (world: SynoikiaWorld, user: number) => {
  await codeStep(world, person(user), world.totpCode(appOf(world, person(user)).secret));
});

When('user {int} gives the code that confirmed the app', async (world: SynoikiaWorld, user: number) => {
  await codeStep(world, person(user), appOf(world, person(user)).enrollCode);
});

When('user {int} gives the code from 30 seconds ago', async (world: SynoikiaWorld, user: number) => {
  await codeStep(world, person(user), world.totpCode(appOf(world, person(user)).secret, -1));
});

When('user {int} gives the code from a minute ago', async (world: SynoikiaWorld, user: number) => {
  await codeStep(world, person(user), world.totpCode(appOf(world, person(user)).secret, -2));
});

When('user {int} gives the same code again', async (world: SynoikiaWorld, user: number) => {
  await codeStep(world, person(user), identity(world).lastCode!);
});

When('user {int} gives the code {string}', async (world: SynoikiaWorld, user: number, code: string) => {
  await codeStep(world, person(user), code);
});

When('user {int} gives their first recovery code', async (world: SynoikiaWorld, user: number) => {
  await codeStep(world, person(user), appOf(world, person(user)).recoveryCodes[0]!);
});

Then(
  'user {int} is in the portal, and the first recovery code does not work again',
  async (world: SynoikiaWorld, user: number) => {
    const who = world.person(person(user));
    await signedIn(world, person(user), who.username);
    await passwordStep(world, person(user), undefined, 'again');
    await codeStep(world, person(user), appOf(world, person(user)).recoveryCodes[0]!, 'again');
    expect(identity(world).answer.status).toBe(401);
  },
);

Then(
  'the audit log shows that user {int} used a recovery code, with 9 left',
  async (world: SynoikiaWorld, user: number) => {
    const rows = (await authRows(world)).filter((r) => r.decision === 'recovery_code_used');
    expect(rows.map((r) => [r.actorId, r.detail])).toEqual([[world.person(person(user)).id, { remaining: 9 }]]);
  },
);

// ── setting up and turning off the app ──

When(
  'user {int} sets up an authenticator app and confirms it with a current code',
  async (world: SynoikiaWorld, user: number) => {
    await enroll(world, person(user), 0);
  },
);

When(
  'user {int} sets up an authenticator app and confirms it with a wrong code',
  async (world: SynoikiaWorld, user: number) => {
    const portal = world.person(person(user)).portal!;
    const begun = await world.expectOk(portal.post('/api/profile/totp/begin'), 'start two-factor setup');
    const app = { secret: begun.secret as string, enrollCode: '', uri: '', recoveryCodes: [] };
    identity(world).apps.set(person(user), app);
    await keep(world, portal.post('/api/profile/totp/confirm', { code: wrongCode(world, person(user)) }));
  },
);

When('user {int} starts to set up another authenticator app', async (world: SynoikiaWorld, user: number) => {
  await keep(world, world.person(person(user)).portal!.post('/api/profile/totp/begin'));
});

When(
  'user {int} turns off their authenticator app with the current code',
  async (world: SynoikiaWorld, user: number) => {
    const code = world.totpCode(appOf(world, person(user)).secret);
    await keep(world, world.person(person(user)).portal!.post('/api/profile/totp/disable', { code }));
  },
);

When('user {int} turns off their authenticator app with a wrong code', async (world: SynoikiaWorld, user: number) => {
  const code = wrongCode(world, person(user));
  await keep(world, world.person(person(user)).portal!.post('/api/profile/totp/disable', { code }));
});

Then('the app shows the account {string}', (world: SynoikiaWorld, account: string) => {
  const { uri } = appOf(world, person(12));
  expect(decodeURIComponent(new URL(uri).pathname.replace(/^\/+/, ''))).toBe(account);
});

Then('two-factor sign-in is on for user {int}', async (world: SynoikiaWorld, user: number) => {
  const me = await world.expectOk(world.person(person(user)).portal!.get('/api/profile'), 'read profile');
  expect(me.totpEnabled).toBe(true);
});

Then('two-factor sign-in is off for user {int}', async (world: SynoikiaWorld, user: number) => {
  const me = await world.expectOk(world.person(person(user)).portal!.get('/api/profile'), 'read profile');
  expect(me.totpEnabled).toBe(false);
});

Then('the data directory does not hold the secret of the app as plain text', (world: SynoikiaWorld) => {
  const { secret } = appOf(world, person(12));
  expect(dataFiles(world.dataDir).includes(secret)).toBe(false);
});

Then('user {int} must set up an authenticator app before anything else', async (world: SynoikiaWorld, user: number) => {
  expect(identity(world).answer.body).toEqual({ status: 'ok', mustEnrollTotp: true });
  const res = await identity(world).browsers.get(person(user))!.get('/api/me/endpoints');
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ message: 'Set up two-factor authentication first' });
});

// ── approval browsers and the reset of an app ──

Given('user {int} is signed in on an approval page', async (world: SynoikiaWorld, user: number) => {
  await approvalBrowser(world, person(user));
});

Then('the approval browser of user {int} must sign in again', async (world: SynoikiaWorld, _user: number) => {
  const { browser, path: link } = identity(world).approval!;
  expect(asksToSignIn(await browser.send(link))).toBe(true);
});

When('the admin resets the authenticator app of user {int}', async (world: SynoikiaWorld, user: number) => {
  await world.expectOk(
    world.admin.post(`/api/users/${world.person(person(user)).id}/reset-totp`),
    'reset two-factor sign-in',
  );
});

Then(
  'user {int} signs in with the password alone, and the approval browser must sign in again',
  async (world: SynoikiaWorld, user: number) => {
    await passwordStep(world, person(user));
    expect(identity(world).answer.body).toEqual({ status: 'ok', mustEnrollTotp: false });
    const { browser, path: link } = identity(world).approval!;
    expect(asksToSignIn(await browser.send(link))).toBe(true);
  },
);

Then(
  'the audit log shows that the admin reset the authenticator app of user {int}',
  async (world: SynoikiaWorld, user: number) => {
    const rows = (await authRows(world)).filter((r) => r.decision === 'totp_reset');
    expect(rows.map((r) => [r.actorId, r.detail])).toEqual([
      [world.person('admin').id, { username: world.person(person(user)).username }],
    ]);
  },
);
