import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { auditRows } from '../../administration/steps/administration.js';
import { clientAuth, knock, putMcp } from './client-auth.js';

type Forge = Parameters<SynoikiaWorld['gatewayAssertion']>[1];

const through = (assertion: string) => ({ 'cf-access-jwt-assertion': assertion });

/** The access gateway sends a request to "tasks" with an assertion of these claims; the answer is kept in order. */
const vouch = async (world: SynoikiaWorld, claims: Record<string, unknown>, forge: Forge = {}, slug = 'tasks') => {
  const got = await knock(world, slug, through(await world.gatewayAssertion(claims, forge)));
  clientAuth(world).answers.push({ status: got.status, body: got.body, text: got.text });
  clientAuth(world).knocks.set(slug, got);
  return got;
};

const person = (email: string) => ({ sub: `acme-${email}`, email });

const users = async (world: SynoikiaWorld) =>
  (await world.expectOk(world.admin.get('/api/users'), 'list users')) as unknown as {
    id: string;
    username: string;
    role: { name: string };
  }[];

Given(
  'the admin made the user {string} with the role {string}, which has the instance {string}',
  async (world: SynoikiaWorld, username: string, role: string, slug: string) => {
    const roleId = await world.role(role);
    await world.setRoleInstances(role, [slug]);
    await world.expectOk(
      world.admin.post('/api/users', { username, password: `${username} world passphrase`, roleId }),
      'create user',
    );
  },
);

Given('the admin writes the team of the access gateway as {string}', async (world: SynoikiaWorld, team: string) => {
  await world.expectOk(putMcp(world, { cfAccess: { teamDomain: team } }), 'set the team');
});

When(
  'the access gateway vouches for {string} on {string}',
  async (world: SynoikiaWorld, email: string, slug: string) => {
    await vouch(world, person(email), {}, slug);
  },
);

Then(
  '{string} gets a session on {string}, and the server log names the caller {string}',
  (world: SynoikiaWorld, _email: string, slug: string, label: string) => {
    const got = clientAuth(world).knocks.get(slug)!;
    expect(got.status, got.text).toBe(200);
    expect(got.sessionId).toBeTruthy();
    expect(world.serverLog.filter((l) => l.startsWith('INFO MCP session opened'))).toEqual([
      expect.stringContaining(` client=${label} `),
    ]);
  },
);

When(
  'the access gateway vouches for {string} for another application, for another team, too late, with another key, and as garbage',
  async (world: SynoikiaWorld, email: string) => {
    const claims = person(email);
    await vouch(world, claims, { aud: 'another-application' });
    await vouch(world, claims, { team: 'other.cloudflareaccess.com' });
    await vouch(world, claims, { exp: Math.floor(Date.now() / 1000) - 600 });
    await vouch(world, claims, { otherKey: true });
    const got = await knock(world, 'tasks', through('not-a.real-assertion.at-all'));
    clientAuth(world).answers.push({ status: got.status, body: got.body, text: got.text });
  },
);

When(
  'the access gateway vouches for {string} without an expiry, and without an issue time',
  async (world: SynoikiaWorld, email: string) => {
    await vouch(world, person(email), { exp: null });
    await vouch(world, person(email), { iat: false });
  },
);

Then('each request is told that the access gateway did not identify the caller', (world: SynoikiaWorld) => {
  const { answers } = clientAuth(world);
  expect(answers.length).toBeGreaterThanOrEqual(2);
  for (const a of answers)
    expect(a).toMatchObject({
      status: 401,
      body: { error: 'unauthorized', error_description: 'Cloudflare Access did not identify the caller' },
    });
});

When(
  'the access gateway vouches for a service credential with the address {string}',
  async (world: SynoikiaWorld, email: string) => {
    await vouch(world, { sub: '', common_name: 'backup.access', email });
    await vouch(world, { common_name: 'backup.access', email, sub: 'acme-backup' });
  },
);

When(
  'the access gateway vouches for a person without an address, and for the name {string}',
  async (world: SynoikiaWorld, name: string) => {
    await vouch(world, { sub: 'acme-nobody' });
    await vouch(world, { sub: 'acme-backup', email: name });
  },
);

Then('the stranger is asked to sign in by the access gateway', (world: SynoikiaWorld) => {
  expect(clientAuth(world).knocks.get('the stranger')).toMatchObject({
    status: 401,
    body: { error: 'unauthorized', error_description: 'Cloudflare Access did not identify the caller' },
  });
});

Then(
  '{string} gets a session on {string} as the user {string} with the role {string}',
  async (world: SynoikiaWorld, _email: string, slug: string, username: string, role: string) => {
    expect(clientAuth(world).knocks.get(slug)).toMatchObject({ status: 200 });
    const matching = (await users(world)).filter((u) => u.username.toLowerCase() === username.toLowerCase());
    expect(matching).toEqual([expect.objectContaining({ username, role: expect.objectContaining({ name: role }) })]);
  },
);

Then(
  'the request is told that no account matches, and there is one account {string}',
  async (world: SynoikiaWorld, username: string) => {
    expect(clientAuth(world).knocks.get('tasks')).toMatchObject({
      status: 403,
      body: { error: 'forbidden', error_description: 'No account matches this identity' },
    });
    expect((await users(world)).filter((u) => u.username.toLowerCase() === username)).toHaveLength(1);
  },
);

Then(
  'the request is told that no account matches, and there is no account {string}',
  async (world: SynoikiaWorld, username: string) => {
    expect(clientAuth(world).knocks.get('tasks')).toMatchObject({
      status: 403,
      body: { error_description: 'No account matches this identity' },
    });
    expect((await users(world)).map((u) => u.username)).not.toContain(username);
  },
);

Then(
  '{string} has an account with the role {string}, made by the access gateway',
  async (world: SynoikiaWorld, username: string, role: string) => {
    expect((await users(world)).filter((u) => u.username === username)).toEqual([
      expect.objectContaining({ role: expect.objectContaining({ name: role }) }),
    ]);
    const rows = (await auditRows(world, { decision: 'user_registered' })).filter(
      (r) => r.detail?.username === username,
    );
    expect(rows.map((r) => r.detail?.source)).toEqual(['external']);
  },
);
