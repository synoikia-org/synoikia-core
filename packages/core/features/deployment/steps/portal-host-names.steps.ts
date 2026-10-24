import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { rawRequest } from './requests.js';

const answers = new WeakMap<SynoikiaWorld, { status: number; text: string }[]>();

When(
  'someone makes the first account {string} through the host name {string}',
  async (world: SynoikiaWorld, username: string, host: string) => {
    // A rebinding page is same-origin to the browser, so it holds a CSRF pair of its own.
    const csrf = 'rebound-page-token';
    answers.set(world, [
      await rawRequest(world.adminBase, '/api/setup', {
        body: { username, password: 'correct horse battery' },
        headers: { host, cookie: `syn_csrf=${csrf}`, 'x-csrf-token': csrf },
      }),
    ]);
  },
);

Then('they are refused because the host name is not allowed', (world: SynoikiaWorld) => {
  const [answer] = answers.get(world)!;
  expect(answer!.status).toBe(403);
  expect(answer!.text).toContain('Host not allowed; set PUBLIC_ADMIN_URL or ADMIN_ALLOWED_HOSTS');
});

Given(
  'the operator lists the host name {string} for the portal and sets the public portal address {string}',
  async (world: SynoikiaWorld, host: string, url: string) => {
    await world.restartCore({ ADMIN_ALLOWED_HOSTS: host, PUBLIC_ADMIN_URL: url });
  },
);

When(
  'the admin opens the portal through {string}, {string}, {string} and {string}',
  async (world: SynoikiaWorld, a: string, b: string, c: string, d: string) => {
    const got = [];
    for (const host of [a, b, c, d]) got.push(await rawRequest(world.adminBase, '/api/session', { headers: { host } }));
    answers.set(world, got);
  },
);

Then('the portal answers each time', (world: SynoikiaWorld) => {
  expect(answers.get(world)!.map((a) => a.status)).toEqual([200, 200, 200, 200]);
});
