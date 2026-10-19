import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { csrfOf } from '../../support/world.js';
import type { PageBrowser, SynoikiaWorld } from '../../support/world.js';
import { asksToSignIn, identity } from '../../identity/steps/identity.js';
import { admin, sessionGrants } from './administration.js';

const HOUR = 3_600_000;

When('user {int} signs out all their approval browsers in the portal', async (world: SynoikiaWorld, user: number) => {
  const portal = world.person(`user ${user}`).portal!;
  admin(world).seen.listed = await (await portal.get('/api/profile/approval-sessions')).json();
  admin(world).seen.revoked = await (await portal.post('/api/profile/approval-sessions/revoke', {})).json();
});

Then(
  'user {int} saw one approval browser, which must now sign in again, and user {int} is still in the portal',
  async (world: SynoikiaWorld, user: number) => {
    const { seen } = admin(world);
    expect(seen.listed).toHaveLength(1);
    expect(seen.revoked).toEqual({ revoked: 1 });
    const { browser, path } = identity(world).approval!;
    expect(asksToSignIn(await browser.send(path))).toBe(true);
    const portal = world.person(`user ${user}`).portal!;
    expect(await (await portal.get('/api/profile/approval-sessions')).json()).toEqual([]);
    expect((await portal.get('/api/profile')).status).toBe(200);
  },
);

When('the admin revokes the session grant of agent {word} twice', async (world: SynoikiaWorld, agent: string) => {
  const grants = await sessionGrants(world, world.lastInstance);
  admin(world).seen.grants = grants;
  const grant = grants.find((g) => g.client === `token:agent ${agent}`)!;
  const id = await world.tasksInstance(world.lastInstance);
  const statuses: number[] = [];
  for (let i = 0; i < 2; i++)
    statuses.push((await world.admin.del(`/api/instances/${id}/session-grants/${grant.id}`)).status);
  admin(world).seen.statuses = statuses;
});

Then(
  'the admin saw the grant of agent {word} on {string}, and is told the second time that it does not exist',
  async (world: SynoikiaWorld, agent: string, slug: string) => {
    expect(admin(world).seen.grants).toEqual([expect.objectContaining({ client: `token:agent ${agent}` })]);
    expect(admin(world).seen.statuses).toEqual([204, 404]);
    expect(await sessionGrants(world, slug)).toEqual([]);
  },
);

/** A new add of the agent that waits for approval; the agent opens a new session for it. */
const nextApproval = async (world: SynoikiaWorld, agent: string) => {
  const a = world.agents.get(agent)!;
  if (a.client) world.oldClients.push(a.client);
  a.client = undefined;
  const n = Number(admin(world).seen.adds ?? 0) + 1;
  admin(world).seen.adds = n;
  await world.call(agent, 'add a task', { list: 'Groceries', title: `jam ${n}` });
  expect(world.answer.status, JSON.stringify(world.answer)).toBe('awaiting_approval');
  return world.approvalLink();
};

/** Opens the agent's approval at `link` in the approval browser; a page that opens is denied and its run ends,
 * so nothing piles up. */
const openAndDeny = async (world: SynoikiaWorld, agent: string, link: string) => {
  const browser = admin(world).seen.approvalBrowser as PageBrowser;
  const executionId = world.executionId;
  const page = await browser.send(link);
  if (asksToSignIn(page)) return false;
  const denied = await browser.send(link, { csrf: csrfOf(page.html), decision: 'deny' });
  expect(denied.status).toBe(200);
  await world.resume(agent, executionId);
  return true;
};

const opens = async (world: SynoikiaWorld, agent: string) =>
  openAndDeny(world, agent, await nextApproval(world, agent));

Given(
  'user {int} signed in on the approval page of a call of agent {word}',
  async (world: SynoikiaWorld, user: number, agent: string) => {
    const browser = world.pageBrowser();
    admin(world).seen.approvalBrowser = browser;
    const link = await nextApproval(world, agent);
    await world.signInOnPage(browser.send, `user ${user}`, link);
    expect(await openAndDeny(world, agent, link)).toBe(true);
  },
);

When(
  'user {int} opens the next approval of agent {word} after {int} idle hours, and the one after that {int} idle hours later',
  async (world: SynoikiaWorld, _user: number, agent: string, first: number, second: number) => {
    const seen: boolean[] = [];
    for (const hours of [first, second]) {
      world.passTime(hours * HOUR);
      seen.push(await opens(world, agent));
    }
    admin(world).seen.opened = seen;
  },
);

Then('the first approval opens, and the second asks user {int} to sign in', (world: SynoikiaWorld) => {
  expect(admin(world).seen.opened).toEqual([true, false]);
});

When(
  'user {int} opens an approval of agent {word} every {int} hours for {int} days',
  async (world: SynoikiaWorld, _user: number, agent: string, every: number, days: number) => {
    const seen: [number, boolean][] = [];
    for (let at = every; at <= days * 24; at += every) {
      world.passTime(every * HOUR);
      const open = await opens(world, agent);
      seen.push([at, open]);
      if (!open) break;
    }
    admin(world).seen.opened = seen;
  },
);

Then(
  'each approval opens until the 7th day ends, and the next one asks user {int} to sign in',
  (world: SynoikiaWorld) => {
    const seen = admin(world).seen.opened as [number, boolean][];
    const before = seen.filter(([at]) => at <= 7 * 24);
    const after = seen.filter(([at]) => at > 7 * 24);
    expect(before.every(([, open]) => open)).toBe(true);
    expect(after[0]).toEqual([after[0]![0], false]);
  },
);
