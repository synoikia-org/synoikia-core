import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { API_TOKEN, eventually } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

interface Supervision {
  inbox?: { title: string; message: string; event: string }[];
  adding?: Promise<Response>;
  stopMs?: number;
  seen?: { slug: string; status: string }[];
  answers?: Record<string, unknown>[];
}
const state = new WeakMap<SynoikiaWorld, Supervision>();
const of = (world: SynoikiaWorld) => {
  let s = state.get(world);
  if (!s) state.set(world, (s = {}));
  return s;
};

const instance = async (world: SynoikiaWorld, slug: string) =>
  world.expectOk(world.admin.get(`/api/instances/${world.instances.get(slug)!}`), 'read instance');

const pluginErrors = async (world: SynoikiaWorld) =>
  ((await world.audit({ decision: 'plugin_error' })) as unknown as { detail: { error: string } }[]).map(
    (r) => r.detail.error,
  );

/** The admin enables Acme Tasks and adds the instance without a sync; the answer comes once the first start ended. */
async function addInstance(world: SynoikiaWorld, slug: string) {
  const plugin = (await world.plugin())!;
  await world.expectOk(world.admin.patch(`/api/plugins/${plugin.id}`, { enabled: true }), 'enable plugin');
  return world.admin.post('/api/instances', {
    pluginId: 'tasks',
    slug,
    connection: { url: world.upstream!.url, token: API_TOKEN },
  });
}

async function addFailing(world: SynoikiaWorld, slug: string) {
  const created = await world.expectOk(addInstance(world, slug), 'create instance');
  world.instances.set(slug, created.id as string);
  world.lastInstance = slug;
  await eventually(async () => (await pluginErrors(world)).length > 0, 'a failed start');
}

/** ADR-0022: the plugin says it may stop when idle, and the admin sets the idle time of the instance. */
async function mayIdle(world: SynoikiaWorld, slug: string, minutes: number) {
  await world.editManifest((m) => (m.lifecycle = 'on-demand'));
  await world.instanceSettings(slug, { idleStopMs: minutes * 60_000 });
}

const moveTo = (world: SynoikiaWorld, slug: string, url: string) =>
  world.expectOk(
    world.admin.put(`/api/instances/${world.instances.get(slug)!}/connection`, {
      config: { url },
      secrets: { token: API_TOKEN },
    }),
    'save connection',
  );

Given(
  'core starts a failed plugin again after {int} milliseconds, and gives a start {int} second',
  async (world: SynoikiaWorld, pauseMs: number, seconds: number) => {
    world.supervision = { backoff: { initialMs: pauseMs, maxMs: pauseMs * 4 }, initTimeoutMs: seconds * 1000 };
    await world.restartCore();
  },
);

Given('the admin gets a notification when a plugin crashes', async (world: SynoikiaWorld) => {
  of(world).inbox = await world.notificationInbox(['plugin.crashed']);
});

Given('the admin gets a notification when a plugin crashes or a sync fails', async (world: SynoikiaWorld) => {
  of(world).inbox = await world.notificationInbox(['plugin.crashed', 'sync.failed']);
});

Given(
  'Acme Tasks runs as the instance {string}, and its plugin checks Acme when it starts',
  async (world: SynoikiaWorld, slug: string) => {
    await world.tasksInstance(slug);
    world.pluginFlag('start-check');
  },
);

Given('the plugin of {string} checks Acme when it starts', (world: SynoikiaWorld) => {
  world.pluginFlag('start-check');
});

Given('the plugin of {string} never finishes its start', (world: SynoikiaWorld) => {
  world.pluginFlag('hang', 'init');
});

Given('the plugin of {string} crashes during its start', (world: SynoikiaWorld) => {
  world.pluginFlag('crash', 'init');
});

Given(
  'the admin moved {string} to the address {string}, and its start failed twice',
  async (world: SynoikiaWorld, slug: string, url: string) => {
    await moveTo(world, slug, url);
    await eventually(async () => (await pluginErrors(world)).length >= 2, 'two failed starts');
  },
);

Given('the admin added the instance {string}, and its start failed', async (world: SynoikiaWorld, slug: string) => {
  await addFailing(world, slug);
});

Given('the admin started to add the instance {string}', async (world: SynoikiaWorld, slug: string) => {
  of(world).adding = addInstance(world, slug);
  await eventually(async () => {
    const list = (await world.expectOk(world.admin.get('/api/instances'), 'list instances')) as unknown as {
      id: string;
      slug: string;
      status: string;
    }[];
    const found = list.find((i) => i.slug === slug && i.status === 'starting');
    if (found) world.instances.set(slug, found.id);
    return !!found && world.pluginProcesses() === 1;
  }, 'the start to begin');
});

When('the plugin of {string} crashes', (world: SynoikiaWorld) => {
  world.pluginFlag('restart', String(Date.now()));
});

When('the admin moves {string} back to the address of Acme', async (world: SynoikiaWorld, slug: string) => {
  await moveTo(world, slug, world.upstream!.url);
});

When('the admin adds the instance {string}, and its start fails', async (world: SynoikiaWorld, slug: string) => {
  await addFailing(world, slug);
});

When(
  'the admin saves the connection of {string} four times at the same moment',
  async (world: SynoikiaWorld, slug: string) => {
    const id = await world.tasksInstance(slug);
    const save = () =>
      world.expectOk(
        world.admin.put(`/api/instances/${id}/connection`, { config: { url: world.upstream!.url } }),
        'save',
      );
    await Promise.all([save(), save(), save(), save()]);
  },
);

When('the admin disables {string} while it starts', async (world: SynoikiaWorld, slug: string) => {
  const s = of(world);
  const t0 = Date.now();
  await world.expectOk(
    world.admin.patch(`/api/instances/${world.instances.get(slug)!}`, { enabled: false }),
    'disable instance',
  );
  await s.adding;
  s.stopMs = Date.now() - t0;
});

Then(
  'the admin got the notification {string} because the plugin exited unexpectedly, and {string} is ready again',
  async (world: SynoikiaWorld, title: string, slug: string) => {
    const inbox = of(world).inbox!;
    await eventually(() => inbox.length > 0, 'the crash notification');
    expect(inbox[0]).toMatchObject({ title, message: expect.stringContaining('plugin exited unexpectedly') as string });
    await eventually(async () => (await instance(world, slug)).status === 'ready', 'the plugin to be ready');
  },
);

Then(
  'the admin sees that {string} is ready, after the errors {string}',
  async (world: SynoikiaWorld, slug: string, error: string) => {
    await eventually(async () => (await instance(world, slug)).status === 'ready', 'the plugin to be ready');
    const errors = await pluginErrors(world);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    for (const e of errors) expect(e).toBe(error);
  },
);

Then(
  'the admin sees that {string} is stopped, after the error {string}',
  async (world: SynoikiaWorld, slug: string, error: string) => {
    expect(await instance(world, slug)).toMatchObject({ status: 'stopped' });
    expect(await pluginErrors(world)).toContain(error);
    await eventually(() => world.pluginProcesses() === 0, 'the plugin to exit');
  },
);

Then(
  'the admin sees {string} with an error that says the plugin exited during its start',
  async (world: SynoikiaWorld, slug: string) => {
    await eventually(async () => (await instance(world, slug)).status === 'error', 'the error status');
    expect((await instance(world, slug)).statusError).toMatch(
      /^(init failed: Plugin exited|plugin exited unexpectedly)/,
    );
  },
);

Then(
  'the admin sees that {string} is ready, with one process of Acme Tasks and no plugin error',
  async (world: SynoikiaWorld, slug: string) => {
    expect(await instance(world, slug)).toMatchObject({ status: 'ready', statusError: null });
    await eventually(() => world.pluginProcesses() === 1, 'one plugin process');
    expect(await pluginErrors(world)).toEqual([]);
  },
);

Then(
  '{string} is stopped within 2 seconds, and no process of Acme Tasks runs',
  async (world: SynoikiaWorld, slug: string) => {
    expect(of(world).stopMs).toBeLessThan(2000);
    expect(await instance(world, slug)).toMatchObject({ status: 'stopped' });
    await eventually(() => world.pluginProcesses() === 0, 'the plugin to exit');
  },
);

Then('{string} stays stopped, and no process of Acme Tasks runs', async (world: SynoikiaWorld, slug: string) => {
  await new Promise((r) => setTimeout(r, 300));
  expect(await instance(world, slug)).toMatchObject({ status: 'stopped' });
  expect(world.pluginProcesses()).toBe(0);
  expect(await pluginErrors(world)).toEqual([]);
});

Then(
  'the instance, the audit log and the notifications show [REDACTED] in place of the API token',
  async (world: SynoikiaWorld) => {
    const inbox = of(world).inbox!;
    await eventually(() => inbox.length > 0, 'a notification');
    const audit = await world.audit({});
    const shown = [await instance(world, world.lastInstance), audit, inbox].map((part) => JSON.stringify(part));
    for (const part of shown) {
      expect(part).toContain('[REDACTED]');
      expect(part).not.toContain(API_TOKEN);
    }
  },
);

// ── idle stop (ADR-0022) ──

Given(
  'Acme Tasks runs as {string}, which may stop when idle, and the admin lets it stop after {int} minutes',
  async (world: SynoikiaWorld, slug: string, minutes: number) => {
    await mayIdle(world, slug, minutes);
    of(world).inbox = await world.notificationInbox([
      'instance.error',
      'instance.recovered',
      'plugin.crashed',
      'sync.failed',
      'sync.pending_review',
    ]);
  },
);

Given('{int} minutes go by without a call to {string}', async (world: SynoikiaWorld, minutes: number) => {
  world.passTime(minutes * 60_000);
  // Core looks for idle instances every 50 ms in the World.
  await new Promise((r) => setTimeout(r, 300));
});

Given('{string} went idle', async (world: SynoikiaWorld, slug: string) => {
  await world.tasksInstance(slug);
  if (!world.agents.has('7')) await world.credential('7', 'admin', 'write');
  await mayIdle(world, slug, 10);
  world.passTime(10 * 60_000);
  await eventually(async () => (await instance(world, slug)).status === 'idle', 'the instance to go idle');
});

Given('Acme Tasks is down', (world: SynoikiaWorld) => {
  world.pluginFlag('down');
});

When('the admin opens the instances', async (world: SynoikiaWorld) => {
  of(world).seen = (await world.expectOk(world.admin.get('/api/instances'), 'list instances')) as unknown as {
    slug: string;
    status: string;
  }[];
});

When(
  'agent {word} asks for the open tasks of {string}, and asks again at once',
  async (world: SynoikiaWorld, agent: string, list: string) => {
    const code = `return (await tasks.call('lists.tasks', { list: ${JSON.stringify(list)} })).map((t) => t.title);`;
    const answers = [];
    for (let i = 0; i < 2; i++) {
      await world.execute(agent, world.lastInstance, code);
      answers.push(world.answer);
    }
    of(world).answers = answers;
  },
);

Then('the admin sees {string} as idle, and no notification was sent', async (world: SynoikiaWorld, slug: string) => {
  expect(of(world).seen?.find((i) => i.slug === slug)).toMatchObject({ status: 'idle' });
  expect(world.pluginProcesses()).toBe(0);
  await new Promise((r) => setTimeout(r, 300));
  expect(of(world).inbox).toEqual([]);
});

Then(
  'agent {word} gets {string}, {string} and {string}, and the admin sees {string} as ready',
  async (world: SynoikiaWorld, _agent: string, a: string, b: string, c: string, slug: string) => {
    expect(world.answer).toEqual({ result: [a, b, c] });
    expect(await instance(world, slug)).toMatchObject({ status: 'ready' });
  },
);

Then(
  'agent {word} is told both times that {string} is unavailable, and the admin sees one failed start, with the next one after a pause',
  async (world: SynoikiaWorld) => {
    for (const answer of of(world).answers!) expect(answer).toMatchObject({ error: 'PLUGIN_UNAVAILABLE' });
    expect(await pluginErrors(world)).toHaveLength(1);
    expect(await instance(world, world.lastInstance)).toMatchObject({ status: 'error' });
    await eventually(async () => (await pluginErrors(world)).length === 2, 'the next start after a pause');
  },
);
