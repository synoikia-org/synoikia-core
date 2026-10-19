import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { eventually, opKey } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

const CARD_URI = 'ui://synoikia/approval';
const CARD_TOOLS = ['approval_decide', 'approval_status', 'session_grant_revoke'];

/** What a step saw that a later step checks: the approval the card shows, and what the card got. */
const seen = new WeakMap<
  SynoikiaWorld,
  {
    approvalId?: string;
    card?: Record<string, unknown>;
    resource?: { text?: string; _meta?: Record<string, unknown> };
    tools?: { name: string; _meta?: Record<string, unknown> }[];
  }
>();
const seenBy = (world: SynoikiaWorld) => {
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

/** The approval the card shows: the one in the agent's last answer, else the one shown before. */
const shownApproval = (world: SynoikiaWorld) => {
  const s = seenBy(world);
  const id = (world.answer.approval as { id?: string } | undefined)?.id;
  if (id) s.approvalId = id;
  return s.approvalId!;
};

const status = (world: SynoikiaWorld, agent: string) =>
  world.cardTool(agent, 'approval_status', { executionId: world.executionId });

const decideOnCard = async (world: SynoikiaWorld, agent: string, approvalId = shownApproval(world)) => {
  seenBy(world).card = await world.cardTool(agent, 'approval_decide', {
    executionId: world.executionId,
    approvalId,
    approve: true,
  });
};

// ── settings and runs ──

Given('in-session approval on {string} is {word}', async (world: SynoikiaWorld, slug: string, setting: string) => {
  await world.instanceSettings(slug, { formElicitationApprovals: setting === 'on' ? 'ask' : 'off' });
});

Given(
  'the admin approved the add of {string} on its page, and the run now waits for {string}',
  async (world: SynoikiaWorld) => {
    const first = shownApproval(world);
    await (await world.approvalPage('admin')).decide('approve');
    await eventually(async () => {
      const s = await status(world, '7');
      return s.state === 'pending' && s.approvalId !== first;
    }, 'the run to wait on the next approval');
  },
);

Given(
  'the user approved the call on the approval card of agent {word}',
  async (world: SynoikiaWorld, agent: string) => {
    await decideOnCard(world, agent);
  },
);

// ── what happens ──

When(
  'the user approves the call on the approval card of agent {word}, and agent {word} resumes the run',
  async (world: SynoikiaWorld, agent: string, resumer: string) => {
    await decideOnCard(world, agent);
    expect(seenBy(world).card).toEqual({ decided: true });
    await world.resume(resumer, world.executionId);
  },
);

When(
  'the user approves the call of agent {word} on the approval card of agent {word}',
  async (world: SynoikiaWorld, _owner: string, agent: string) => {
    await decideOnCard(world, agent);
  },
);

When('the user approves the call on the approval card of agent {word}', async (world: SynoikiaWorld, agent: string) => {
  await decideOnCard(world, agent);
});

When(
  'the user approves the call on the approval card of agent {word} again',
  async (world: SynoikiaWorld, agent: string) => {
    expect(seenBy(world).card).toEqual({ decided: true });
    await decideOnCard(world, agent);
  },
);

When(
  'the user approves the add of {string} on the approval card of agent {word}',
  async (world: SynoikiaWorld, _title: string, agent: string) => {
    await decideOnCard(world, agent, seenBy(world).approvalId);
  },
);

When(
  'the approval card of agent {word} reads the state of the run after it ended',
  async (world: SynoikiaWorld, agent: string) => {
    const s = seenBy(world);
    await eventually(async () => (s.card = await status(world, agent)).state === 'done', 'the end of the run');
  },
);

When(
  'agent {word} resumes the run, and the approval card reads the state meanwhile',
  async (world: SynoikiaWorld, agent: string) => {
    const s = seenBy(world);
    const resumed = world.resumeAnswer(agent, world.executionId);
    await eventually(async () => (s.card = await status(world, agent)).resumeWaiting === true, 'the resume to wait');
    await (await world.approvalPage('admin')).decide('approve');
    await resumed;
  },
);

When(
  'the app of agent {word} loads the approval card and the tools of {string}',
  async (world: SynoikiaWorld, agent: string, slug: string) => {
    const client = await world.session(agent, slug);
    const s = seenBy(world);
    s.resource = (await client.readResource({ uri: CARD_URI })).contents[0] as typeof s.resource;
    s.tools = (await client.listTools()).tools as typeof s.tools;
  },
);

// ── what someone sees ──

Then('agent {word} gets the new task {string}', (world: SynoikiaWorld, _agent: string, title: string) => {
  expect(world.answer).toEqual({ result: { title, done: false } });
});

Then(
  'the audit log shows that the approval card of agent {word} approved the add of {string}, with no session grant',
  async (world: SynoikiaWorld, agent: string, title: string) => {
    const rows = ((await world.audit({ kind: 'call', operation: opKey('add a task') })) as CallRow[]).filter(
      (r) => r.params?.title === title && r.decision === 'human-approved',
    );
    expect(rows).toEqual([
      expect.objectContaining({
        decidedBy: `token:agent ${agent}`,
        decidedVia: 'elicitation',
        detail: expect.objectContaining({ approvalChannel: 'card' }) as unknown,
      }),
    ]);
    const id = await world.tasksInstance(world.lastInstance);
    expect(await world.expectOk(world.admin.get(`/api/instances/${id}/session-grants`), 'list grants')).toEqual([]);
  },
);

Then('the card of agent {word} is told that the run does not exist', (world: SynoikiaWorld) => {
  expect(seenBy(world).card).toEqual({ decided: false, error: 'not_found' });
});

Then('the card of agent {word} is told that the call needs the approval page', (world: SynoikiaWorld) => {
  expect(seenBy(world).card).toEqual({ decided: false, error: 'approval_not_in_session' });
});

Then('the card of agent {word} is told that the approval changed', (world: SynoikiaWorld) => {
  expect(seenBy(world).card).toEqual({ decided: false, error: 'approval_changed' });
});

Then(
  'the card sees only that the run is done and was approved, without the task or the approver',
  (world: SynoikiaWorld) => {
    const { card } = seenBy(world);
    expect(card).toEqual({ state: 'done', decision: 'approved' });
  },
);

Then('the card sees that the run waits for approval, and that a resume waits on it', (world: SynoikiaWorld) => {
  const { card } = seenBy(world);
  expect(card).toEqual({
    state: 'pending',
    approvalId: (world.answer.approval as { id: string }).id,
    expiresAt: expect.any(String) as string,
    resumeWaiting: true,
  });
});

Then('the card may reach no other site', (world: SynoikiaWorld) => {
  const { resource } = seenBy(world);
  expect(resource?._meta).toMatchObject({ ui: { csp: { connectDomains: [], resourceDomains: [] } } });
  expect(resource?.text).not.toMatch(/https?:\/\//);
});

Then('the tools of the card are only for the app, not for the model', (world: SynoikiaWorld) => {
  const tools = seenBy(world).tools ?? [];
  const appOnly = tools
    .filter((t) => (t._meta?.ui as { visibility?: string[] } | undefined)?.visibility?.join() === 'app')
    .map((t) => t.name);
  expect(appOnly.sort()).toEqual(CARD_TOOLS);
  expect(tools.map((t) => t.name).filter((n) => !CARD_TOOLS.includes(n))).toEqual(['search', 'execute', 'resume']);
});
