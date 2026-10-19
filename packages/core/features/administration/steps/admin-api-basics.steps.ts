import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { eventually } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';
import { identity, keep } from '../../identity/steps/identity.js';
import { admin, refusal } from './administration.js';

const CORE_PACKAGE = new URL('../../../package.json', import.meta.url);
const PORTAL_HTML = '<!doctype html><title>Synoikia portal</title><div id="app"></div>';

When(
  'the admin sends a connection test for {string} that is not well formed',
  async (world: SynoikiaWorld, slug: string) => {
    const id = await world.tasksInstance(slug);
    const cookie = [...world.admin.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    await keep(
      world,
      fetch(`${world.adminBase}/api/instances/${id}/connection/test`, {
        method: 'POST',
        headers: { cookie, 'x-csrf-token': world.admin.jar.get('syn_csrf')!, 'content-type': 'application/json' },
        body: '{"config": ',
      }),
    );
  },
);

Then(
  'the admin is told that the request is malformed, and the next connection test of {string} works',
  async (world: SynoikiaWorld, slug: string) => {
    expect(identity(world).answer.status).toBe(400);
    expect(refusal(world)).toBe('invalid_json');
    const id = await world.tasksInstance(slug);
    expect(await world.expectOk(world.admin.req('POST', `/api/instances/${id}/connection/test`), 'test')).toMatchObject(
      {
        ok: true,
      },
    );
  },
);

Given('the portal app is installed', async (world: SynoikiaWorld) => {
  const dir = path.join(world.dataDir, 'portal-app');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), PORTAL_HTML);
  await world.restartCore({ ADMIN_UI_DIR: dir });
});

When(
  'the admin asks the Admin API for something it does not have, and opens the portal page {string}',
  async (world: SynoikiaWorld, page: string) => {
    const unknown = await world.admin.get('/api/nothing-here');
    const portal = await world.admin.get(page);
    admin(world).seen.answers = [
      { status: unknown.status, type: unknown.headers.get('content-type'), text: await unknown.text() },
      { status: portal.status, type: portal.headers.get('content-type'), text: await portal.text() },
    ];
  },
);

Then(
  'the first answer is data that says {string}, and the second is the portal app',
  (world: SynoikiaWorld, message: string) => {
    const [unknown, portal] = admin(world).seen.answers as { status: number; type: string; text: string }[];
    expect(unknown!.status).toBe(404);
    expect(unknown!.type).toContain('application/json');
    expect(JSON.parse(unknown!.text)).toMatchObject({ error: 'not_found', message });
    expect(portal!.status).toBe(200);
    expect(portal!.type).toContain('text/html');
    expect(portal!.text).toBe(PORTAL_HTML);
  },
);

When(
  'the admin deletes {string} with the typed name {string}',
  async (world: SynoikiaWorld, slug: string, typed: string) => {
    const id = await world.tasksInstance(slug);
    await keep(world, world.admin.del(`/api/instances/${id}`, { confirm: typed }));
  },
);

const slugs = async (world: SynoikiaWorld) =>
  ((await world.expectOk(world.admin.get('/api/instances'), 'list instances')) as unknown as { slug: string }[]).map(
    (i) => i.slug,
  );

Then('the admin is told to type {string}, and {string} still runs', async (world: SynoikiaWorld, slug: string) => {
  expect(refusal(world)).toBe('confirmation_required');
  expect(await slugs(world)).toEqual([slug]);
  const id = await world.tasksInstance(slug);
  expect(await world.expectOk(world.admin.get(`/api/instances/${id}`), 'read instance')).toMatchObject({
    status: 'ready',
  });
});

Then('the admin no longer has the instance {string}', async (world: SynoikiaWorld, slug: string) => {
  expect(identity(world).answer.status).toBe(204);
  expect(await slugs(world)).not.toContain(slug);
});

When('the admin opens the overview', async (world: SynoikiaWorld) => {
  admin(world).seen.overview = await world.expectOk(world.admin.get('/api/overview'), 'open the overview');
  admin(world).seen.inbox = (await world.admin.get('/api/approvals')).status;
});

Then(
  'the admin sees the version of core and the sign-in methods of {string}, but no approval and no approval inbox',
  (world: SynoikiaWorld, slug: string) => {
    const overview = admin(world).seen.overview as Record<string, unknown>;
    const { version } = JSON.parse(readFileSync(CORE_PACKAGE, 'utf8')) as { version: string };
    expect(overview.version).toBe(version);
    expect(overview.instances).toEqual([expect.objectContaining({ slug, effectiveAuthMethods: ['bearer', 'oauth'] })]);
    expect(overview).not.toHaveProperty('pendingApprovals');
    expect(JSON.stringify(overview)).not.toContain('butter');
    expect(admin(world).seen.inbox).toBe(404);
  },
);

Given('the admin has the portal open', async (world: SynoikiaWorld) => {
  const res = await world.admin.get('/api/events');
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const s = admin(world);
  s.seen.events = '';
  world.cleanups.push(() => reader.cancel());
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      s.seen.events += new TextDecoder().decode(value);
    }
  })().catch(() => undefined);
});

Given('the plugin of {string} cannot list its operations', (world: SynoikiaWorld) => {
  world.pluginFlag('catalog-broken');
});

When('the admin syncs {string}, which fails', async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  const res = await world.admin.post(`/api/instances/${id}/sync`);
  expect(res.ok).toBe(false);
});

Then('the open portal gets the news that the sync of {string} failed', async (world: SynoikiaWorld, slug: string) => {
  const s = admin(world);
  await eventually(() => String(s.seen.events).includes('event: sync.failed'), 'the sync.failed event');
  const line = String(s.seen.events)
    .split('\n')
    .find((l, i, all) => all[i - 1] === 'event: sync.failed' && l.startsWith('data: '))!;
  expect(JSON.parse(line.slice('data: '.length))).toMatchObject({ slug, error: expect.any(String) as string });
});
