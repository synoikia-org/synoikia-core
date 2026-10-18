import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { applyRegistrySync } from '../src/catalog/registry.js';
import { operations, plugins } from '../src/db/schema.js';
import { createAdminApp } from '../src/http/admin-app.js';
import { browser } from './admin-client.js';
import { createTestApp } from './helpers.js';

const PASSWORD = 'correct horse battery';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/** An admin, two echo endpoints, and a role "Operators" holding the first with `switches` on it, with a
 * signed-in user of that role. */
async function setup(switches: Record<string, boolean> = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-roles-'));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const ctx = await createTestApp({ DATA_DIR: dataDir }, { memoryDb: true });
  cleanup.push(() => ctx.stop());
  const app = createAdminApp(ctx);
  const admin = await browser(app).init();
  expect((await admin.post('/api/setup', { username: 'admin', password: PASSWORD })).status).toBe(200);
  const inst = (await (
    await admin.post('/api/instances', { pluginId: 'echo', slug: 'echo', connection: {} })
  ).json()) as { id: string };
  const other = (await (
    await admin.post('/api/instances', { pluginId: 'echo', slug: 'other', connection: {} })
  ).json()) as { id: string };
  await ctx.instances.syncNow(inst.id);
  await ctx.instances.syncNow(other.id);
  const role = (await (await admin.post('/api/roles', { name: 'Operators' })).json()) as { id: string };
  expect((await admin.put(`/api/roles/${role.id}/instances`, { instanceIds: [inst.id] })).status).toBe(200);
  if (Object.keys(switches).length)
    expect((await admin.patch(`/api/roles/${role.id}/endpoints/${inst.id}`, switches)).status).toBe(200);
  const created = await admin.post('/api/users', { username: 'olga', password: PASSWORD, roleId: role.id });
  expect(created.status).toBe(201);
  const user = await browser(app).init();
  expect((await user.post('/auth/login', { username: 'olga', password: PASSWORD })).status).toBe(200);
  const userId = ((await created.json()) as { id: string }).id;
  return { ctx, app, admin, user, userId, instanceId: inst.id, otherId: other.id, roleId: role.id };
}

describe('roles: admin API', () => {
  it('keeps every route outside the profile and /api/me admin-only', async () => {
    const t = await setup({ canSetOwnLevels: true, canManageOwnRules: true, canSeeStatus: true });
    const open = ['/api/session', '/api/setup', '/api/profile', '/api/me'];
    const routes = t.app.routes.filter(
      (r) =>
        r.method !== 'ALL' &&
        r.path.startsWith('/api/') &&
        !open.some((p) => r.path === p || r.path.startsWith(`${p}/`)),
    );
    expect(routes.length).toBeGreaterThan(40);
    expect(routes.map((r) => r.path)).toContain('/api/settings/mcp/clients-seen');
    for (const r of routes) {
      const res = await t.user.req(r.method, r.path.replace(/:[a-zA-Z]+/g, 'x'), r.method === 'GET' ? undefined : {});
      expect({ route: `${r.method} ${r.path}`, status: res.status }).toEqual({
        route: `${r.method} ${r.path}`,
        status: 403,
      });
    }
  });
});

describe('own-rule pickers', () => {
  it('serve only the option sources and registry kinds of rules the user may write', async () => {
    const t = await setup({ canManageOwnRules: true });
    const base = `/api/me/endpoints/${t.instanceId}`;
    // The echo fixture declares no pickers: give its match profile a targets field and an options source.
    const pluginRow = t.ctx.db.select().from(plugins).get()!;
    const manifest = structuredClone(pluginRow.manifest) as {
      targets?: unknown;
      matchProfiles: Record<string, unknown[]>;
    };
    manifest.targets = {
      label: 'Volumes',
      registryKind: 'volume',
      scopes: [{ key: 'pool', label: 'Pool', registryKind: 'pool' }],
    };
    manifest.matchProfiles['name-prefix'] = [
      { field: '/name', label: 'Name', op: 'prefix', widget: 'prefix', optionsSource: 'names' },
      { field: '$targets', label: 'Volumes', widget: 'registry-picker' },
    ];
    // A read with its own profile: its source must stay closed, rules only fit writes.
    manifest.matchProfiles['reads'] = [
      { field: '/q', label: 'Query', op: 'eq', widget: 'select', optionsSource: 'readnames' },
    ];
    t.ctx.db.update(plugins).set({ manifest }).where(eq(plugins.id, pluginRow.id)).run();
    t.ctx.db.update(operations).set({ matchProfile: 'reads' }).where(eq(operations.key, 'echo.query')).run();
    applyRegistrySync(t.ctx.db, t.instanceId, [
      { kind: 'volume', id: 'vol/a', name: 'A', attrs: { token: 'upstream-secret' } },
      { kind: 'disk', id: 'sda', name: 'Disk' },
    ]);

    // echo.set is unreachable until the role opens it: no pickers yet.
    expect((await t.user.get(`${base}/registry?kind=volume`)).status).toBe(404);
    await t.admin.put(`/api/roles/${t.roleId}/endpoints/${t.instanceId}/groups/echo`, { level: 'ask' });

    const res = await t.user.get(`${base}/registry?kind=volume`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(await res.json());
    expect(body).toContain('vol/a');
    expect(body).not.toContain('upstream-secret');
    expect((await t.user.get(`${base}/registry?kind=disk`)).status).toBe(404);
    expect((await t.user.get(`${base}/options/other`)).status).toBe(404);
    expect((await t.user.get(`${base}/options/readnames`)).status).toBe(404);
    // Options reach the user as value and label only, redacted.
    await t.admin.put(`/api/instances/${t.instanceId}/connection`, {
      secrets: { token: 'connection-secret-4321' },
    });
    const options = await t.user.get(`${base}/options/names?q=x`);
    expect(options.status).toBe(200);
    const text = JSON.stringify(await options.json());
    expect(text).toContain('"value":"a"');
    expect(text).not.toContain('connection-secret-4321');
    expect(text).not.toContain('meta-secret');
    expect((await t.user.get(`/api/me/endpoints/${t.otherId}/registry?kind=volume`)).status).toBe(404);

    // Declared targets alone open nothing: a rule field must select them.
    manifest.matchProfiles['name-prefix'] = manifest.matchProfiles['name-prefix']!.slice(0, 1);
    t.ctx.db.update(plugins).set({ manifest }).where(eq(plugins.id, pluginRow.id)).run();
    expect((await t.user.get(`${base}/registry?kind=volume`)).status).toBe(404);

    await t.admin.patch(`/api/roles/${t.roleId}/endpoints/${t.instanceId}`, { canManageOwnRules: false });
    expect((await t.user.get(`${base}/registry?kind=volume`)).status).toBe(403);
    expect((await t.user.get(`${base}/options/names`)).status).toBe(403);
  });
});
