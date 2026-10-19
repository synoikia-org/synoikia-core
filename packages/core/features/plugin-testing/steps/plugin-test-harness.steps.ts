import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { startPluginHarness } from '../../../src/testing/index.js';
import type { ExecuteResult, PendingResult, PluginHarness } from '../../../src/testing/index.js';
import { seenBy } from '../../approvals/steps/approval-channels.steps.js';
import { TASKS_SOURCE } from '../../support/plugin-archives.js';
import { API_TOKEN, opKey } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

/** What plugin author 3's test saw: the copy it built, a parked run, the messages the harness gave it. */
const tested = new WeakMap<
  SynoikiaWorld,
  { copy?: string; parked?: ExecuteResult; told: string[]; startError?: string; staged?: string; stagedNotes?: string }
>();
export const testOf = (world: SynoikiaWorld) => {
  let t = tested.get(world);
  if (!t) tested.set(world, (t = { told: [] }));
  return t;
};

/** A copy of "Acme Tasks" in a temporary folder, removed when the scenario ends. */
export function tasksCopy(world: SynoikiaWorld, change: (dir: string) => void = () => undefined) {
  const dir = mkdtempSync(path.join(tmpdir(), 'synoikia-author-'));
  cpSync(TASKS_SOURCE, dir, { recursive: true });
  change(dir);
  world.cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Replaces each `from` by its `to` in the entry file of the copy of "Acme Tasks" in `dir`. */
export function editEntry(dir: string, edits: [from: string, to: string][]) {
  const file = path.join(dir, 'index.mjs');
  let code = readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    if (!code.includes(from)) throw new Error(`Acme Tasks has no "${from}" to change`);
    code = code.replace(from, to);
  }
  writeFileSync(file, code);
}

/** A build of "Acme Tasks" whose entry file has each `from` replaced by its `to`. */
export function tasksVariant(world: SynoikiaWorld, edits: [from: string, to: string][]) {
  return tasksCopy(world, (dir) => editEntry(dir, edits));
}

/** Starts the harness on `pluginDir`, as plugin author 3's test does, and stops it when the scenario ends. */
export async function startHarness(world: SynoikiaWorld, pluginDir = TASKS_SOURCE) {
  const harness = await startPluginHarness({ pluginDir, connection: { url: world.upstream!.url, token: API_TOKEN } });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await harness.stop();
  };
  world.cleanups.push(stop);
  seenBy(world).harness = harness;
  return { harness, stop };
}

const harnessOf = (world: SynoikiaWorld): PluginHarness => seenBy(world).harness!;
const answerOf = (world: SynoikiaWorld) => seenBy(world).harnessAnswer as ExecuteResult;
const run = async (
  world: SynoikiaWorld,
  key: string,
  params: unknown,
  opts?: Parameters<PluginHarness['execute']>[1],
) => {
  const answer = await harnessOf(world).execute(`return await tasks.call('${key}', ${JSON.stringify(params)});`, opts);
  seenBy(world).harnessAnswer = answer;
  return answer;
};

// ── the World ──

Given(
  'Acme has the list {string} with the open tasks {string}, {string} and {string}',
  (world: SynoikiaWorld, list: string, a: string, b: string, c: string) => {
    world.lists.set(
      list,
      [a, b, c].map((title) => ({ title, done: false })),
    );
  },
);

// ── the staged copy ──

When('plugin author {int} starts the plugin harness on Acme Tasks', async (world: SynoikiaWorld) => {
  await startHarness(world);
});

Then('the harness runs only Acme Tasks, from its own copy, with its catalog synced', (world: SynoikiaWorld) => {
  const h = harnessOf(world);
  expect(h.manifest.id).toBe('tasks');
  expect(readdirSync(path.join(h.ctx.config.DATA_DIR, 'plugins'))).toEqual(['tasks']);
  expect(h.instance()).toMatchObject({ slug: 'tasks', lastSyncStatus: 'ok' });
  expect(h.operations().map((o) => o.key)).toEqual(
    expect.arrayContaining([opKey('show the open tasks'), opKey('add a task'), opKey('delete a list')]),
  );
});

Then(
  '{string} is locked in the harness, and an operation that Acme Tasks does not have is an error',
  (world: SynoikiaWorld, name: string) => {
    const h = harnessOf(world);
    expect(h.operation(opKey(name))).toMatchObject({ locked: true });
    expect(() => h.operation('lists.done')).toThrow('No operation lists.done in the synced catalog');
  },
);

Given('plugin author {int} has a copy of Acme Tasks without its entry file', (world: SynoikiaWorld) => {
  testOf(world).copy = tasksCopy(world, (dir) => rmSync(path.join(dir, 'index.mjs')));
});

Given(
  'plugin author {int} has a copy of Acme Tasks with the agent instructions {string}',
  (world: SynoikiaWorld, _author: number, notes: string) => {
    testOf(world).copy = tasksCopy(world, (dir) => {
      const file = path.join(dir, 'manifest.json');
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      writeFileSync(file, JSON.stringify({ ...manifest, instructions: 'instructions.md' }));
      writeFileSync(path.join(dir, 'instructions.md'), `${notes}\n`);
    });
  },
);

When('plugin author {int} starts the plugin harness on that copy', async (world: SynoikiaWorld) => {
  const t = testOf(world);
  try {
    await startHarness(world, t.copy);
  } catch (err) {
    t.startError = err instanceof Error ? err.message : String(err);
  }
});

When('plugin author {int} starts the plugin harness on that copy and then stops it', async (world: SynoikiaWorld) => {
  const t = testOf(world);
  const { harness, stop } = await startHarness(world, t.copy);
  t.staged = harness.ctx.config.DATA_DIR;
  t.stagedNotes = readFileSync(path.join(t.staged, 'plugins', 'tasks', 'instructions.md'), 'utf8');
  await stop();
});

Then('the harness does not start, and tells plugin author {int} to build the plugin first', (world: SynoikiaWorld) => {
  const t = testOf(world);
  expect(seenBy(world).harness).toBeUndefined();
  expect(t.startError).toMatch(/^tasks: entry index\.mjs not found in .*\. Build the plugin first\.$/);
});

Then(
  'the staged copy held the agent instructions {string}, and the copy is gone',
  (world: SynoikiaWorld, notes: string) => {
    const t = testOf(world);
    expect(t.stagedNotes).toBe(`${notes}\n`);
    expect(existsSync(t.staged!)).toBe(false);
  },
);

// ── access levels ──

When('the harness run asks for the share password of {string}', async (world: SynoikiaWorld, list: string) => {
  await run(world, opKey('show the share password'), { list });
});

Then('the harness run sees the share password as [REDACTED]', (world: SynoikiaWorld) => {
  expect(answerOf(world)).toMatchObject({ ok: true, value: { password: '[REDACTED]' } });
});

When('the harness run adds {string} to {string}', async (world: SynoikiaWorld, title: string, list: string) => {
  await run(world, opKey('add a task'), { list, title });
});

Then('the harness run is told that the operation is off', (world: SynoikiaWorld) => {
  expect(answerOf(world)).toMatchObject({ ok: false, error: { code: 'OPERATION_DISABLED' } });
});

Given('the test raises the group {string} to write', (world: SynoikiaWorld, group: string) => {
  harnessOf(world).setGroupLevel(group, 'write');
});

Then('the harness run gets the task {string}', (world: SynoikiaWorld, title: string) => {
  expect(answerOf(world)).toMatchObject({ ok: true, value: { title, done: false } });
});

// ── approvals ──

When(
  'the harness run adds {string} to {string}, and the test approves it',
  async (world: SynoikiaWorld, title: string, list: string) => {
    await run(world, opKey('add a task'), { list, title }, { onApproval: (a) => a.approve() });
  },
);

When(
  'the harness run adds {string} to {string}, and the test denies it',
  async (world: SynoikiaWorld, title: string, list: string) => {
    await run(world, opKey('add a task'), { list, title }, { onApproval: (a) => a.deny() });
  },
);

When(
  'the harness run adds {string} to {string}, and the test has no approval handler',
  async (world: SynoikiaWorld, title: string, list: string) => {
    await run(world, opKey('add a task'), { list, title });
  },
);

Then('the harness run is told that the call was denied', (world: SynoikiaWorld) => {
  expect(answerOf(world)).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
});

Given(
  'the harness run parked the add of {string} to {string} until a human approves it',
  async (world: SynoikiaWorld, title: string, list: string) => {
    const parked = await run(world, opKey('add a task'), { list, title }, { park: true });
    expect(parked).toMatchObject({ ok: false, status: 'awaiting_approval' });
    testOf(world).parked = parked;
  },
);

When('the test approves the parked add, and the harness run resumes it', async (world: SynoikiaWorld) => {
  const h = harnessOf(world);
  const parked = testOf(world).parked!;
  const approval = h.parkedApproval(parked);
  expect(approval.operationKey).toBe(opKey('add a task'));
  approval.approve();
  seenBy(world).harnessAnswer = await h.resume((parked as PendingResult).executionId);
});

Given('the test pre-approves adding any task to {string}', (world: SynoikiaWorld, list: string) => {
  harnessOf(world).addRule({
    operation: opKey('add a task'),
    match: [
      { field: '/list', op: 'prefix', value: list },
      { field: '/title', op: 'any' },
    ],
    reason: 'plugin author 3',
  });
});

Then(
  'the harness run gets the task {string}, and the audit log of the harness shows that a rule approved it',
  (world: SynoikiaWorld, title: string) => {
    expect(answerOf(world)).toMatchObject({ ok: true, value: { title } });
    const decisions = harnessOf(world)
      .audit({ operationKey: opKey('add a task') })
      .map((a) => a.decision);
    expect(decisions).toContainEqual(expect.stringMatching(/^auto-approved:rule:/));
  },
);

// ── typed confirmations ──

Given('the test sets {string} to ask in the harness', (world: SynoikiaWorld, name: string) => {
  harnessOf(world).setOperationLevel(opKey(name), 'ask');
});

When(
  'the harness run deletes the list {string}, and the test types {string} and then {string}',
  async (world: SynoikiaWorld, list: string, first: string, second: string) => {
    const t = testOf(world);
    await run(
      world,
      opKey('delete a list'),
      { list },
      {
        onApproval: (a) => {
          try {
            a.approve(first);
          } catch (err) {
            t.told.push((err as Error).message);
            a.approve(second);
          }
        },
      },
    );
  },
);

When(
  'the harness run deletes the list {string}, and the test types only {string}',
  async (world: SynoikiaWorld, list: string, typed: string) => {
    await run(world, opKey('delete a list'), { list }, { onApproval: (a) => a.approve(typed) });
  },
);

Then('the test was told to type {string} exactly', (world: SynoikiaWorld, literal: string) => {
  expect(testOf(world).told).toEqual([expect.stringContaining(`Type "${literal}" exactly`)]);
});

Then(
  'the harness run is told that the call was denied, and the harness kept the error of the test',
  (world: SynoikiaWorld) => {
    expect(answerOf(world)).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(harnessOf(world).approvalErrors.map(String)).toEqual([expect.stringContaining('exactly')]);
  },
);
