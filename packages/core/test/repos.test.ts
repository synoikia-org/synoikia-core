import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppContext } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { auditLog, pluginInstances, plugins } from '../src/db/schema.js';
import { createAdminApp } from '../src/http/admin-app.js';
import { parsePublicKey } from '../src/plugins/minisign.js';
import { swapDirectory } from '../src/plugins/repos.js';
import { browser } from './admin-client.js';
import { testKey } from './minisign-keys.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures');
const PASSWORD = 'correct horse battery';
const INDEX_URL = 'https://plugins.example.com/index.json';

// ── repositories & installs ──

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function tmp(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** npm-pack style tarball of the echo fixture, with the manifest version overridden. */
function echoTarball(version: string, mutate?: (dir: string) => void) {
  const work = tmp('synoikia-pkg-');
  const pkg = path.join(work, 'package');
  cpSync(path.join(FIXTURES, 'plugins/echo'), pkg, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(pkg, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(path.join(pkg, 'manifest.json'), JSON.stringify({ ...manifest, version }));
  mutate?.(pkg);
  const file = path.join(work, 'out.tgz');
  tar.c({ gzip: true, cwd: work, file, sync: true, portable: true }, ['package']);
  return readFileSync(file);
}

/** A hand-built ustar archive, for entries node-tar refuses to create. */
function rawTar(entries: { name: string; type: string; body?: string; link?: string }[]) {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.from(e.body ?? '');
    const h = Buffer.alloc(512);
    h.write(e.name, 0);
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write(e.type, 156);
    if (e.link) h.write(e.link, 157);
    h.write('ustar\0', 257);
    h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function setup(opts: { preinstalled?: boolean; now?: () => Date; prepare?: (dataDir: string) => void } = {}) {
  const dataDir = tmp('synoikia-repos-');
  opts.prepare?.(dataDir);
  // A plugin already in place that no repository installed (copied in by hand).
  if (opts.preinstalled)
    cpSync(path.join(FIXTURES, 'plugins/echo'), path.join(dataDir, 'plugins/echo'), { recursive: true });
  const files = new Map<string, Buffer>();
  const fetched: string[] = [];
  const redirects = new Map<string, string>();
  const ctx = await createAppContext(loadConfig({ DATA_DIR: dataDir }), {
    memoryDb: true,
    now: opts.now,
    supervisor: { backoff: { initialMs: 20, maxMs: 100 }, initTimeoutMs: 3000, rpcTimeoutMs: 5000 },
    repoFetch: async (url, init) => {
      fetched.push(url);
      const to = redirects.get(url);
      if (to) {
        // Real fetch would follow on its own; the service must ask to see redirects itself.
        expect(init?.redirect).toBe('manual');
        return new Response(null, { status: 302, headers: { location: to } });
      }
      const body = files.get(url);
      return body ? new Response(new Uint8Array(body)) : new Response('missing', { status: 404 });
    },
  });
  cleanup.push(() => ctx.stop());
  const app = createAdminApp(ctx);
  const b = await browser(app).init();
  await b.post('/api/setup', { username: 'admin', password: PASSWORD });
  const publish = (index: unknown) => files.set(INDEX_URL, Buffer.from(JSON.stringify(index)));
  return { ctx, b, files, fetched, redirects, publish, dataDir };
}

function indexFor(
  key: ReturnType<typeof testKey> | null,
  versions: { version: string; tarball: Buffer; signature?: string | null; sha256?: string }[],
) {
  return {
    schema: 1,
    name: 'Test repo',
    ...(key ? { publicKey: key.publicKey } : {}),
    plugins: [
      {
        id: 'echo',
        name: 'Echo',
        versions: versions.map((v) => ({
          version: v.version,
          sdk: '^0.2.0',
          url: `echo-${v.version}.tgz`, // relative to the index URL
          sha256: v.sha256 ?? sha(v.tarball),
          ...(v.signature !== null && key ? { signature: v.signature ?? key.sign(v.tarball) } : {}),
        })),
      },
    ],
  };
}

describe('plugin repositories', () => {
  it('adds a signed repo only after the key id is confirmed, and installs verified plugins', async () => {
    const t = await setup();
    const key = testKey();
    const v1 = echoTarball('1.0.0');
    t.files.set('https://plugins.example.com/echo-1.0.0.tgz', v1);
    t.publish(indexFor(key, [{ version: '1.0.0', tarball: v1 }]));

    const first = await t.b.post('/api/plugin-repos', { url: INDEX_URL, signingMode: 'signed' });
    expect(first.status).toBe(409);
    const { details } = (await first.json()) as { details: { keyId: string; publicKey: string } };
    expect(details).toMatchObject({ keyId: parsePublicKey(key.publicKey).keyId, publicKey: key.publicKey });
    expect(((await (await t.b.get('/api/plugin-repos')).json()) as unknown[]).length).toBe(0);
    const wrong = await t.b.post('/api/plugin-repos', {
      url: INDEX_URL,
      signingMode: 'signed',
      confirmPublicKey: testKey().publicKey,
    });
    expect(wrong.status).toBe(409);
    const added = await t.b.post('/api/plugin-repos', {
      url: INDEX_URL,
      signingMode: 'signed',
      // As published in a .pub file, comment line included.
      confirmPublicKey: `untrusted comment: minisign public key ${details.keyId}\n${key.publicKey}\n`,
    });
    expect(added.status).toBe(201);
    const repo = (await added.json()) as { id: string; keyId: string; pluginCount: number };
    expect(repo).toMatchObject({ keyId: details.keyId, pluginCount: 1 });

    expect(await (await t.b.get('/api/plugin-repos/available')).json()).toMatchObject([
      { pluginId: 'echo', latest: '1.0.0', installed: null, blocked: null },
    ]);
    const installed = await t.b.post('/api/plugins/install', { repoId: repo.id, pluginId: 'echo', version: '1.0.0' });
    expect(installed.status).toBe(201);
    expect(await installed.json()).toMatchObject({
      pluginId: 'echo',
      repoId: repo.id,
      signatureVerified: true,
      sha256: sha(v1),
      // A new install waits for the admin to review and enable it (review L7).
      enabled: false,
      status: 'ok',
    });
    expect(existsSync(path.join(t.dataDir, 'plugins/echo/manifest.json'))).toBe(true);
    expect(t.fetched).toContain('https://plugins.example.com/echo-1.0.0.tgz');
    const pluginRow = t.ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'echo')).get()!;
    expect((await t.b.patch(`/api/plugins/${pluginRow.id}`, { enabled: true })).status).toBe(200);

    // The installed plugin actually runs.
    const inst = await t.ctx.instances.create({ pluginId: 'echo', slug: 'echo', connection: {} });
    await t.ctx.instances.syncNow(inst.id);

    // Update to 1.1.0: instances restart on the new files.
    const v11 = echoTarball('1.1.0');
    t.files.set('https://plugins.example.com/echo-1.1.0.tgz', v11);
    t.publish(
      indexFor(key, [
        { version: '1.0.0', tarball: v1 },
        { version: '1.1.0', tarball: v11 },
      ]),
    );
    await t.b.post(`/api/plugin-repos/${repo.id}/refresh`);
    expect(await (await t.b.get('/api/plugin-repos/available')).json()).toMatchObject([
      { latest: '1.1.0', installed: { version: '1.0.0', fromThisRepo: true }, updateAvailable: true },
    ]);
    expect(
      await (await t.b.post('/api/plugins/install', { repoId: repo.id, pluginId: 'echo', version: '1.1.0' })).json(),
    ).toMatchObject({ version: '1.1.0', enabled: true });
    expect(t.ctx.instances.status(inst.id)).toBe('ready');

    // 1.2.0 asks for more network hosts: it installs disabled until the admin reviews it (review L7).
    const v12 = echoTarball('1.2.0', (dir) => {
      const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
      writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...m, network: { hosts: ['*.example.net'] } }));
    });
    t.files.set('https://plugins.example.com/echo-1.2.0.tgz', v12);
    t.publish(
      indexFor(key, [
        { version: '1.0.0', tarball: v1 },
        { version: '1.1.0', tarball: v11 },
        { version: '1.2.0', tarball: v12 },
      ]),
    );
    await t.b.post(`/api/plugin-repos/${repo.id}/refresh`);
    expect(
      await (await t.b.post('/api/plugins/install', { repoId: repo.id, pluginId: 'echo', version: '1.2.0' })).json(),
    ).toMatchObject({ version: '1.2.0', enabled: false });
    expect(t.ctx.instances.status(inst.id)).toBe('stopped');
    const held = t.ctx.db
      .select()
      .from(auditLog)
      .all()
      .filter((a) => a.decision === 'plugin_updated')
      .at(-1);
    expect(held?.detail).toMatchObject({ version: '1.2.0', enabled: false, needsReview: ['network.hosts'] });

    // Uninstall is blocked while endpoints use the plugin, and the repo while plugins come from it.
    expect(await (await t.b.del('/api/plugins/echo')).json()).toMatchObject({ error: 'plugin_has_instances' });
    expect(await (await t.b.del(`/api/plugin-repos/${repo.id}`)).json()).toMatchObject({ error: 'repo_in_use' });
    await t.ctx.instances.remove(inst.id, 'echo');
    expect((await t.b.del('/api/plugins/echo')).status).toBe(204);
    expect(existsSync(path.join(t.dataDir, 'plugins/echo'))).toBe(false);
    expect((await t.b.del(`/api/plugin-repos/${repo.id}`)).status).toBe(204);

    const decisions = t.ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.kind, 'config'))
      .all()
      .map((a) => a.decision)
      .filter((d) => d?.startsWith('plugin_'));
    expect(decisions).toEqual([
      'plugin_repo_added',
      'plugin_installed',
      'plugin_enabled',
      'plugin_updated',
      'plugin_updated',
      'plugin_uninstalled',
      'plugin_repo_removed',
    ]);
  });

  it('adopts a plugin no repository installed, keeping its endpoints, and leaves it disabled for review', async () => {
    // A plugin copied in by hand, or built in before 0.3.0, with an endpoint on it.
    const t = await setup({ preinstalled: true });
    const before = t.ctx.db.select().from(plugins).get()!;
    expect(before).toMatchObject({ pluginId: 'echo', repoId: null });
    t.ctx.db.update(plugins).set({ enabled: true }).where(eq(plugins.id, before.id)).run();
    t.ctx.db
      .insert(pluginInstances)
      .values({ id: 'inst-1', pluginId: before.id, slug: 'echo', displayName: 'Echo', enabled: false })
      .run();

    const tarball = echoTarball('2.0.0');
    t.files.set('https://plugins.example.com/echo-2.0.0.tgz', tarball);
    t.publish(indexFor(null, [{ version: '2.0.0', tarball }]));
    const repo = await t.ctx.repos.add({ url: INDEX_URL, signingMode: 'unsigned' });
    expect(await (await t.b.get('/api/plugin-repos/available')).json()).toMatchObject([
      { blocked: null, installed: { version: '1.0.0', fromThisRepo: false, managed: false } },
    ]);
    const body = { repoId: repo.id, pluginId: 'echo', version: '2.0.0' };
    // An unsigned repository shows a warning in the portal, but the install needs no typed confirmation.
    expect(await (await t.b.post('/api/plugins/install', body)).json()).toMatchObject({
      id: before.id,
      version: '2.0.0',
      repoId: repo.id,
      enabled: false,
      signatureVerified: false,
    });
    expect(t.ctx.db.select().from(pluginInstances).get()).toMatchObject({ id: 'inst-1', pluginId: before.id });
    expect(t.ctx.db.select().from(auditLog).where(eq(auditLog.decision, 'plugin_adopted')).get()).toBeTruthy();
    expect(await (await t.b.get('/api/plugin-repos/available')).json()).toMatchObject([
      { blocked: null, installed: { version: '2.0.0', fromThisRepo: true, managed: true } },
    ]);
    // A client that still sends the typed id is not refused: the key is ignored.
    const old = await t.b.post('/api/plugins/install', { ...body, confirm: 'wrong' });
    expect(old.status).toBe(201);
    expect(await old.json()).toMatchObject({ id: before.id, version: '2.0.0' });
  });
});

// ── manual plugins (ADR-0013) ──

const withManifest = (patch: Record<string, unknown>) => (dir: string) => {
  const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...m, ...patch }));
};

type Uploaded = { uploadId: string; pluginId: string; version: string; sha256: string };

/** An unsigned repo offering echo 1.0.0, installed and enabled, with one running endpoint. */
async function withReleased(opts: Parameters<typeof setup>[0] = {}) {
  const t = await setup(opts);
  const v1 = echoTarball('1.0.0');
  t.files.set('https://plugins.example.com/echo-1.0.0.tgz', v1);
  t.publish(indexFor(null, [{ version: '1.0.0', tarball: v1 }]));
  const repo = await t.ctx.repos.add({ url: INDEX_URL, signingMode: 'unsigned' });
  const row = await t.ctx.repos.install({ repoId: repo.id, pluginId: 'echo', version: '1.0.0' });
  await t.ctx.instances.setPluginEnabled(row.id, true);
  const inst = await t.ctx.instances.create({ pluginId: 'echo', slug: 'echo', connection: { token: 's3cret' } });
  await t.ctx.instances.syncNow(inst.id);
  const upload = async (tarball: Buffer, fileName = 'echo.tgz') => {
    const res = await t.b.post('/api/plugins/uploads', new Uint8Array(tarball), { 'x-file-name': fileName });
    return { status: res.status, body: (await res.json()) as Uploaded & Record<string, unknown> };
  };
  const installUpload = async (uploadId: string, body: unknown = {}) => {
    const res = await t.b.post(`/api/plugins/uploads/${uploadId}/install`, body);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const audit = (decision: string) =>
    t.ctx.db
      .select()
      .from(auditLog)
      .all()
      .filter((a) => a.decision === decision);
  return { ...t, v1, repo, row, inst, upload, installUpload, audit };
}

describe('manual plugins', () => {
  it('replaces a repository plugin with an upload, keeps its endpoint and connection, and reverts', async () => {
    const t = await withReleased();
    const instBefore = t.ctx.db.select().from(pluginInstances).get()!;
    const dev = echoTarball('1.1.0-dev.1');

    const staged = await t.upload(dev, 'echo-1.1.0-dev.1.tgz');
    expect(staged).toMatchObject({
      status: 201,
      body: {
        pluginId: 'echo',
        version: '1.1.0-dev.1',
        sha256: sha(dev),
        fileName: 'echo-1.1.0-dev.1.tgz',
        sdkCompatible: true,
        replaces: { version: '1.0.0', repoName: 'Test repo', manual: false, enabled: true },
        permissionChanges: [],
      },
    });
    const installed = await t.installUpload(staged.body.uploadId);
    expect(installed).toMatchObject({
      status: 200,
      body: {
        id: t.row.id,
        version: '1.1.0-dev.1',
        repoId: t.repo.id,
        sha256: sha(dev),
        signatureVerified: false,
        // No permission change: the build runs at once on the live endpoint.
        enabled: true,
        manual: { fileName: 'echo-1.1.0-dev.1.tgz', releasedVersion: '1.0.0', uploadedAt: expect.any(String) },
      },
    });
    const instAfter = t.ctx.db.select().from(pluginInstances).get()!;
    expect(instAfter).toMatchObject({ id: instBefore.id, pluginId: t.row.id, config: instBefore.config });
    expect(instAfter.secretsEnc?.equals(instBefore.secretsEnc!)).toBe(true);
    expect(t.ctx.instances.status(t.inst.id)).toBe('ready');
    expect(await (await t.b.get('/api/plugins')).json()).toMatchObject([
      { pluginId: 'echo', manual: { releasedVersion: '1.0.0' }, instances: 1 },
    ]);
    expect(t.audit('plugin_manual_installed')[0]?.detail).toEqual({
      pluginId: 'echo',
      version: '1.1.0-dev.1',
      previousVersion: '1.0.0',
      sha256: sha(dev),
      fileName: 'echo-1.1.0-dev.1.tgz',
      releasedVersion: '1.0.0',
      enabled: true,
    });
    // The upload is used up.
    expect(await t.installUpload(staged.body.uploadId)).toMatchObject({
      status: 404,
      body: { error: 'upload_not_found' },
    });

    // A second build keeps the released version to revert to.
    const dev2 = echoTarball('1.1.0-dev.2');
    const again = await t.upload(dev2);
    expect(again.body).toMatchObject({ replaces: { version: '1.1.0-dev.1', manual: true } });
    // A client that still sends the typed id is not refused.
    expect((await t.installUpload(again.body.uploadId, { confirm: 'wrong' })).body).toMatchObject({
      version: '1.1.0-dev.2',
      manual: { releasedVersion: '1.0.0' },
    });

    const reverted = await t.b.post(`/api/plugins/${t.row.id}/revert`);
    expect(reverted.status).toBe(200);
    expect(await reverted.json()).toMatchObject({
      id: t.row.id,
      version: '1.0.0',
      sha256: sha(t.v1),
      manual: null,
      enabled: true,
    });
    expect(t.ctx.instances.status(t.inst.id)).toBe('ready');
    expect(t.audit('plugin_manual_reverted')[0]?.detail).toMatchObject({
      version: '1.0.0',
      previousVersion: '1.1.0-dev.2',
      replacedFile: 'echo.tgz',
      replacedSha256: sha(dev2),
    });
    expect(await (await t.b.post(`/api/plugins/${t.row.id}/revert`)).json()).toMatchObject({
      error: 'not_manual',
    });
    expect(readdirSync(path.join(t.dataDir, 'plugins-staging'))).toEqual([]);
  });

  it('refuses oversized, broken, incompatible, unnamed, replaced and expired uploads', async () => {
    let clock = new Date('2026-01-01T00:00:00Z');
    const t = await withReleased({
      now: () => clock,
      prepare: (dir) => mkdirSync(path.join(dir, 'plugins-staging/upload-stale'), { recursive: true }),
    });
    // Uploads staged before a restart are gone.
    expect(existsSync(path.join(t.dataDir, 'plugins-staging/upload-stale'))).toBe(false);

    const big = await t.b.post('/api/plugins/uploads', new Uint8Array(50 * 1024 * 1024 + 1), {
      'x-file-name': 'big.tgz',
    });
    expect(big.status).toBe(400);
    expect(await big.json()).toMatchObject({ error: 'too_large' });
    await expect(t.ctx.repos.stageUpload(Buffer.alloc(50 * 1024 * 1024 + 1), 'big.tgz')).rejects.toMatchObject({
      code: 'too_large',
    });
    // A chunked body has no content-length; the limit still applies while it streams.
    let sent = 0;
    const chunked = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > 51 * 1024 * 1024) return controller.close();
        sent += 1024 * 1024;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const streamed = await t.b.post('/api/plugins/uploads', chunked, { 'x-file-name': 'big.tgz' });
    expect(await streamed.json()).toMatchObject({ error: 'too_large' });

    // Overlapping uploads: the second is refused while the first extracts.
    const overlapping = await Promise.allSettled([
      t.ctx.repos.stageUpload(echoTarball('1.1.0'), 'a.tgz'),
      t.ctx.repos.stageUpload(echoTarball('1.1.1'), 'b.tgz'),
    ]);
    expect(overlapping.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(overlapping[1]).toMatchObject({ reason: { code: 'upload_in_progress', status: 409 } });

    const manifest = readFileSync(path.join(FIXTURES, 'plugins/echo/manifest.json'), 'utf8');
    const linked = rawTar([
      { name: 'manifest.json', type: '0', body: manifest },
      { name: 'index.mjs', type: '2', link: '/etc/passwd' },
    ]);
    expect((await t.upload(linked)).body).toMatchObject({ error: 'invalid_archive' });
    expect((await t.upload(Buffer.from('not a tarball at all'))).body).toMatchObject({ error: 'invalid_archive' });
    const unbuilt = echoTarball('1.1.0', (dir) => rmSync(path.join(dir, 'index.mjs')));
    expect((await t.upload(unbuilt)).body).toMatchObject({ error: 'invalid_plugin' });

    const noName = await t.b.post('/api/plugins/uploads', new Uint8Array(echoTarball('1.1.0')));
    expect(await noName.json()).toMatchObject({ error: 'invalid_request' });
    expect((await t.upload(echoTarball('1.1.0'), '../echo.tgz')).body).toMatchObject({ error: 'invalid_request' });
    const queried = await t.b.post(
      `/api/plugins/uploads?fileName=${encodeURIComponent('é.tgz')}`,
      new Uint8Array(echoTarball('1.1.0')),
    );
    expect(await queried.json()).toMatchObject({ fileName: 'é.tgz' });
    expect((await t.upload(echoTarball('1.1.0'), '%E0')).body).toMatchObject({ error: 'invalid_file_name' });
    for (const name of ['acme-1.2.0\u202Ezgt.lave', 'a\u2066b.tgz', 'a\u0085b.tgz', 'a\tb.tgz']) {
      const res = await t.upload(echoTarball('1.1.0'), encodeURIComponent(name));
      expect(res.body).toMatchObject({ error: 'invalid_file_name' });
    }

    const future = await t.upload(echoTarball('1.1.0', withManifest({ sdk: '^9.0.0' })));
    expect(future.body).toMatchObject({ sdkCompatible: false, sdk: '^9.0.0' });
    expect((await t.installUpload(future.body.uploadId)).body).toMatchObject({ error: 'incompatible' });

    // A new upload replaces the staged one.
    const first = await t.upload(echoTarball('1.1.0'));
    const second = await t.upload(echoTarball('1.2.0'));
    expect((await t.installUpload(first.body.uploadId)).body).toMatchObject({ error: 'upload_not_found' });

    clock = new Date(clock.getTime() + 16 * 60_000);
    expect(await t.installUpload(second.body.uploadId)).toMatchObject({
      status: 409,
      body: { error: 'upload_expired' },
    });
    expect(readdirSync(path.join(t.dataDir, 'plugins-staging'))).toEqual([]);
    expect(t.ctx.db.select().from(plugins).get()).toMatchObject({ version: '1.0.0', manual: null, enabled: true });
    expect(t.audit('plugin_manual_installed')).toHaveLength(0);
  });
});

describe('swapDirectory (review L5)', () => {
  it('replaces the directory, or puts the old one back when the new one cannot be moved in', () => {
    const root = tmp('synoikia-swap-');
    const target = path.join(root, 'plugins/echo');
    const next = path.join(root, 'staging/new');
    mkdirSync(target, { recursive: true });
    mkdirSync(next, { recursive: true });
    writeFileSync(path.join(target, 'v'), '1');
    writeFileSync(path.join(next, 'v'), '2');

    const failing = (from: string, to: string) => {
      if (from === next) throw new Error('disk full');
      renameSync(from, to);
    };
    expect(() => swapDirectory(next, target, path.join(root, 'staging/old-1'), failing)).toThrow('disk full');
    expect(readFileSync(path.join(target, 'v'), 'utf8')).toBe('1');
    expect(existsSync(path.join(root, 'staging/old-1'))).toBe(false);

    swapDirectory(next, target, path.join(root, 'staging/old-2'));
    expect(readFileSync(path.join(target, 'v'), 'utf8')).toBe('2');
    expect(existsSync(path.join(root, 'staging/old-2'))).toBe(false);
  });
});
