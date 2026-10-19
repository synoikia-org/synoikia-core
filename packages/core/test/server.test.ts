import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppContext } from '../src/app.js';
import type { AppContext } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { startServers } from '../src/server.js';
import type { RunningServers } from '../src/server.js';

let servers: RunningServers;
let ctx: AppContext;
let dataDir: string;
let uiDir: string;
let mcp: string;
let admin: string;

beforeAll(async () => {
  uiDir = mkdtempSync(path.join(tmpdir(), 'synoikia-ui-'));
  writeFileSync(path.join(uiDir, 'index.html'), '<!doctype html><div id="app"></div>');
  dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-data-'));
  ctx = await createAppContext(
    loadConfig({
      MCP_HOST: '127.0.0.1',
      MCP_PORT: '0',
      ADMIN_HOST: '127.0.0.1',
      ADMIN_PORT: '0',
      ADMIN_UI_DIR: uiDir,
      DATA_DIR: dataDir,
    }),
  );
  servers = await startServers(ctx);
  mcp = `http://127.0.0.1:${servers.mcp.port}`;
  admin = `http://127.0.0.1:${servers.admin.port}`;
});

afterAll(async () => {
  await servers?.close();
  await ctx?.stop();
  rmSync(uiDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

describe('mcp listener', () => {
  it('answers an unknown slug like any endpoint that needs credentials (review L16)', async () => {
    const res = await fetch(`${mcp}/nope`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    expect(await res.json()).toMatchObject({ error: 'unauthorized' });
  });
});

describe('admin listener', () => {
  it('serves the SPA for client-side routes', async () => {
    const res = await fetch(`${admin}/endpoints/acme/connection`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="app">');
  });

  it('reports an unauthenticated session that needs setup', async () => {
    const res = await fetch(`${admin}/api/session`);
    expect(await res.json()).toMatchObject({ authenticated: false, setupRequired: true });
  });

  it('does not let the SPA fallback swallow unknown API routes', async () => {
    const res = await fetch(`${admin}/api/does-not-exist`);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
