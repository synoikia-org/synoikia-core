import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { startPluginHarness } from '../../../src/testing/index.js';
import type { PluginHarness } from '../../../src/testing/index.js';
import { API_TOKEN, FORM_WAIT_MS, eventually, opKey } from '../../support/world.js';
import type { PageResponse, Prompt, PromptAnswer, SynoikiaWorld } from '../../support/world.js';

const PLUGIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures/world/tasks');

/** What a step saw that a later step checks: the harness, a page the admin keeps open, a page answer. */
const seen = new WeakMap<
  SynoikiaWorld,
  {
    harness?: PluginHarness;
    harnessAnswer?: unknown;
    page?: Awaited<ReturnType<SynoikiaWorld['approvalPage']>>;
    answer?: PageResponse;
  }
>();
export const seenBy = (world: SynoikiaWorld) => {
  let s = seen.get(world);
  if (!s) seen.set(world, (s = {}));
  return s;
};

type CallRow = {
  decision: string;
  decidedBy?: string | null;
  decidedVia?: string | null;
  params?: Record<string, unknown> | null;
  detail: Record<string, unknown> | null;
};

const addsOf = async (world: SynoikiaWorld, title: string) =>
  ((await world.audit({ kind: 'call', operation: opKey('add a task') })) as CallRow[]).filter(
    (r) => r.params?.title === title,
  );

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const answers: Record<string, () => Promise<PromptAnswer>> = {
  accepts: () => Promise.resolve('accept'),
  declines: () => Promise.resolve('decline'),
  dismisses: () => Promise.resolve('cancel'),
  'fails to show': () => Promise.reject(new Error('the app cannot show this prompt')),
};

const expectWaiting = (world: SynoikiaWorld) =>
  expect(world.answer).toMatchObject({ status: 'awaiting_approval', approval: { url: expect.any(String) as string } });

const denied = (world: SynoikiaWorld, message: string) =>
  expect(world.answer).toEqual({ error: 'PERMISSION_DENIED', message });

// ── apps ──

Given('the app of agent {word} opens approval links', async (world: SynoikiaWorld, agent: string) => {
  await world.app(agent, 'url');
});

Given(
  'the app of agent {word} opens approval links, and the user {word} them',
  async (world: SynoikiaWorld, agent: string, answer: string) => {
    await world.app(agent, 'url', answers[answer]);
  },
);

Given(
  'the app of agent {word} opens approval links, but fails to show them',
  async (world: SynoikiaWorld, agent: string) => {
    await world.app(agent, 'url', answers['fails to show']);
  },
);

Given(
  'the app of agent {word} shows only forms, and {word} them',
  async (world: SynoikiaWorld, agent: string, answer: string) => {
    await world.app(agent, 'form', answers[answer]);
  },
);

Given(
  'the app of agent {word} shows only forms, and fails to show them',
  async (world: SynoikiaWorld, agent: string) => {
    await world.app(agent, 'form', answers['fails to show']);
  },
);

Given(
  'the app of agent {word} shows only forms, and accepts them after the form wait has passed',
  async (world: SynoikiaWorld, agent: string) => {
    await world.app(agent, 'form', async () => {
      await sleep(FORM_WAIT_MS * 2);
      return 'accept';
    });
  },
);

Given(
  'the app of agent {word} shows forms and opens links, and the admin approves each link with the list name',
  async (world: SynoikiaWorld, agent: string) => {
    await world.app(agent, 'both', async (p: Prompt) => {
      if (p.mode === 'url') {
        const page = await world.approvalPage('admin', p.url);
        const literal = /Type <code>([^<]+)<\/code> to approve/.exec(page.html)?.[1];
        await page.decide('approve', literal);
      }
      return 'accept';
    });
  },
);

Given('the admin lets the session approve calls on {string}', async (world: SynoikiaWorld, slug: string) => {
  await world.instanceSettings(slug, { formElicitationApprovals: 'ask' });
});

Given(
  'the database of {string} holds the in-session setting {string}',
  async (world: SynoikiaWorld, slug: string, value: string) => {
    const id = await world.tasksInstance(slug);
    const { changes } = world.editDataFile((db) =>
      db
        .prepare(
          "UPDATE plugin_instances SET settings = json_set(settings, '$.formElicitationApprovals', ?) WHERE id = ?",
        )
        .run(value, id),
    );
    expect(changes).toBe(1);
  },
);

// ── calls that wait ──

Given(
  'agent {word} started to add {string} to {string}',
  async (world: SynoikiaWorld, agent: string, title: string, list: string) => {
    world.startCall(agent, 'add a task', { list, title });
    await eventually(() => world.prompts.length > 0, 'the approval prompt');
  },
);

Given('agent {word} has two adds that wait for approval', async (world: SynoikiaWorld, agent: string) => {
  for (const title of ['salt', 'pepper']) {
    await world.call(agent, 'add a task', { list: 'Groceries', title });
    expectWaiting(world);
  }
});

Given(
  'agent {word} waits for the admin to approve the open tasks of {string}',
  async (world: SynoikiaWorld, agent: string, list: string) => {
    await world.call(agent, 'show the open tasks', { list });
    expectWaiting(world);
  },
);

Given(
  'agent {word} belongs to user {int}, whose role {string} may ask for the group {string} of {string}',
  async (world: SynoikiaWorld, agent: string, user: number, role: string, group: string, slug: string) => {
    await world.user(`user ${user}`, role);
    await world.setRoleInstances(role, [slug]);
    await world.setRoleMaximum(role, slug, { group }, 'ask');
    await world.credential(agent, `user ${user}`, 'write');
  },
);

Given(
  'approvals on {string} expire after {int} seconds, and a run may take {int} seconds',
  async (world: SynoikiaWorld, slug: string, expiry: number, run: number) => {
    await world.instanceSettings(slug, { approvalTimeoutMs: expiry * 1000, sandbox: { timeoutMs: run * 1000 } });
  },
);

Given('the admin revokes the credential of agent {word}', async (world: SynoikiaWorld, agent: string) => {
  const { tokenId, owner } = world.agents.get(agent)!;
  await world.expectOk(world.person(owner).portal!.del(`/api/me/tokens/${tokenId}`), 'revoke token');
});

Given('the admin approved the call on the approval page', async (world: SynoikiaWorld) => {
  const page = await world.approvalPage('admin');
  await page.decide('approve');
  seenBy(world).page = page;
});

Given(
  'plugin author {int} runs the plugin of {string} in the plugin harness, with the group {string} at level {word}',
  async (world: SynoikiaWorld, _author: number, slug: string, group: string, level: string) => {
    const harness = await startPluginHarness({
      pluginDir: PLUGIN_DIR,
      slug,
      connection: { url: world.upstream!.url, token: API_TOKEN },
    });
    world.cleanups.push(() => harness.stop());
    harness.setGroupLevel(group, level as 'ask');
    seenBy(world).harness = harness;
  },
);

// ── what happens ──

When(
  'agent {word} adds {string} to {string}, and the admin approves it on the page the app opened',
  async (world: SynoikiaWorld, agent: string, title: string, list: string) => {
    world.startCall(agent, 'add a task', { list, title });
    await eventually(() => world.prompts.length === 1, 'the approval link');
    await (await world.approvalPage('admin', world.prompts[0]!.url)).decide('approve');
    await world.callEnded();
  },
);

When(
  'agent {word} starts to rename {string} to {string} with the share password {string}',
  async (world: SynoikiaWorld, agent: string, list: string, name: string, sharePassword: string) => {
    world.startCall(agent, 'rename a list', { list, name, sharePassword });
    await eventually(() => world.prompts.length === 1, 'the approval link');
  },
);

When('agent {word} archives the list {string}', async (world: SynoikiaWorld, agent: string, list: string) => {
  await world.call(agent, 'archive a list', { list });
});

When(
  'agent {word} adds {string} to {string} and then deletes the list {string}',
  async (world: SynoikiaWorld, agent: string, title: string, list: string, other: string) => {
    await world.call(agent, 'add a task', { list, title });
    expect(world.answer).toMatchObject({ result: { title } });
    await world.call(agent, 'delete a list', { list: other });
  },
);

When(
  'the harness run adds {string} to {string} with no way to ask a human',
  async (world: SynoikiaWorld, title: string, list: string) => {
    const s = seenBy(world);
    s.harnessAnswer = await s.harness!.execute(
      `return await tasks.call('tasks.add', ${JSON.stringify({ list, title })});`,
    );
  },
);

When('the admin approves the call on the approval page', async (world: SynoikiaWorld) => {
  await (await world.approvalPage('admin')).decide('approve');
});

When('the admin sends the decision again from the same page', async (world: SynoikiaWorld) => {
  const s = seenBy(world);
  s.answer = await s.page!.post({
    csrf: /name="csrf" value="([^"]+)"/.exec(s.page!.html)?.[1] ?? '',
    decision: 'approve',
  });
});

When('the admin opens an approval link that core never made', async (world: SynoikiaWorld) => {
  seenBy(world).answer = await world.pageBrowser().send('/a/this-link-was-never-made-by-core');
});

When('core restarts', async (world: SynoikiaWorld) => {
  await world.restartCore();
});

When('the admin disables the instance {string}', async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  await world.expectOk(world.admin.patch(`/api/instances/${id}`, { enabled: false }), 'disable instance');
  await world.callEnded();
});

When('the admin deletes user {int}', async (world: SynoikiaWorld, user: number) => {
  const { id } = world.person(`user ${user}`);
  const res = await world.admin.del(`/api/users/${id}`);
  if (res.status !== 204) throw new Error(`delete user: ${res.status} ${await res.text()}`);
});

// ── what someone sees ──

Then('the approval link no longer opens', async (world: SynoikiaWorld) => {
  const page = await world.pageBrowser().send(world.approvalLink());
  expect(page.status).toBe(404);
  expect(page.html).toContain('expired or was already decided');
});

Then(
  'the audit log shows that the admin approved the add of {string} on the approval page',
  async (world: SynoikiaWorld, title: string) => {
    expect(await addsOf(world, title)).toEqual([
      expect.objectContaining({
        decision: 'human-approved',
        decidedBy: 'admin',
        decidedVia: 'url',
        detail: expect.objectContaining({ approvalChannel: 'url', approverSignIn: 'session' }) as unknown,
      }),
    ]);
  },
);

Then(
  'the app of agent {word} shows a prompt that names {string}',
  (world: SynoikiaWorld, _agent: string, name: string) => {
    const [prompt] = world.prompts;
    expect(prompt?.message).toContain(opKey(name));
    expect(prompt?.message).toContain(name);
  },
);

Then('the prompt does not show {string}', (world: SynoikiaWorld, secret: string) => {
  expect(JSON.stringify(world.prompts)).not.toContain(secret);
});

Then('agent {word} is told that the add was declined in the app', (world: SynoikiaWorld) => {
  denied(world, `${opKey('add a task')} was declined in the client`);
});

Then('agent {word} is told that the add was denied', (world: SynoikiaWorld) => {
  denied(world, `${opKey('add a task')} was denied`);
});

Then('agent {word} is told that its app could not show the approval prompt', (world: SynoikiaWorld) => {
  denied(world, `${opKey('add a task')} needs approval, but the client could not show the approval prompt`);
});

Then('the app of agent {word} was never asked', (world: SynoikiaWorld) => {
  expect(world.prompts).toEqual([]);
});

Then('the app of agent {word} showed only an approval link', (world: SynoikiaWorld) => {
  expect(world.prompts.map((p) => p.mode)).toEqual(['url']);
});

Then(
  'the admin sees one warning that in-session approvals on {string} were turned off',
  async (world: SynoikiaWorld, endpoint: string) => {
    const overview = await world.expectOk(world.admin.get('/api/overview'), 'read overview');
    expect((overview.warnings as string[]).filter((w) => w.includes('in-session approvals'))).toEqual([
      `${endpoint}: in-session approvals were turned off (unknown stored value); turn them on again in Endpoint settings`,
    ]);
  },
);

Then('the app of agent {word} showed one form with no fields', (world: SynoikiaWorld) => {
  expect(world.prompts).toEqual([expect.objectContaining({ mode: 'form', fields: [] })]);
});

Then(
  'the audit log shows that the app of agent {word} approved the add of {string} in the session',
  async (world: SynoikiaWorld, agent: string, title: string) => {
    const rows = (await addsOf(world, title)).filter((r) => r.decision === 'human-approved');
    expect(rows).toEqual([
      expect.objectContaining({
        decidedBy: `token:agent ${agent}`,
        decidedVia: 'elicitation',
        detail: expect.objectContaining({ approvalChannel: 'form' }) as unknown,
      }),
    ]);
  },
);

Then(
  'the audit log shows only that the app of agent {word} approved the add of {string} in the session',
  async (world: SynoikiaWorld, agent: string, title: string) => {
    await sleep(FORM_WAIT_MS * 1.5);
    const rows = await addsOf(world, title);
    expect(rows.map((r) => r.decision)).toEqual(['human-approved']);
    expect(rows[0]).toMatchObject({ decidedBy: `token:agent ${agent}`, detail: { approvalChannel: 'form' } });
  },
);

Then(
  'the app of agent {word} showed a form for the add and an approval link for the delete',
  (world: SynoikiaWorld) => {
    expect(world.prompts.map((p) => [p.mode, p.message.split('\n')[0]])).toEqual([
      ['form', 'add a task: "butter" in Groceries'],
      ['url', 'delete a list: Chores'],
    ]);
  },
);

Then('Acme no longer has the list {string}', (world: SynoikiaWorld, list: string) => {
  expect(world.lists.has(list)).toBe(false);
});

Then(
  'the harness run is told that the add needs approval and it cannot show approval prompts',
  (world: SynoikiaWorld) => {
    expect(seenBy(world).harnessAnswer).toMatchObject({
      ok: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: `${opKey('add a task')} needs approval, and this MCP client cannot show approval prompts`,
      },
    });
  },
);

Then(
  'agent {word} is told that the call waits for a human, who can also approve it in the session',
  (world: SynoikiaWorld) => {
    expect(world.answer).toMatchObject({
      status: 'awaiting_approval',
      approval: { url: expect.any(String) as string, inSession: true },
    });
  },
);

Then('the late answer of the form adds nothing, and the approval link still opens', async (world: SynoikiaWorld) => {
  await sleep(FORM_WAIT_MS * 1.5);
  expect(world.prompts).toEqual([expect.objectContaining({ mode: 'form' })]);
  expect(world.lists.get('Groceries')!.map((t) => t.title)).toEqual(['milk', 'bread', 'eggs']);
  expect((await world.approvalPage('admin')).status).toBe(200);
});

Then(
  'the audit log shows that the add of {string} moved from the form to the approval link',
  async (world: SynoikiaWorld, title: string) => {
    expect(await addsOf(world, title)).toEqual([
      expect.objectContaining({
        decision: 'awaiting_approval',
        detail: expect.objectContaining({ channel: 'link', formFallback: true }) as unknown,
      }),
    ]);
  },
);

Then('agent {word} is told that the approval of the add timed out and was denied', (world: SynoikiaWorld) => {
  denied(world, `Approval for ${opKey('add a task')} timed out and was denied`);
});

Then('the audit log shows that the add of {string} timed out', async (world: SynoikiaWorld, title: string) => {
  expect((await addsOf(world, title)).map((r) => r.decision)).toEqual(['timed-out']);
});

Then(
  'agent {word} is told that the approval link expires in {int} minutes',
  (world: SynoikiaWorld, _a, minutes: number) => {
    expectWaiting(world);
    const expiresAt = Date.parse((world.answer.approval as { expiresAt: string }).expiresAt);
    expect(Math.round((expiresAt - world.nowMs()) / 60_000)).toBe(minutes);
  },
);

Then(
  'agent {word} is told that {string} was turned off while it waited',
  (world: SynoikiaWorld, _agent: string, name: string) => {
    expect(world.answer).toEqual({
      error: 'OPERATION_DISABLED',
      message: `${opKey(name)} was disabled while waiting for approval`,
    });
  },
);

Then(
  'the audit log shows that the add of {string} was refused because the credential was revoked',
  async (world: SynoikiaWorld, title: string) => {
    let rows: CallRow[] = [];
    await eventually(
      async () => (rows = await addsOf(world, title)).some((r) => r.decision !== 'awaiting_approval'),
      'the end of the add',
    );
    expect(rows.map((r) => r.decision)).toEqual(['rejected:credential_revoked', 'awaiting_approval']);
  },
);

Then('the admin is told that the approval request expired or was already decided', (world: SynoikiaWorld) => {
  const { answer } = seenBy(world);
  expect(answer?.status).toBe(404);
  expect(answer?.html).toContain('This approval request has expired or was already decided.');
});

Then('the audit log shows that the restart ended the add of {string}', async (world: SynoikiaWorld, title: string) => {
  expect((await addsOf(world, title)).map((r) => r.decision)).toEqual([
    'rejected:execution_ended',
    'awaiting_approval',
  ]);
});

Then('agent {word} is told that the add was cancelled because the instance stopped', (world: SynoikiaWorld) => {
  denied(
    world,
    `${opKey('add a task')} was cancelled: the endpoint was stopped or reconfigured while it waited for approval`,
  );
});

Then('the audit log shows that the add of {string} was denied', async (world: SynoikiaWorld, title: string) => {
  let rows: CallRow[] = [];
  await eventually(
    async () => (rows = await addsOf(world, title)).some((r) => r.decision !== 'awaiting_approval'),
    'the end of the add',
  );
  expect(rows.map((r) => r.decision)).toEqual(['denied', 'awaiting_approval']);
});
