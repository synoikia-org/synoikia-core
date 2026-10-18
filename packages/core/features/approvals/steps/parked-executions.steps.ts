import { randomUUID } from 'node:crypto';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { eventually, opKey } from '../../support/world.js';
import type { PromptAnswer, SynoikiaWorld } from '../../support/world.js';

/** What a step saw that a later step checks: answers the agents got along the way. */
const seen = new WeakMap<SynoikiaWorld, { answers: Record<string, unknown>[] }>();
const seenBy = (world: SynoikiaWorld) => {
  let s = seen.get(world);
  if (!s) seen.set(world, (s = { answers: [] }));
  return s;
};

type CallRow = {
  decision: string;
  operationKey: string | null;
  decidedBy?: string | null;
  actorId?: string | null;
  params?: Record<string, unknown> | null;
  detail: Record<string, unknown> | null;
};

const addsOf = async (world: SynoikiaWorld, title: string) =>
  ((await world.audit({ kind: 'call', operation: opKey('add a task') })) as CallRow[]).filter(
    (r) => r.params?.title === title,
  );

const resumes = async (world: SynoikiaWorld) =>
  ((await world.audit({ kind: 'call', decision: 'resumed' })) as CallRow[]).filter((r) => !r.operationKey);

const expectWaiting = (world: SynoikiaWorld, answer = world.answer) =>
  expect(answer).toMatchObject({ status: 'awaiting_approval', approval: { url: expect.any(String) as string } });

const NOT_FOUND = {
  error: 'EXECUTION_NOT_FOUND',
  message: 'No parked execution with this id: it finished and was collected, expired, or the server restarted',
};

/** Polls the state of the agent's parked run until `done` holds for it. */
const runState = async (
  world: SynoikiaWorld,
  agent: string,
  done: (s: Record<string, unknown>) => boolean,
  what: string,
) => {
  let state: Record<string, unknown> = {};
  await eventually(
    async () => done((state = await world.cardTool(agent, 'approval_status', { executionId: world.executionId }))),
    what,
  );
  return state;
};

/** The code adds the tasks one after the other and returns their titles. */
const addAll = (list: string, titles: string[]) =>
  `${titles
    .map((title, i) => `const t${i} = await tasks.call('tasks.add', ${JSON.stringify({ list, title })});`)
    .join('\n')}\nreturn [${titles.map((_t, i) => `t${i}.title`).join(', ')}];`;

const twoAddsWait = async (world: SynoikiaWorld, agent: string) => {
  for (const title of ['salt', 'pepper']) {
    await world.call(agent, 'add a task', { list: 'Groceries', title });
    expectWaiting(world);
  }
};

// ── calls that wait ──

Given(
  'the code of agent {word} adds {string} and then {string} to {string}',
  async (world: SynoikiaWorld, agent: string, a: string, b: string, list: string) => {
    await world.execute(agent, world.lastInstance, addAll(list, [a, b]));
  },
);

Given(
  'the code of agent {word} tries three times to add {string} to {string}',
  async (world: SynoikiaWorld, agent: string, title: string, list: string) => {
    const call = `tasks.call('tasks.add', ${JSON.stringify({ list, title })})`;
    await world.execute(
      agent,
      world.lastInstance,
      `const out = [];\nfor (let i = 0; i < 3; i++) {\n  try { await ${call}; out.push('added'); } catch (e) { out.push(e.message); }\n}\nreturn out;`,
    );
    expectWaiting(world);
  },
);

Given(
  'the app of agent {word} shows only forms, declines the first and accepts the next',
  async (world: SynoikiaWorld, agent: string) => {
    let asked = 0;
    await world.app(agent, 'form', () => Promise.resolve<PromptAnswer>(asked++ === 0 ? 'decline' : 'accept'));
  },
);

Given('the admin approved the call on the approval page, and the run ended', async (world: SynoikiaWorld) => {
  await (await world.approvalPage('admin')).decide('approve');
  await runState(world, '7', (s) => s.state === 'done', 'the end of the run');
});

Given('{int} minutes pass', async (world: SynoikiaWorld, minutes: number) => {
  await world.advanceClock(minutes * 60_000);
});

Given(
  'a run on {string} may take {int} seconds, and Acme takes {int} seconds to answer',
  async (world: SynoikiaWorld, slug: string, run: number, upstream: number) => {
    await world.instanceSettings(slug, { sandbox: { timeoutMs: run * 1000 } });
    world.upstreamDelayMs = upstream * 1000;
  },
);

Given(
  'agents {word}, {word}, {word} and {word} of the admin each have two adds that wait for approval',
  async (world: SynoikiaWorld, ...agents: string[]) => {
    for (const agent of agents.slice(0, 4)) {
      await world.credential(agent, 'admin', 'write');
      await twoAddsWait(world, agent);
    }
  },
);

// ── what happens ──

When(
  'the admin approves each add on its page, and agent {word} resumes the run after each',
  async (world: SynoikiaWorld, agent: string) => {
    const s = seenBy(world);
    while (world.answer.status === 'awaiting_approval') {
      await (await world.approvalPage('admin')).decide('approve');
      await world.resume(agent, world.executionId);
      s.answers.push(world.answer);
    }
  },
);

When(
  'agent {word} resumes the run, and nobody decides for {int} seconds',
  async (world: SynoikiaWorld, agent: string) => {
    seenBy(world).answers.push(world.answer);
    await world.resume(agent, world.executionId);
  },
);

When(
  'agent {word} resumes the run twice at the same time, and the admin then approves the add',
  async (world: SynoikiaWorld, agent: string) => {
    const first = world.resumeAnswer(agent, world.executionId);
    await runState(world, agent, (s) => s.resumeWaiting === true, 'the first resume to wait');
    const second = await world.resumeAnswer(agent, world.executionId);
    await (await world.approvalPage('admin')).decide('approve');
    seenBy(world).answers.push(await first, second);
  },
);

When('agent {word} resumes the run', async (world: SynoikiaWorld, agent: string) => {
  await world.resume(agent, world.executionId);
});

When('agent {word} resumes the run again', async (world: SynoikiaWorld, agent: string) => {
  await world.resume(agent, world.executionId);
});

When(
  'agent {word} resumes the run of agent {word}, and then a run that core never made',
  async (world: SynoikiaWorld, agent: string) => {
    const s = seenBy(world);
    s.answers.push(await world.resumeAnswer(agent, world.executionId));
    s.answers.push(await world.resumeAnswer(agent, randomUUID()));
  },
);

When(
  'agent {word} resumes the run on the instance {string}',
  async (world: SynoikiaWorld, agent: string, slug: string) => {
    const id = world.executionId;
    await world.tasksInstance(slug);
    await world.connect(agent, slug);
    await world.resume(agent, id);
  },
);

When(
  'the admin denies the add on its page, and agent {word} resumes the run',
  async (world: SynoikiaWorld, agent: string) => {
    await (await world.approvalPage('admin')).decide('deny');
    await world.resume(agent, world.executionId);
  },
);

When(
  'the code of agent {word} tries to add {string}, and then adds {string} to {string}',
  async (world: SynoikiaWorld, agent: string, a: string, b: string, list: string) => {
    const add = (title: string) => `tasks.call('tasks.add', ${JSON.stringify({ list, title })})`;
    await world.execute(
      agent,
      world.lastInstance,
      `try { await ${add(a)}; } catch { /* denied */ }\nreturn (await ${add(b)}).title;`,
    );
  },
);

When(
  'the code of agent {word} counts {string} eleven times, and the admin approves each count',
  async (world: SynoikiaWorld, agent: string, list: string) => {
    const count = `tasks.call('lists.count', ${JSON.stringify({ list })})`;
    await world.execute(
      agent,
      world.lastInstance,
      `const out = [];\nfor (let i = 0; i < 11; i++) {\n  try { out.push((await ${count}).open); } catch (e) { out.push(e.message); }\n}\nreturn out;`,
    );
    while (world.answer.status === 'awaiting_approval') {
      await (await world.approvalPage('admin')).decide('approve');
      await world.resume(agent, world.executionId);
    }
  },
);

When(
  'agent {word} adds {string} to {string} on the instance {string}',
  async (world: SynoikiaWorld, agent: string, title: string, list: string, slug: string) => {
    await world.tasksInstance(slug);
    world.lastInstance = slug;
    await world.connect(agent, slug);
    await world.call(agent, 'add a task', { list, title });
  },
);

When(
  'the admin enables {string} again, and agent {word} resumes the run',
  async (world: SynoikiaWorld, slug: string, agent: string) => {
    const id = await world.tasksInstance(slug);
    await world.expectOk(world.admin.patch(`/api/instances/${id}`, { enabled: true }), 'enable instance');
    await world.connect(agent, slug);
    await world.resume(agent, world.executionId);
  },
);

// ── what someone sees ──

Then(
  'agent {word} got a second approval link for {string}, and then the new tasks {string} and {string}',
  (world: SynoikiaWorld, _agent: string, second: string, a: string, b: string) => {
    const [link, result] = seenBy(world).answers;
    expectWaiting(world, link);
    expect((link!.approval as { summary: string }).summary).toBe(`add a task: "${second}" in Groceries`);
    expect(result).toEqual({ result: [a, b] });
  },
);

Then('Acme received {string} once and {string} once', (world: SynoikiaWorld, ...titles: string[]) => {
  const adds = world.upstreamRequests('POST', '/lists/Groceries/tasks').map((r) => (r.body as { title: string }).title);
  expect(adds).toEqual(titles.slice(0, 2));
});

Then(
  'agent {word} gets the new task {string} at once, and the call never waited for resume',
  async (world: SynoikiaWorld, _agent: string, title: string) => {
    expect(world.answer).toEqual({ result: { title, done: false } });
    expect((await addsOf(world, title)).map((r) => r.decision)).toEqual(['human-approved']);
  },
);

Then('agent {word} gets the same approval link again, marked as one that it already has', (world: SynoikiaWorld) => {
  const [before] = seenBy(world).answers;
  const url = (before!.approval as { url: string }).url;
  expect(world.answer).toMatchObject({ status: 'awaiting_approval', approval: { url, repeat: true } });
});

Then('agent {word} is told that the run still runs, and to resume it again', (world: SynoikiaWorld) => {
  expect(world.answer).toMatchObject({ status: 'running', next: 'Call resume with this executionId.' });
});

Then('the second resume is told that another resume already waits on the run', (world: SynoikiaWorld) => {
  expect(seenBy(world).answers[1]).toEqual({
    error: 'BUSY',
    message: 'Another resume is already waiting on this execution',
  });
});

Then('the first resume gets the new task {string}', (world: SynoikiaWorld, title: string) => {
  expect(seenBy(world).answers[0]).toEqual({ result: { title, done: false } });
});

Then('agent {word} is told that no such run exists', (world: SynoikiaWorld) => {
  expect(world.answer).toEqual(NOT_FOUND);
});

Then('agent {word} is told twice that no such run exists', (world: SynoikiaWorld) => {
  expect(seenBy(world).answers).toEqual([NOT_FOUND, NOT_FOUND]);
});

Then('the audit log records both resumes by agent {word}', async (world: SynoikiaWorld, agent: string) => {
  expect((await resumes(world)).map((r) => [r.actorId, r.detail?.error])).toEqual([
    [`token:agent ${agent}`, 'EXECUTION_NOT_FOUND'],
    [`token:agent ${agent}`, 'EXECUTION_NOT_FOUND'],
  ]);
});

Then(
  'the next resume of agent {word} gets the new task {string}',
  async (world: SynoikiaWorld, agent: string, title: string) => {
    expect(await world.resumeAnswer(agent, world.executionId)).toEqual({ result: { title, done: false } });
  },
);

Then('agent {word} gets three denials, and only the first add was asked', async (world: SynoikiaWorld) => {
  const key = opKey('add a task');
  expect(world.answer).toEqual({
    result: [
      `${key} was denied`,
      `${key} needs approval, and an earlier approval of this execution was not given or it reached its approval limit; call execute again`,
      `${key} needs approval, and an earlier approval of this execution was not given or it reached its approval limit; call execute again`,
    ],
  });
  const decisions = (await addsOf(world, 'butter')).map((r) => r.decision);
  expect(decisions.filter((d) => d === 'awaiting_approval')).toHaveLength(1);
});

Then('agent {word} can leave two more calls waiting for approval', async (world: SynoikiaWorld, agent: string) => {
  await twoAddsWait(world, agent);
});

Then('the app of agent {word} showed two forms', (world: SynoikiaWorld) => {
  expect(world.prompts.map((p) => p.mode)).toEqual(['form', 'form']);
});

Then(
  'agent {word} gets ten counts, and the eleventh is refused because the run reached its approval limit',
  (world: SynoikiaWorld) => {
    expect(world.answer).toEqual({
      result: [
        ...Array.from({ length: 10 }, () => 3),
        `${opKey('count the tasks')} needs approval, and an earlier approval of this execution was not given or it reached its approval limit; call execute again`,
      ],
    });
  },
);

Then('agent {word} is told that too many earlier calls still wait for approval', (world: SynoikiaWorld) => {
  expect(world.answer).toEqual({
    error: 'PERMISSION_DENIED',
    message: `${opKey('add a task')} needs approval, and too many earlier calls of this client still wait for one; resume or finish those first`,
  });
});

Then('agent {word} is told that the run ended', (world: SynoikiaWorld) => {
  expect(world.answer).toEqual({
    error: 'EXECUTION_ENDED',
    message: 'The execute call this belongs to has already ended',
  });
});

Then(
  'the audit log shows that the add of {string} waited, the admin approved it, and agent {word} resumed the run once',
  async (world: SynoikiaWorld, title: string, agent: string) => {
    expect((await addsOf(world, title)).map((r) => [r.decision, r.decidedBy ?? null])).toEqual([
      ['human-approved', 'admin'],
      ['awaiting_approval', null],
    ]);
    expect((await resumes(world)).map((r) => [r.actorId, r.detail?.executionId])).toEqual([
      [`token:agent ${agent}`, world.executionId],
    ]);
  },
);
