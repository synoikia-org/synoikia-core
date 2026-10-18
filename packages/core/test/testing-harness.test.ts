import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPluginHarness } from '../src/testing/index.js';
import type { PendingResult, PluginHarness } from '../src/testing/index.js';

/** The plugin harness, exercised with the echo fixture so core's suite never names a plugin. */

const ECHO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/plugins/echo');

let h: PluginHarness;

beforeAll(async () => {
  h = await startPluginHarness({ pluginDir: ECHO, connection: { token: 'tok-secret' }, slug: 'echo-e2e' });
}, 30_000);

afterAll(async () => {
  await h?.stop();
});

describe('startPluginHarness', () => {
  it('starts groups at Ask, runs reads, redacts results and refuses writes at Read', async () => {
    expect(h.operation('echo.set')).toBeDefined();
    h.setGroupLevel('echo', 'read');
    await expect(h.execute(`return await echo.call('echo.query', { n: 1 });`)).resolves.toMatchObject({
      ok: true,
      value: { key: 'echo.query', params: { n: 1 }, password: '[REDACTED]' },
    });
    await expect(h.execute(`return await echo.call('echo.set', { name: 'a' });`)).resolves.toMatchObject({
      ok: false,
      error: { code: 'OPERATION_DISABLED' },
    });
    await expect(h.search(`return (await catalog.find({ text: 'echo.query' })).length > 0;`)).resolves.toMatchObject({
      ok: true,
      value: true,
    });
  });

  it('parks a call like a client without prompts, and resumes it after the approval', async () => {
    h.setGroupLevel('echo', 'ask');
    const parked = await h.execute(`return (await echo.call('echo.set', { name: 'p' })).params;`, { park: true });
    expect(parked).toMatchObject({ ok: false, status: 'awaiting_approval' });
    const approval = h.parkedApproval(parked);
    expect(approval.operationKey).toBe('echo.set');
    approval.approve();
    const done = await h.resume((parked as PendingResult).executionId);
    expect(done).toMatchObject({ ok: true, value: { name: 'p' } });
    expect(() => h.parkedApproval(done)).toThrow(/not waiting/);
  });

  it('tests a candidate connection in a throwaway child', async () => {
    await expect(h.testConnection({ token: 'other' })).resolves.toMatchObject({ ok: true });
  });
});

describe('startPluginHarness failures', () => {
  it('removes its working directory on stop', async () => {
    const t = await startPluginHarness({ pluginDir: ECHO, connection: {}, sync: false });
    const staged = t.ctx.config.DATA_DIR;
    expect(existsSync(path.join(staged, 'plugins', 'echo', 'index.mjs'))).toBe(true);
    expect(t.operations()).toEqual([]);
    await t.stop();
    expect(existsSync(staged)).toBe(false);
  });
});
