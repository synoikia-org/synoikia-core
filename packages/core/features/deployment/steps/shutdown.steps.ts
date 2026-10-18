import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { startCoreProcess } from '../../support/core-process.js';
import type { CoreProcess } from '../../support/core-process.js';
import { eventually } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

const state = new WeakMap<SynoikiaWorld, { liveView?: Promise<string>; stopMs: number; second?: CoreProcess }>();
const of = (world: SynoikiaWorld) => {
  let s = state.get(world);
  if (!s) state.set(world, (s = { stopMs: 0 }));
  return s;
};

Given('the admin watches the live view of the portal', async (world: SynoikiaWorld) => {
  const res = await world.admin.get('/api/events');
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  of(world).liveView = res.text().then(
    () => 'ended',
    () => 'cut',
  );
});

Given(
  'agent {word}, whose app opens approval links, adds {string} to {string} and waits on the link',
  async (world: SynoikiaWorld, agent: string, title: string, list: string) => {
    await world.app(agent, 'url');
    world.startCall(agent, 'add a task', { list, title });
    await eventually(() => world.prompts.length === 1, 'the approval link');
  },
);

When('the operator stops the server', async (world: SynoikiaWorld) => {
  const started = Date.now();
  await world.stopCore();
  of(world).stopMs = Date.now() - started;
});

Then('the server stopped within 2 seconds, and the live view of the portal ended', async (world: SynoikiaWorld) => {
  expect(of(world).stopMs).toBeLessThan(2000);
  expect(await of(world).liveView).toBe('ended');
});

Then('agent {word} is told that the add was denied by the shutdown', async (world: SynoikiaWorld) => {
  await world.callEnded();
  expect(JSON.stringify(world.answer)).toContain('denied (shutdown)');
});

Given(
  'agent {word} left the add of {string} to {string} waiting on a server that then crashed',
  async (world: SynoikiaWorld, agent: string, title: string, list: string) => {
    await world.stopCore();
    const run = await startCoreProcess(world, world.dataDir, world.coreEnv);
    expect(run.mcpBase, run.log).not.toBe('');
    const mcpBase = world.mcpBase;
    world.mcpBase = run.mcpBase;
    try {
      await world.call(agent, 'add a task', { list, title });
      expect(world.answer).toMatchObject({ status: 'awaiting_approval' });
    } finally {
      world.mcpBase = mcpBase;
    }
    run.child.kill('SIGKILL');
    await run.exited;
    const a = world.agents.get(agent)!;
    a.client = undefined;
    a.transport = undefined;
  },
);

Then(
  'the server log warns that it denied {int} approval left waiting by the previous run',
  (world: SynoikiaWorld, count: number) => {
    expect(world.serverLog).toContain(`WARN Denied ${count} approval(s) left pending by the previous run`);
  },
);

Then('the admin sees the same warning in the overview', async (world: SynoikiaWorld) => {
  await world.signInAgain();
  const overview = await world.expectOk(world.admin.get('/api/overview'), 'read overview');
  expect(overview.warnings).toContain('Denied 1 approval(s) left pending by the previous run');
});

When('a second server starts on the data directory of the running server', async (world: SynoikiaWorld) => {
  of(world).second = await startCoreProcess(world, world.dataDir);
});

Then(
  'the second server stops at once, because another server uses the data directory',
  async (world: SynoikiaWorld) => {
    const second = of(world).second!;
    await second.exited;
    expect(second.exitCode).not.toBe(0);
    expect(second.log).toContain(`Another server (pid ${process.pid}) is using ${world.dataDir}`);
    expect(second.mcpBase).toBe('');
    expect((await fetch(`${world.adminBase}/healthz`)).status).toBe(200);
  },
);
