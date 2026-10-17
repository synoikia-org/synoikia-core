import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { After, QuickPickleWorld, setWorldConstructor } from 'quickpickle';
import { createAppContext } from '../../src/app.js';
import type { AppContext } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { startServers } from '../../src/server.js';
import type { RunningServers } from '../../src/server.js';
import { startFakeHttp } from '../../src/testing/index.js';
import type { FakeHttp } from '../../src/testing/index.js';
import { browser } from '../../test/admin-client.js';

const PLUGINS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/world');
const ADMIN = { username: 'admin', password: 'world admin passphrase' };

type Task = { title: string; done: boolean };

/** A fresh Synoikia for each scenario: core on real listeners, its admin, and the fake "Acme Tasks" upstream. */
export class SynoikiaWorld extends QuickPickleWorld {
  dataDir = '';
  ctx?: AppContext;
  servers?: RunningServers;
  upstream?: FakeHttp;
  /** The upstream's lists, by name. */
  lists = new Map<string, Task[]>();
  admin!: ReturnType<typeof browser>;
  instances = new Map<string, string>();
  lastInstance = '';
  agents = new Map<number, { token: string; client?: Client }>();
  /** What the last agent call returned. */
  answer: Record<string, unknown> = {};

  async init() {
    await super.init();
    this.upstream = await startFakeHttp({
      routes: {
        'GET /lists/{name}/tasks': (req) => {
          const tasks = this.lists.get(req.params.name!);
          return tasks ? { body: tasks.filter((t) => !t.done) } : { status: 404 };
        },
      },
    });
    this.dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-world-'));
    cpSync(PLUGINS, path.join(this.dataDir, 'plugins'), { recursive: true });
    this.ctx = await createAppContext(
      loadConfig({
        DATA_DIR: this.dataDir,
        MCP_HOST: '127.0.0.1',
        MCP_PORT: '0',
        ADMIN_HOST: '127.0.0.1',
        ADMIN_PORT: '0',
        ADMIN_BOOTSTRAP_USERNAME: ADMIN.username,
        ADMIN_BOOTSTRAP_PASSWORD: ADMIN.password,
      }),
    );
    await this.ctx.start();
    this.servers = await startServers(this.ctx);
    const adminBase = `http://127.0.0.1:${this.servers.admin.port}`;
    this.admin = browser({ request: (p, init) => fetch(`${adminBase}${String(p)}`, init) });
    await this.admin.init();
    await this.expectOk(this.admin.post('/auth/login', ADMIN), 'sign in');
  }

  async stop() {
    for (const agent of this.agents.values()) await agent.client?.close().catch(() => undefined);
    await this.servers?.close();
    await this.ctx?.stop();
    await this.upstream?.close();
    if (this.dataDir) rmSync(this.dataDir, { recursive: true, force: true });
  }

  async expectOk(res: Promise<Response>, what: string) {
    const r = await res;
    if (!r.ok) throw new Error(`${what}: ${r.status} ${await r.text()}`);
    return (await r.json().catch(() => undefined)) as Record<string, unknown>;
  }

  /** The instance "slug" of the World's "Acme Tasks" plugin, created and synced through the Admin API. */
  async tasksInstance(slug: string) {
    const known = this.instances.get(slug);
    if (known) return known;
    const plugins = (await this.expectOk(this.admin.get('/api/plugins'), 'list plugins')) as unknown as {
      id: string;
      pluginId: string;
    }[];
    const plugin = plugins.find((p) => p.pluginId === 'tasks')!;
    await this.expectOk(this.admin.patch(`/api/plugins/${plugin.id}`, { enabled: true }), 'enable plugin');
    const created = await this.expectOk(
      this.admin.post('/api/instances', { pluginId: 'tasks', slug, connection: { url: this.upstream!.url } }),
      'create instance',
    );
    const id = created.id as string;
    await this.expectOk(this.admin.post(`/api/instances/${id}/sync`), 'sync instance');
    this.instances.set(slug, id);
    this.lastInstance = slug;
    return id;
  }

  async setGroupLevel(slug: string, group: string, level: string) {
    const id = await this.tasksInstance(slug);
    await this.expectOk(this.admin.patch(`/api/instances/${id}/groups/${group}`, { level }), 'set group level');
  }

  /** An MCP session of the agent on the instance, kept open for later calls. */
  async session(agent: number, slug: string) {
    const a = this.agents.get(agent)!;
    if (a.client) return a.client;
    const client = new Client({ name: `agent ${agent}`, version: '1.0.0' });
    const url = new URL(`http://127.0.0.1:${this.servers!.mcp.port}/${slug}`);
    await client.connect(
      new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${a.token}` } } }),
    );
    a.client = client;
    return client;
  }

  async execute(agent: number, slug: string, code: string) {
    const client = await this.session(agent, slug);
    const res = (await client.callTool({ name: 'execute', arguments: { code } })) as { content: { text: string }[] };
    this.answer = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
  }
}

setWorldConstructor(SynoikiaWorld);

After(async (world: SynoikiaWorld) => {
  await world.stop();
});
