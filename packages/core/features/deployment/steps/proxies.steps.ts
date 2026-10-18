import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';

const state = new WeakMap<SynoikiaWorld, { cookies: string[] }>();
const of = (world: SynoikiaWorld) => {
  let s = state.get(world);
  if (!s) state.set(world, (s = { cookies: [] }));
  return s;
};

Given(
  'the operator trusts the proxy in front of core with the setting {string}',
  async (world: SynoikiaWorld, setting: string) => {
    await world.restartCore({ TRUST_PROXY: setting });
  },
);

When(
  'user {int} gives a wrong password, and the forwarded list says {string}',
  async (world: SynoikiaWorld, user: number, forwarded: string) => {
    const browser = await world.portalBrowser({ 'x-forwarded-for': forwarded });
    const res = await browser.post('/auth/login', {
      username: world.person(`user ${user}`).username,
      password: 'not my passphrase',
    });
    expect(res.status).toBe(401);
  },
);

When(
  'the operator restarts the server with the proxy setting {string}',
  async (world: SynoikiaWorld, setting: string) => {
    await world.stopCore();
    await world.startAgain({ TRUST_PROXY: setting });
  },
);

Then('the server does not start, because the proxy setting must be true, false or a number', (world: SynoikiaWorld) => {
  expect(world.startError).toContain('TRUST_PROXY must be true, false or a hop count (0–10)');
  expect(world.servers).toBeUndefined();
});

When(
  'user {int} signs in through a proxy that says the browser used a secure connection',
  async (world: SynoikiaWorld, user: number) => {
    const { username, password } = world.person(`user ${user}`);
    const browser = await world.portalBrowser({ 'x-forwarded-proto': 'https' });
    const res = await browser.post('/auth/login', { username, password });
    expect(res.status).toBe(200);
    of(world).cookies = res.headers.getSetCookie();
  },
);

const sessionCookie = (world: SynoikiaWorld) => {
  const cookie = of(world).cookies.find((c) => /^(__Host-)?syn_admin=/.test(c));
  expect(cookie).toBeDefined();
  return cookie!;
};

Then('the browser of user {int} keeps its sign-in only for secure connections', (world: SynoikiaWorld) => {
  const cookie = sessionCookie(world);
  expect(cookie).toMatch(/^__Host-syn_admin=/);
  expect(cookie).toMatch(/; Secure/i);
});

Then('the browser of user {int} keeps its sign-in for any connection', (world: SynoikiaWorld) => {
  const cookie = sessionCookie(world);
  expect(cookie).toMatch(/^syn_admin=/);
  expect(cookie).not.toMatch(/; Secure/i);
});
