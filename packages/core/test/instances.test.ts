import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalLinkService } from '../src/approvals/links.js';
import { ApprovalService } from '../src/approvals/service.js';
import { setGroupLevel } from '../src/catalog/groups.js';
import { SecretBox } from '../src/crypto/index.js';
import { openDatabase } from '../src/db/index.js';
import { auditLog, pluginInstances, plugins } from '../src/db/schema.js';
import { ConflictError, ValidationError } from '../src/errors.js';
import { CoreEvents } from '../src/events.js';
import { SlidingWindowLimiter } from '../src/gate/rate-limit.js';
import { InstanceManager } from '../src/instances/manager.js';
import { discoverPlugins, syncPluginRegistry } from '../src/plugins/discovery.js';
import { executeCode, searchCode } from '../src/runtime/index.js';

const PLUGINS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/plugins');

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function setup(opts: { versionCheckIntervalMs?: number; pluginsDir?: string; now?: () => Date } = {}) {
  const db = openDatabase(':memory:');
  syncPluginRegistry(db, discoverPlugins(opts.pluginsDir ?? PLUGINS));
  db.update(plugins).set({ enabled: true }).run();
  const events = new CoreEvents();
  const seen: { name: string; payload: unknown }[] = [];
  for (const name of ['instance.status', 'sync.completed', 'sync.failed', 'plugin.crashed'] as const) {
    events.on(name, (payload: unknown) => seen.push({ name, payload }));
  }
  const secrets = SecretBox.fromKey(randomBytes(32));
  const manager = new InstanceManager({
    db,
    secrets,
    events,
    supervisor: { backoff: { initialMs: 20, maxMs: 100 }, initTimeoutMs: 2000, rpcTimeoutMs: 5000 },
    versionCheckIntervalMs: opts.versionCheckIntervalMs ?? 0,
    now: opts.now,
  });
  cleanup.push(() => manager.stopAll());
  return { db, manager, events, seen, secrets };
}

const create = (
  manager: InstanceManager,
  connection: Record<string, unknown> = { token: 'super-secret-token-1234' },
  slug = 'echo',
) => manager.create({ pluginId: 'echo', slug, connection });

describe('InstanceManager', () => {
  it('starts and stops with instance and plugin toggles, and deletes with confirmation', async () => {
    const t = setup();
    const inst = await create(t.manager);
    await t.manager.update(inst.id, { enabled: false });
    expect(t.manager.status(inst.id)).toBe('stopped');
    await t.manager.update(inst.id, { enabled: true });
    expect(t.manager.status(inst.id)).toBe('ready');

    const plugin = t.db.select().from(plugins).get()!;
    await t.manager.setPluginEnabled(plugin.id, false);
    expect(t.manager.status(inst.id)).toBe('stopped');
    await t.manager.setPluginEnabled('echo', true);
    expect(t.manager.status(inst.id)).toBe('ready');

    await expect(t.manager.update(inst.id, { slug: 'Bad Slug' })).rejects.toBeInstanceOf(ValidationError);
    await expect(t.manager.remove(inst.id, 'wrong')).rejects.toBeInstanceOf(ConflictError);
    await t.manager.remove(inst.id, 'echo');
    expect(t.db.select().from(pluginInstances).all()).toEqual([]);
  });

  it('times sync freshness and version checks by the injected clock', async () => {
    let clock = new Date('2026-01-01T00:00:00Z');
    const advance = (ms: number) => (clock = new Date(clock.getTime() + ms));
    const t = setup({ versionCheckIntervalMs: 30 * 60_000, now: () => clock });
    const syncs = () => t.seen.filter((e) => e.name === 'sync.completed').length;
    const inst = await create(t.manager, { version: '1.0' });
    await t.manager.ensureFresh(inst.id);
    expect(syncs()).toBe(1);

    // The upstream version changes, but the next check is not due yet.
    await t.manager.updateConnection(inst.id, { config: { version: '2.0' } });
    await t.manager.ensureFresh(inst.id);
    expect(syncs()).toBe(1);
    advance(31 * 60_000);
    await t.manager.ensureFresh(inst.id);
    expect(syncs()).toBe(2);
    expect(t.manager.get(inst.id).upstreamVersion).toBe('2.0');

    // Older than syncMaxAgeMs (1 h by default): synced again with no version change.
    advance(61 * 60_000);
    await t.manager.ensureFresh(inst.id);
    expect(syncs()).toBe(3);

    await t.manager.syncStale();
    expect(syncs()).toBe(3);
    advance(25 * 60 * 60_000);
    await t.manager.syncStale();
    expect(syncs()).toBe(4);
  });

  it('rechecks the upstream version mid-session only after the interval, and syncs on a change (test gap 12)', async () => {
    const t = setup({ versionCheckIntervalMs: 200 });
    const inst = await create(t.manager, { version: '1.0' });
    await t.manager.ensureFresh(inst.id);
    const syncs = () => t.seen.filter((e) => e.name === 'sync.completed').length;
    const before = syncs();

    // The upstream is upgraded while the session runs.
    await t.manager
      .runtime(inst.id)
      .plugin()
      .call('invoke', {
        key: 'k',
        params: { action: 'set-version', version: '2.0' },
        context: { callId: 'c', deadlineMs: 1000 },
      });
    await t.manager.ensureFresh(inst.id);
    expect(syncs()).toBe(before); // within the interval: no version check at all
    expect(t.manager.get(inst.id).upstreamVersion).toBe('1.0');

    await new Promise((r) => setTimeout(r, 250));
    await t.manager.ensureFresh(inst.id);
    expect(syncs()).toBe(before + 1);
    expect(t.manager.get(inst.id).upstreamVersion).toBe('2.0');
  });

  it('runs search (catalog, guides) and execute through the manager runtime', async () => {
    const t = setup();
    const inst = await create(t.manager);
    await t.manager.syncNow(inst.id);
    setGroupLevel(t.db, inst.id, 'echo', 'write');

    const approvals = new ApprovalService(t.db, new ApprovalLinkService(t.db));
    cleanup.push(() => approvals.cancelAll());
    const deps = { db: t.db, approvals, limiter: new SlidingWindowLimiter(), attestationKey: randomBytes(32) };
    const rt = t.manager.runtime(inst.id);
    // Level Write with every write acknowledged: echo.guided runs without anyone approving it.
    const caller = {
      client: { kind: 'mcp_client' as const, id: 'c' },
      principal: { ceiling: 'write' as const, roleId: 'admin' },
    };

    const guide = await searchCode(deps, rt, caller, `return await guides.get('echo.guided');`);
    expect(guide).toMatchObject({ ok: true, value: { required: true, version: 'v1', content: 'Read me first.' } });
    const key = (guide as { value: { best_practice_key: string } }).value.best_practice_key;

    const r = await executeCode(
      deps,
      rt,
      caller,
      `return (await ha_or_echo()).key; async function ha_or_echo() { return echo.call('echo.guided', { best_practice_key: ${JSON.stringify(key)} }); }`,
    );
    expect(r).toMatchObject({ ok: true, value: 'echo.guided' });
    // Reading the guide is audited (review M17).
    expect(
      t.db
        .select()
        .from(auditLog)
        .all()
        .find((a) => a.decision === 'guide_read'),
    ).toMatchObject({
      kind: 'search',
      operationKey: 'echo.guided',
      actorId: 'c',
      detail: { guideVersion: 'v1' },
    });
    await expect(searchCode(deps, rt, caller, `return typeof registry`)).resolves.toMatchObject({ value: 'undefined' });
  });
});
