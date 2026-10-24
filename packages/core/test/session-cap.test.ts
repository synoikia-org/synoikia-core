import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/app.js';
import { pluginInstances } from '../src/db/schema.js';
import { MAX_SESSIONS_PER_ENDPOINT, MAX_SESSIONS_PER_PRINCIPAL } from '../src/http/mcp/endpoint.js';
import { startServers } from '../src/server.js';
import type { RunningServers } from '../src/server.js';
import { createTestApp } from './helpers.js';

let ctx: AppContext;
let servers: RunningServers;
let dataDir: string;
let base: string;
let instanceId: string;
let userId: string;
/** Five more endpoints, so one credential can pass the ceiling of 64. */
const slugs = ['echo', 'echo-2', 'echo-3', 'echo-4', 'echo-5', 'echo-6'];

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-sessions-'));
  ctx = await createTestApp(
    { DATA_DIR: dataDir, MCP_HOST: '127.0.0.1', MCP_PORT: '0', ADMIN_HOST: '127.0.0.1', ADMIN_PORT: '0' },
    { memoryDb: true },
  );
  userId = (await ctx.users.create({ username: 'admin', password: 'correct horse battery' })).id;
  servers = await startServers(ctx);
  base = `http://127.0.0.1:${servers.mcp.port}`;
  instanceId = (await ctx.instances.create({ pluginId: 'echo', slug: 'echo', connection: {} })).id;
  await ctx.instances.syncNow(instanceId);
  for (const slug of slugs.slice(1)) {
    const { id } = await ctx.instances.create({ pluginId: 'echo', slug, connection: {} });
    await ctx.instances.syncNow(id);
  }
});
afterAll(async () => {
  await servers?.close();
  await ctx?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

const headers = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  ...extra,
});

async function open(token: string, slug = 'echo') {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'burst', version: '1' } },
  });
  const res = await fetch(`${base}/${slug}`, { method: 'POST', headers: headers(token), body });
  await res.text();
  return res.headers.get('mcp-session-id');
}

async function alive(token: string, id: string, slug = 'echo') {
  const res = await fetch(`${base}/${slug}`, {
    method: 'POST',
    headers: headers(token, { 'mcp-session-id': id, 'mcp-protocol-version': '2025-06-18' }),
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
  });
  await res.text();
  return res.status === 200;
}

// ADR-0015: the cap holds also when the opens wait for one sync and resume together.
describe('the session cap of a credential on an endpoint', () => {
  it('keeps at most 16 sessions when 24 open at once during a sync', async () => {
    const { token } = ctx.tokens.create({ name: 'burst', scope: ['*'] }, { userId });
    const warm = ctx.tokens.create({ name: 'warm', scope: ['*'] }, { userId }).token;
    await Promise.all(Array.from({ length: 24 }, () => open(warm)));
    ctx.db.update(pluginInstances).set({ lastSyncedAt: null }).where(eq(pluginInstances.id, instanceId)).run();
    const ids = (await Promise.all(Array.from({ length: 24 }, () => open(token)))).filter((id): id is string => !!id);
    // A session closed while it opened answers without its id; the others are counted below.
    let live = 0;
    for (const id of ids) if (await alive(token, id)) live++;
    expect(live).toBe(MAX_SESSIONS_PER_ENDPOINT);
  });

  it('closes one session when both caps apply, and keeps at most 64 when 80 open at once', async () => {
    const { token } = ctx.tokens.create({ name: 'wide', scope: ['*'] }, { userId });
    const opened: { slug: string; id: string }[] = [];
    // The oldest sessions are on other endpoints, so only the cap of "echo" should close one.
    for (const slug of ['echo-2', 'echo-3', 'echo-4', 'echo'])
      for (let i = 0; i < 16; i++) opened.push({ slug, id: (await open(token, slug))! });
    const next = (await open(token, 'echo'))!;
    const firstOnEcho = opened.find((s) => s.slug === 'echo')!;
    expect(await alive(token, firstOnEcho.id)).toBe(false);
    let live = 0;
    for (const s of opened) if (await alive(token, s.id, s.slug)) live++;
    expect(live + 1).toBe(MAX_SESSIONS_PER_PRINCIPAL);
    expect(await alive(token, next)).toBe(true);

    const { token: burst } = ctx.tokens.create({ name: 'wide-burst', scope: ['*'] }, { userId });
    const targets = Array.from({ length: 80 }, (_, i) => slugs[1 + (i % 5)]!);
    const ids = await Promise.all(targets.map(async (slug) => ({ slug, id: await open(burst, slug) })));
    let burstLive = 0;
    for (const s of ids) if (s.id && (await alive(burst, s.id, s.slug))) burstLive++;
    expect(burstLive).toBe(MAX_SESSIONS_PER_PRINCIPAL);
  });
});
