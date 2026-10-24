import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/app.js';
import { pluginInstances } from '../src/db/schema.js';
import { MAX_SESSIONS_PER_ENDPOINT } from '../src/http/mcp/endpoint.js';
import { startServers } from '../src/server.js';
import type { RunningServers } from '../src/server.js';
import { createTestApp } from './helpers.js';

let ctx: AppContext;
let servers: RunningServers;
let dataDir: string;
let base: string;
let instanceId: string;
let userId: string;

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

async function open(token: string) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'burst', version: '1' } },
  });
  const res = await fetch(`${base}/echo`, { method: 'POST', headers: headers(token), body });
  await res.text();
  return res.headers.get('mcp-session-id');
}

async function alive(token: string, id: string) {
  const res = await fetch(`${base}/echo`, {
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
    const { token } = ctx.tokens.create({ name: 'burst', scope: [instanceId] }, { userId });
    const warm = ctx.tokens.create({ name: 'warm', scope: [instanceId] }, { userId }).token;
    await Promise.all(Array.from({ length: 24 }, () => open(warm)));
    ctx.db.update(pluginInstances).set({ lastSyncedAt: null }).where(eq(pluginInstances.id, instanceId)).run();
    const ids = (await Promise.all(Array.from({ length: 24 }, () => open(token)))).filter((id): id is string => !!id);
    // A session closed while it opened answers without its id; the others are counted below.
    let live = 0;
    for (const id of ids) if (await alive(token, id)) live++;
    expect(live).toBe(MAX_SESSIONS_PER_ENDPOINT);
  });
});
