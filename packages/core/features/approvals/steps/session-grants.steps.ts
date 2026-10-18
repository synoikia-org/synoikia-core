import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { csrfOf, eventually, opKey } from '../../support/world.js';
import type { PageResponse, SynoikiaWorld } from '../../support/world.js';

/** What a step saw that a later step checks: approval links, the page the admin opened and what came back. */
const seen = new WeakMap<
  SynoikiaWorld,
  { links: string[]; opened?: PageResponse; answer?: PageResponse; card?: Record<string, unknown> }
>();
const seenBy = (world: SynoikiaWorld) => {
  let s = seen.get(world);
  if (!s) seen.set(world, (s = { links: [] }));
  return s;
};

type Grant = { id: string; client: string | null; createdBy: string; expiresAt: string };
type Row = { decision: string; params?: Record<string, unknown> | null; detail: Record<string, unknown> | null };

const REASONS: Record<string, string> = {
  'a new one replaced it': 'replaced',
  'it expired': 'expired',
  'the admin revoked it': 'revoked',
  'the instance stopped': 'endpoint_stopped',
  'user 12 was disabled': 'user_disabled',
  'user 12 was deleted': 'user_deleted',
};

const expectWaiting = (world: SynoikiaWorld) =>
  expect(world.answer).toMatchObject({ status: 'awaiting_approval', approval: { url: expect.any(String) as string } });

const grants = async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  return (await world.expectOk(
    world.admin.get(`/api/instances/${id}/session-grants`),
    'list session grants',
  )) as unknown as Grant[];
};

const grantOf = async (world: SynoikiaWorld, agent: string) => {
  const grant = (await grants(world, world.lastInstance)).find((g) => g.client === `token:agent ${agent}`);
  if (!grant) throw new Error(`agent ${agent} has no session grant`);
  return grant;
};

/** The approver opens the agent's parked call and approves it for this session; the agent resumes it. */
const approveForSession = async (world: SynoikiaWorld, agent: string, approver: string) => {
  const executionId = world.executionId;
  await (await world.approvalPage(approver)).decide('approve_session');
  await world.resume(agent, executionId);
};

/** The admin sends "approve for this session" with a length of `hours`, whatever the page offered. */
const approveWithLength = async (world: SynoikiaWorld, hours: number) => {
  const page = await world.approvalPage('admin');
  const s = seenBy(world);
  s.opened = { status: page.status, csp: '', cookies: [], html: page.html };
  s.answer = await page.post({ csrf: csrfOf(page.html), decision: 'approve_session', grant: String(hours) });
};

const endedGrants = async (world: SynoikiaWorld) =>
  ((await world.audit({ kind: 'config', decision: 'session_grant.ended' })) as Row[]).map((r) => r.detail ?? {});

// ── grants ──

Given(
  'the admin approved the open tasks of {string} for agent {word} for this session',
  async (world: SynoikiaWorld, list: string, agent: string) => {
    await world.call(agent, 'show the open tasks', { list });
    expectWaiting(world);
    await approveForSession(world, agent, 'admin');
    expect(world.answer).toEqual({ result: expect.any(Array) as unknown });
  },
);

Given(
  'user {int} approved the add of {string} by agent {word} for this session',
  async (world: SynoikiaWorld, user: number, title: string, agent: string) => {
    await world.call(agent, 'add a task', { list: 'Groceries', title });
    expectWaiting(world);
    await approveForSession(world, agent, `user ${user}`);
    expect(world.answer).toMatchObject({ result: { title } });
  },
);

Given(
  'the longest session grant on {string} is {int} hours',
  async (world: SynoikiaWorld, slug: string, hours: number) => {
    await world.instanceSettings(slug, { sessionGrantMaxHours: hours });
  },
);

Given(
  'agent {word} waits for the admin to approve the adds of {string} and {string}',
  async (world: SynoikiaWorld, agent: string, ...titles: string[]) => {
    for (const title of titles.slice(0, 2)) {
      await world.call(agent, 'add a task', { list: 'Groceries', title });
      expectWaiting(world);
      seenBy(world).links.push((world.answer.approval as { url: string }).url);
    }
  },
);

Given('the approval card of agent {word} revokes its session grant', async (world: SynoikiaWorld, agent: string) => {
  const grant = await grantOf(world, agent);
  expect(await world.cardTool(agent, 'session_grant_revoke', { grantId: grant.id })).toEqual({ revoked: true });
});

// ── what happens ──

When('the admin approves the add for this session for {int} hour(s)', async (world: SynoikiaWorld, hours: number) => {
  await approveWithLength(world, hours);
});

When('the admin approves both adds for this session', async (world: SynoikiaWorld) => {
  const [first, second] = seenBy(world).links;
  await (await world.approvalPage('admin', first)).decide('approve_session');
  await eventually(async () => (await grants(world, world.lastInstance)).length === 1, 'the first session grant');
  await (await world.approvalPage('admin', second)).decide('approve_session');
  await eventually(
    async () => (await endedGrants(world)).some((d) => d.reason === 'replaced'),
    'the second session grant',
  );
});

When('the admin revokes the session grant of agent {word}', async (world: SynoikiaWorld, agent: string) => {
  const grant = await grantOf(world, agent);
  const id = await world.tasksInstance(world.lastInstance);
  const res = await world.admin.del(`/api/instances/${id}/session-grants/${grant.id}`);
  expect(res.status).toBe(204);
});

When(
  'the approval card of agent {word} tries to revoke the session grant of agent {word}',
  async (world: SynoikiaWorld, agent: string, owner: string) => {
    const grant = await grantOf(world, owner);
    seenBy(world).card = await world.cardTool(agent, 'session_grant_revoke', { grantId: grant.id });
  },
);

// ── what someone sees ──

Then(
  'the audit log shows that the session grant approved the add of {string}',
  async (world: SynoikiaWorld, title: string) => {
    const rows = ((await world.audit({ kind: 'call', operation: opKey('add a task') })) as Row[]).filter(
      (r) => r.params?.title === title,
    );
    expect(rows.map((r) => r.decision)).toEqual([expect.stringMatching(/^auto-approved:grant:/) as string]);
  },
);

Then('the admin is told to choose a session length', (world: SynoikiaWorld) => {
  const { answer } = seenBy(world);
  expect(answer?.status).toBe(400);
  expect(answer?.html).toContain('Choose a session length.');
});

Then('the approval page of the call offers no session grant', async (world: SynoikiaWorld) => {
  const page = await world.approvalPage('admin');
  expect(page.status).toBe(200);
  expect(page.html).toContain('Approve');
  expect(page.html).not.toContain('approve_session');
});

Then('the page offered no session grant, and the admin is told to choose a session length', (world: SynoikiaWorld) => {
  const { opened, answer } = seenBy(world);
  expect(opened?.status).toBe(200);
  expect(opened?.html).not.toContain('approve_session');
  expect(answer?.status).toBe(400);
  expect(answer?.html).toContain('Choose a session length.');
});

Then(
  'the admin sees one session grant of agent {word} on {string}',
  async (world: SynoikiaWorld, agent: string, slug: string) => {
    expect((await grants(world, slug)).map((g) => g.client)).toEqual([`token:agent ${agent}`]);
  },
);

Then('the admin sees no session grant on {string}', async (world: SynoikiaWorld, slug: string) => {
  expect(await grants(world, slug)).toEqual([]);
});

Then(
  /^the audit log shows that the session grant of agent (\w+) ended because (.+)$/,
  async (world: SynoikiaWorld, agent: string, because: string) => {
    const reason = REASONS[because];
    if (!reason) throw new Error(`No reason "${because}" in the World`);
    let ended: Record<string, unknown>[] = [];
    await eventually(async () => (ended = await endedGrants(world)).length > 0, 'the end of the session grant');
    expect(ended).toEqual([expect.objectContaining({ client: `token:agent ${agent}`, reason })]);
  },
);

Then('the card of agent {word} is told that nothing was revoked', (world: SynoikiaWorld) => {
  expect(seenBy(world).card).toEqual({ revoked: false });
});
