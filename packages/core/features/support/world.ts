import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey, JWK } from 'jose';
import { After, QuickPickleWorld, setWorldConstructor } from 'quickpickle';
import { createAppContext } from '../../src/app.js';
import type { AppContext, AppOptions } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { startServers } from '../../src/server.js';
import type { RunningServers } from '../../src/server.js';
import { startFakeHttp } from '../../src/testing/index.js';
import type { FakeHttp, FakeRequest } from '../../src/testing/index.js';
import { browser } from '../../test/admin-client.js';

const PLUGINS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/world');
const ADMIN = { username: 'admin', password: 'world admin passphrase' };
/** "The access gateway": a Cloudflare Access application in front of core, with its team domain and audience. */
export const GATEWAY = { teamDomain: 'acme.cloudflareaccess.com', aud: 'acme-tasks-access' };
let gatewayKeys: Promise<{ privateKey: CryptoKey; jwk: JWK }> | undefined;
const gatewayKey = () =>
  (gatewayKeys ??= (async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    return { privateKey, jwk: { ...(await exportJWK(publicKey)), kid: 'acme-access-1', alg: 'RS256', use: 'sig' } };
  })());

/** How long core waits for an answer to a form before the call moves to the approval link (30 s in production). */
export const FORM_WAIT_MS = 1000;
/** The upstream's API token, stored as the instance's secret. */
export const API_TOKEN = 'acme-tok-9f8e7d6c'; // gitleaks:allow (the fake upstream's test token)

/** The World's operations by the names the feature files use. */
export const OPERATIONS: Record<string, string> = {
  'show the open tasks': 'lists.tasks',
  'count the tasks': 'lists.count',
  'show the share password': 'lists.share',
  'rename a list': 'lists.rename',
  'archive a list': 'lists.archive',
  'delete a list': 'lists.delete',
  'add a task': 'tasks.add',
  'complete a task': 'tasks.complete',
  'import tasks': 'tasks.import',
};

export const opKey = (name: string) => {
  const key = OPERATIONS[name];
  if (!key) throw new Error(`The World has no operation "${name}"`);
  return key;
};

/** A task in Acme; other fields are what Acme keeps on it besides its title. */
type Task = { title: string; done: boolean; [field: string]: unknown };
type Portal = ReturnType<typeof browser>;
export type Access = 'read' | 'write';

interface Agent {
  token: string;
  /** The credential's id in the owner's portal. */
  tokenId: string;
  /** The user whose credential this is: "admin" or "user 12". */
  owner: string;
  /** For an agent that signed in with OAuth: its app's client id and its refresh token. */
  oauth?: { clientId: string; refreshToken: string; resource: string };
  client?: Client;
  transport?: StreamableHTTPClientTransport;
}

/** What an agent's app was asked to show: a page link (`url`) or an in-session form (`form`). */
export interface Prompt {
  mode: 'url' | 'form';
  message: string;
  url?: string;
  /** The fields of a form. */
  fields?: string[];
}

/** How an app answers a prompt: `cancel` is a dismissal. A thrown error means the app could not show it. */
export type PromptAnswer = 'accept' | 'decline' | 'cancel';

/** A page of the MCP listener as a browser got it. */
export interface PageResponse {
  status: number;
  /** The scripts the page may run, by its content security policy. */
  csp: string;
  /** The cookies the page set. */
  cookies: string[];
  /** Where the page sends the browser next, if anywhere. */
  location?: string | null;
  html: string;
}

/** A browser on the MCP listener, from `pageBrowser`. */
export type PageBrowser = ReturnType<SynoikiaWorld['pageBrowser']>;

/** The form token of a page of the MCP listener. */
export const csrfOf = (html: string) => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The process clock: `passTime` moves it with core's clock, for the parts of core that read the wall time.
const realNow = Date.now.bind(Date);
let wallShiftMs = 0;
Date.now = () => realNow() + wallShiftMs;

/** The RFC 6238 code (SHA-1, 6 digits, 30 s) of an authenticator app with this base32 secret, `steps` periods from now. */
export function totpCode(secret: string, steps = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '')) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + steps));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** What "Acme ID" says about the person who signs in there next. */
export interface AcmeIdentity {
  sub: string;
  email?: string;
  email_verified?: boolean;
  groups?: string[];
  preferred_username?: string;
}

/** The fake identity provider "Acme ID": discovery, keys, sign-in and a token service with signed ID tokens. */
export interface AcmeId {
  issuer: string;
  clientId: string;
  /** Who signs in at Acme ID next. */
  next: AcmeIdentity;
  /** When set, Acme ID refuses every code with this reason. */
  refuse?: string;
}

/** Polls `check` until it holds, for at most `ms`. */
export async function eventually(check: () => boolean | Promise<boolean>, what: string, ms = 5000) {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

interface Person {
  id: string;
  username: string;
  password: string;
  portal?: Portal;
}

/** A fresh Synoikia for each scenario: core on real listeners, its admin, and the fake "Acme Tasks" upstream. */
export class SynoikiaWorld extends QuickPickleWorld {
  dataDir = '';
  ctx?: AppContext;
  servers?: RunningServers;
  upstream?: FakeHttp;
  /** The upstream's lists, by name. */
  lists = new Map<string, Task[]>();
  archived = new Set<string>();
  sharePasswords = new Map<string, string>();
  descriptions = new Map<string, string>();
  /** Acme's best-practice guides, by operation key. */
  guides = new Map<string, { version: string; content: string }>([
    ['tasks.import', { version: '1', content: 'Import at most 100 tasks at once, one title for each line.' }],
  ]);
  /** Acme's saved views; each one is a read in the catalog. */
  views: string[] = [];
  /** How Acme misbehaves: refuses every request, or answers with an error that quotes the API token. */
  upstreamFault?: 'denied' | 'leaky';
  /** How long Acme takes to answer a request about the tasks of a list. */
  upstreamDelayMs = 0;
  /** Sessions an agent left behind when it opened a new one. */
  oldClients: Client[] = [];
  admin!: Portal;
  adminBase = '';
  mcpBase = '';
  instances = new Map<string, string>();
  lastInstance = '';
  agents = new Map<string, Agent>();
  people = new Map<string, Person>();
  roles = new Map<string, string>();
  /** The ids of the pre-approval rules made so far, in order. */
  rules: string[] = [];
  /** What the last agent call returned; `refused` holds the message when the instance refused the credential. */
  answer: Record<string, unknown> = {};
  /** The id of the last parked execution an agent was told about. */
  executionId = '';
  /** The prompts the agents' apps were shown, in order. */
  prompts: Prompt[] = [];
  /** An agent call that still runs, started by `startCall`. */
  running?: Promise<void>;
  /** Work to undo when the scenario ends, such as a plugin harness. */
  cleanups: (() => Promise<unknown>)[] = [];
  /** How far the World moved core's clock ahead of the real time. */
  clockMs = 0;
  /** What the last refused portal change answered. */
  portalAnswer: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  /** Start-up settings core gets on top of the World's own, kept across restarts. */
  coreEnv: Record<string, string> = {};
  /** Whether core starts with the World's admin from its start-up settings. */
  bootstrapAdmin = true;
  acme?: AcmeId;

  async init() {
    await super.init();
    // A @long-running step may wait for a real timer of core, such as the shortest approval expiry.
    const { info } = this as unknown as { info: { tags: string[]; config: { stepTimeout: number } } };
    if (info.tags.includes('@long-running')) info.config.stepTimeout = 20_000;
    this.upstream = await startFakeHttp({ routes: this.upstreamRoutes(), guard: (req) => this.guardUpstream(req) });
    this.dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-world-'));
    cpSync(PLUGINS, path.join(this.dataDir, 'plugins'), { recursive: true });
    await this.startCore();
    this.admin = await this.portal(ADMIN.username, ADMIN.password);
    const me = await this.expectOk(this.admin.get('/api/profile'), 'read profile');
    this.people.set('admin', { id: me.id as string, ...ADMIN, portal: this.admin });
  }

  private async startCore(opts: AppOptions = {}) {
    this.ctx = await createAppContext(
      loadConfig({
        DATA_DIR: this.dataDir,
        MCP_HOST: '127.0.0.1',
        MCP_PORT: '0',
        ADMIN_HOST: '127.0.0.1',
        ADMIN_PORT: '0',
        ...(this.bootstrapAdmin
          ? { ADMIN_BOOTSTRAP_USERNAME: ADMIN.username, ADMIN_BOOTSTRAP_PASSWORD: ADMIN.password }
          : {}),
        ...this.coreEnv,
      }),
      {
        formFallbackMs: FORM_WAIT_MS,
        now: () => new Date(realNow() + this.clockMs),
        oidcAllowInsecure: true,
        ...opts,
      },
    );
    await this.ctx.start();
    this.servers = await startServers(this.ctx);
    this.adminBase = `http://127.0.0.1:${this.servers.admin.port}`;
    this.mcpBase = `http://127.0.0.1:${this.servers.mcp.port}`;
  }

  /** Moves core's clock ahead; the portals sign in again, as their sessions time out. */
  async advanceClock(ms: number) {
    this.clockMs += ms;
    for (const p of this.people.values())
      await this.expectOk(
        p.portal!.post('/auth/login', { username: p.username, password: p.password }),
        'sign in again',
      );
  }

  /** Moves core's clock and the process clock ahead; nobody signs in again. */
  passTime(ms: number) {
    this.clockMs += ms;
    wallShiftMs += ms;
  }

  /** Stops core and starts it again on the same data, with `env` added to its start-up settings; agents open new
   * sessions, portal sign-ins stay. */
  async restartCore(env: Record<string, string> = {}) {
    for (const agent of this.agents.values()) {
      await agent.client?.close().catch(() => undefined);
      agent.client = undefined;
      agent.transport = undefined;
    }
    await this.servers?.close();
    await this.ctx?.stop();
    Object.assign(this.coreEnv, env);
    await this.startCore();
  }

  /** A new server: core on an empty data directory, without the World's admin or anyone else. */
  async freshCore() {
    await this.servers?.close();
    await this.ctx?.stop();
    rmSync(this.dataDir, { recursive: true, force: true });
    this.dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-world-'));
    cpSync(PLUGINS, path.join(this.dataDir, 'plugins'), { recursive: true });
    this.people.clear();
    this.roles.clear();
    this.instances.clear();
    this.bootstrapAdmin = false;
    await this.startCore();
  }

  /** Restarts core with a public address for its MCP listener, which OAuth and the consent page need. */
  async publicMcpAddress() {
    if (this.coreEnv.PUBLIC_MCP_URL) return;
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as { port: number };
        probe.close(() => resolve(port));
      });
    });
    await this.restartCore({ MCP_PORT: String(port), PUBLIC_MCP_URL: `http://127.0.0.1:${port}` });
  }

  async stop() {
    wallShiftMs = 0;
    for (const undo of this.cleanups.splice(0).reverse()) await undo().catch(() => undefined);
    for (const agent of this.agents.values()) await agent.client?.close().catch(() => undefined);
    for (const client of this.oldClients) await client.close().catch(() => undefined);
    await this.servers?.close();
    await this.ctx?.stop();
    await this.upstream?.close();
    if (this.dataDir) rmSync(this.dataDir, { recursive: true, force: true });
  }

  // ── the fake "Acme Tasks" upstream ──

  private guardUpstream(req: FakeRequest) {
    if (req.headers.authorization !== `Bearer ${API_TOKEN}`) return { status: 401 };
    if (this.upstreamFault === 'denied') return { status: 403 };
    if (this.upstreamFault === 'leaky') return { status: 500, body: `token ${API_TOKEN} is not valid for this list` };
    return undefined;
  }

  private listVersion(name: string) {
    return createHash('sha256')
      .update(JSON.stringify([name, this.lists.get(name)]))
      .digest('hex')
      .slice(0, 16);
  }

  private upstreamRoutes() {
    const live = (name: string) => (this.archived.has(name) ? undefined : this.lists.get(name));
    const missing = { status: 404 };
    const slow = async () => {
      if (this.upstreamDelayMs) await sleep(this.upstreamDelayMs);
    };
    return {
      'GET /lists': () => ({
        body: [...this.lists.keys()]
          .filter((name) => !this.archived.has(name))
          .map((name) => ({ name, description: this.descriptions.get(name) ?? '' })),
      }),
      'GET /lists/{name}': (req: FakeRequest) => {
        const name = req.params.name!;
        return live(name)
          ? { body: { name, version: this.listVersion(name), sharePassword: this.sharePasswords.get(name) ?? null } }
          : missing;
      },
      'GET /lists/{name}/tasks': async (req: FakeRequest) => {
        const name = req.params.name!;
        const tasks = live(name);
        if (!tasks) return missing;
        if (req.query.get('with') === 'ids')
          return {
            body: tasks.flatMap((t, i) => (t.done ? [] : [{ id: `${name}#${i}`, title: t.title }])),
          };
        await slow();
        return { body: tasks.filter((t) => !t.done) };
      },
      'POST /lists/{name}/tasks': async (req: FakeRequest) => {
        const tasks = live(req.params.name!);
        if (!tasks) return missing;
        await slow();
        const task = { title: String((req.body as { title?: unknown }).title), done: false };
        tasks.push(task);
        return { status: 201, body: task };
      },
      'POST /tasks/{id}/complete': (req: FakeRequest) => {
        const id = req.params.id!;
        const at = id.lastIndexOf('#');
        const task = live(id.slice(0, at))?.[Number(id.slice(at + 1))];
        if (!task || task.done) return missing;
        task.done = true;
        return { body: task };
      },
      'PUT /lists/{name}': (req: FakeRequest) => {
        const name = req.params.name!;
        const tasks = live(name);
        if (!tasks) return missing;
        if (req.headers['if-match'] !== this.listVersion(name)) return { status: 409 };
        const body = req.body as { name?: unknown; sharePassword?: unknown };
        const to = String(body.name);
        const password = typeof body.sharePassword === 'string' ? body.sharePassword : this.sharePasswords.get(name);
        this.lists.delete(name);
        this.sharePasswords.delete(name);
        this.lists.set(to, tasks);
        if (password !== undefined) this.sharePasswords.set(to, password);
        return { body: { name: to } };
      },
      'POST /lists/{name}/archive': (req: FakeRequest) => {
        const name = req.params.name!;
        if (!live(name)) return missing;
        this.archived.add(name);
        return { body: { name, archived: true } };
      },
      'DELETE /lists/{name}': (req: FakeRequest) =>
        this.lists.delete(req.params.name!) ? { body: { deleted: req.params.name } } : missing,
      'POST /lists/{name}/import': (req: FakeRequest) => {
        const tasks = live(req.params.name!);
        if (!tasks) return missing;
        const titles = (req.body as { tasks?: unknown[] }).tasks ?? [];
        for (const title of titles) tasks.push({ title: String(title), done: false });
        return { body: { imported: titles.length } };
      },
      'GET /lists/{name}/share': (req: FakeRequest) => {
        const name = req.params.name!;
        if (!live(name)) return missing;
        return { body: { list: name, password: this.sharePasswords.get(name) ?? null } };
      },
      'GET /guides/{key}': (req: FakeRequest) => {
        const guide = this.guides.get(req.params.key!);
        return guide ? { body: guide } : missing;
      },
      'GET /views': () => ({ body: this.views }),
    };
  }

  /** What Acme received for one route, such as `POST /lists/Groceries/tasks`. */
  upstreamRequests(method: string, pathname: string) {
    return this.upstream!.requests.filter((r) => r.method === method && r.path === pathname);
  }

  // ── the World's "Acme Tasks" plugin on disk ──

  pluginFile(name: string) {
    return path.join(this.dataDir, 'plugins', 'tasks', name);
  }

  /** Drops a flag file the fixture plugin reads (see its index.mjs for what each one changes). */
  pluginFlag(
    name: 'down' | 'restart' | 'catalog-broken' | 'no-confirmation' | 'count-is-write' | 'secret-result' | 'diff-path',
    value = '',
  ) {
    writeFileSync(this.pluginFile(name), value);
  }

  /** Changes the plugin's manifest on disk; `rescan` makes core read it again. */
  async editManifest(change: (m: Record<string, unknown>) => void, rescan = true) {
    const file = this.pluginFile('manifest.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    change(manifest);
    writeFileSync(file, JSON.stringify(manifest, null, 2));
    if (rescan) await this.expectOk(this.admin.post('/api/plugins/rescan'), 'rescan plugins');
  }

  /** Restarts the plugin child of `slug` the way a crash does, and waits until it serves again. */
  async restartPlugin(slug: string) {
    const id = await this.tasksInstance(slug);
    const status = async () =>
      (await this.expectOk(this.admin.get(`/api/instances/${id}`), 'read instance')).status as string;
    this.pluginFlag('restart', String(Date.now()));
    await eventually(async () => (await status()) !== 'ready', 'the plugin to stop');
    await eventually(async () => (await status()) === 'ready', 'the plugin to be ready');
  }

  // ── the admin portal and the Admin API ──

  async expectOk(res: Promise<Response>, what: string) {
    const r = await res;
    if (!r.ok) throw new Error(`${what}: ${r.status} ${await r.text()}`);
    return (await r.json().catch(() => undefined)) as Record<string, unknown>;
  }

  /** Keeps a refused portal change for the Then step; fails if the change went through. */
  async expectRefused(res: Promise<Response>, what: string) {
    const r = await res;
    if (r.ok) throw new Error(`${what}: expected a refusal, got ${r.status}`);
    this.portalAnswer = { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  }

  /** A portal session in its own browser, signed in with a password. */
  async portal(username: string, password: string) {
    const page = await this.portalBrowser();
    await this.expectOk(page.post('/auth/login', { username, password }), `sign in as ${username}`);
    return page;
  }

  /** A fresh browser on the portal, with nobody signed in; `headers` go with every request. */
  async portalBrowser(headers: Record<string, string> = {}) {
    const page = browser({
      request: (p, init) =>
        fetch(`${this.adminBase}${String(p)}`, {
          ...init,
          redirect: 'manual',
          headers: { ...headers, ...(init?.headers as Record<string, string>) },
        }),
    });
    await page.init();
    return page;
  }

  /** A webhook inbox of the admin that gets the notifications of `events`; the World keeps what arrives. */
  async notificationInbox(events: string[]) {
    const inbox: { title: string; message: string; event: string }[] = [];
    const hook = await startFakeHttp({
      routes: {
        'POST /inbox': (req) => {
          inbox.push(req.body as (typeof inbox)[number]);
          return { body: {} };
        },
      },
    });
    this.cleanups.push(() => hook.close());
    await this.expectOk(
      this.admin.post('/api/notifiers', {
        kind: 'webhook',
        name: 'Admin inbox',
        config: { url: `${hook.url}/inbox` },
        events,
      }),
      'add notification channel',
    );
    return inbox;
  }

  // ── the identity provider "Acme ID" ──

  /** Starts Acme ID once for the scenario; core does not use it until the admin sets it up. */
  async acmeId() {
    if (this.acme) return this.acme;
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'acme-id-1', alg: 'RS256', use: 'sig' };
    const codes = new Map<string, { nonce: string; who: AcmeIdentity; redirectUri: string }>();
    const acme: AcmeId = { issuer: '', clientId: 'synoikia', next: { sub: 'nobody' } };
    const idp = await startFakeHttp({
      routes: {
        'GET /.well-known/openid-configuration': () => ({
          body: {
            issuer: acme.issuer,
            authorization_endpoint: `${acme.issuer}/authorize`,
            token_endpoint: `${acme.issuer}/token`,
            jwks_uri: `${acme.issuer}/jwks`,
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            code_challenge_methods_supported: ['S256'],
          },
        }),
        'GET /jwks': () => ({ body: { keys: [jwk] } }),
        'GET /authorize': (req) => {
          const code = randomBytes(12).toString('hex');
          const redirectUri = req.query.get('redirect_uri')!;
          codes.set(code, { nonce: req.query.get('nonce')!, who: { ...acme.next }, redirectUri });
          const back = new URL(redirectUri);
          back.searchParams.set('code', code);
          back.searchParams.set('state', req.query.get('state')!);
          back.searchParams.set('iss', acme.issuer);
          return { status: 302, headers: { location: back.toString() } };
        },
        'POST /token': async (req) => {
          const form = new URLSearchParams(String(req.body));
          const grant = codes.get(form.get('code') ?? '');
          codes.delete(form.get('code') ?? '');
          if (acme.refuse) return { status: 400, body: { error: 'invalid_grant', error_description: acme.refuse } };
          if (!grant || !form.get('code_verifier') || form.get('redirect_uri') !== grant.redirectUri)
            return { status: 400, body: { error: 'invalid_grant' } };
          const { sub, ...claims } = grant.who;
          const idToken = await new SignJWT({ nonce: grant.nonce, ...claims })
            .setProtectedHeader({ alg: 'RS256', kid: 'acme-id-1' })
            .setIssuer(acme.issuer)
            .setSubject(sub)
            .setAudience(acme.clientId)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(privateKey);
          return { body: { access_token: 'acme-at', token_type: 'Bearer', id_token: idToken, expires_in: 300 } };
        },
      },
    });
    acme.issuer = idp.url;
    this.cleanups.push(() => idp.close());
    return (this.acme = acme);
  }

  /** The admin points core's single sign-on at Acme ID; `settings` adds to or changes what is saved. */
  async setUpAcmeId(settings: Record<string, unknown> = {}) {
    const acme = await this.acmeId();
    await this.expectOk(
      this.admin.put('/api/settings/oidc', {
        enabled: true,
        issuer: acme.issuer,
        clientId: acme.clientId,
        label: 'Acme ID',
        ...settings,
      }),
      'set up Acme ID',
    );
  }

  /** The identity Acme ID keeps for a person of the World: subject `acme-12` and a verified address for user 12. */
  acmeIdentityOf(person: string): AcmeIdentity {
    const known = this.people.get(person);
    const username = known?.username ?? `${person.replace(/\s+/g, '')}@acme.example`;
    return { sub: `acme-${person.replace(/\D+/g, '') || person}`, email: username, email_verified: true, groups: [] };
  }

  /** A browser that follows redirects by hand from `start`, through core and Acme ID, keeping its cookies for core.
   * It stops on a page of the portal app, on a page without a redirect, or where `stop` says. */
  async follow(on: Portal | PageBrowser, start: string, stop: (at: URL) => boolean = () => false) {
    const portal = 'jar' in on && 'req' in on;
    const base = portal ? this.adminBase : this.mcpBase;
    let at = new URL(start, base);
    for (let hop = 0; hop < 10; hop++) {
      const own = at.origin === base;
      if (stop(at) || (own && portal && !at.pathname.startsWith('/auth/'))) return { status: 0, url: at, html: '' };
      let got: { status: number; location?: string | null; html: string };
      if (!own) {
        const res = await fetch(at, { redirect: 'manual' });
        got = { status: res.status, location: res.headers.get('location'), html: await res.text() };
      } else if (portal) {
        const res = await on.get(at.pathname + at.search);
        got = { status: res.status, location: res.headers.get('location'), html: await res.text() };
      } else got = await on.send(at.pathname + at.search);
      const next =
        got.location ?? /http-equiv="refresh" content="0;url=([^"]+)"/.exec(got.html)?.[1]?.replace(/&amp;/g, '&');
      if (!next) return { status: got.status, url: at, html: got.html };
      at = new URL(next, at);
    }
    throw new Error(`too many redirects from ${start}`);
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
      this.admin.post('/api/instances', {
        pluginId: 'tasks',
        slug,
        connection: { url: this.upstream!.url, token: API_TOKEN },
      }),
      'create instance',
    );
    const id = created.id as string;
    await this.expectOk(this.admin.post(`/api/instances/${id}/sync`), 'sync instance');
    this.instances.set(slug, id);
    this.lastInstance = slug;
    return id;
  }

  /** Changes instance settings through the Admin API; core restarts the plugin child with them. */
  async instanceSettings(slug: string, settings: Record<string, unknown>) {
    const id = await this.tasksInstance(slug);
    await this.expectOk(this.admin.patch(`/api/instances/${id}`, { settings }), 'change instance settings');
  }

  async sync(slug: string) {
    const id = await this.tasksInstance(slug);
    await this.expectOk(this.admin.post(`/api/instances/${id}/sync`), 'sync instance');
  }

  async setGroupLevel(slug: string, group: string, level: string) {
    const id = await this.tasksInstance(slug);
    await this.expectOk(this.admin.patch(`/api/instances/${id}/groups/${group}`, { level }), 'set group level');
  }

  /** The instance's operations as the admin sees them. */
  async operations(slug: string) {
    const id = await this.tasksInstance(slug);
    return (await this.expectOk(this.admin.get(`/api/instances/${id}/operations`), 'list operations')) as unknown as {
      id: string;
      key: string;
      levelOverride: string | null;
      level: string;
      allowedLevels: string[];
      writeAcknowledged: boolean;
    }[];
  }

  async operation(slug: string, name: string) {
    const key = opKey(name);
    const op = (await this.operations(slug)).find((o) => o.key === key);
    if (!op) throw new Error(`No operation ${key} on ${slug}`);
    return op;
  }

  async groups(slug: string) {
    const id = await this.tasksInstance(slug);
    return (await this.expectOk(this.admin.get(`/api/instances/${id}/groups`), 'list groups')) as unknown as {
      key: string;
      level: string;
      counts: { pendingReview: number };
    }[];
  }

  /** The admin's own level for one operation; `expect: 'refused'` keeps the refusal instead. */
  async setOperationLevel(slug: string, name: string, level: string | null, expect: 'ok' | 'refused' = 'ok') {
    const id = await this.tasksInstance(slug);
    const op = await this.operation(slug, name);
    const res = this.admin.patch(`/api/instances/${id}/operations/${op.id}`, { level });
    if (expect === 'refused') await this.expectRefused(res, 'set operation level');
    else await this.expectOk(res, 'set operation level');
  }

  async acknowledge(slug: string, name: string, acknowledged: boolean) {
    const id = await this.tasksInstance(slug);
    const op = await this.operation(slug, name);
    await this.expectOk(
      this.admin.patch(`/api/instances/${id}/operations/${op.id}`, { acknowledged }),
      'set acknowledgement',
    );
  }

  async audit(query: Record<string, string>) {
    const qs = new URLSearchParams(query).toString();
    return (await this.expectOk(this.admin.get(`/api/audit?${qs}`), 'read audit')).rows as {
      decision: string;
      operationKey: string | null;
      detail: Record<string, unknown> | null;
    }[];
  }

  // ── roles, users and their own levels ──

  async role(name: string) {
    const known = this.roles.get(name);
    if (known) return known;
    const created = await this.expectOk(this.admin.post('/api/roles', { name }), 'create role');
    this.roles.set(name, created.id as string);
    return created.id as string;
  }

  async setRoleInstances(roleName: string, slugs: string[]) {
    const role = await this.role(roleName);
    const instanceIds = await Promise.all(slugs.map((s) => this.tasksInstance(s)));
    await this.expectOk(this.admin.put(`/api/roles/${role}/instances`, { instanceIds }), 'set role instances');
  }

  async setRoleSwitches(roleName: string, slug: string, switches: Record<string, boolean>) {
    const role = await this.role(roleName);
    const id = await this.tasksInstance(slug);
    await this.expectOk(this.admin.patch(`/api/roles/${role}/endpoints/${id}`, switches), 'set role switches');
  }

  /** A role maximum for a group (`{ group }`) or an operation (`{ op }`); null clears it. */
  async setRoleMaximum(
    roleName: string,
    slug: string,
    target: { group: string } | { op: string },
    level: string | null,
  ) {
    const role = await this.role(roleName);
    const id = await this.tasksInstance(slug);
    const where =
      'group' in target ? `groups/${target.group}` : `operations/${(await this.operation(slug, target.op)).id}`;
    await this.expectOk(this.admin.put(`/api/roles/${role}/endpoints/${id}/${where}`, { level }), 'set role maximum');
  }

  /** A user with a password, signed in to the portal in their own browser. */
  async user(person: string, roleName: string) {
    const known = this.people.get(person);
    if (known) return known;
    const roleId = await this.role(roleName);
    const username = `${person.replace(/\s+/g, '')}@acme.example`;
    const password = `${username} world passphrase`;
    const created = await this.expectOk(this.admin.post('/api/users', { username, password, roleId }), 'create user');
    const portal = await this.portal(username, password);
    const p = { id: created.id as string, username, password, portal };
    this.people.set(person, p);
    return p;
  }

  /** A person who makes their own account with the sign-up form, and gets the role the admin chose for it. */
  async signUp(person: string) {
    const username = `${person.replace(/\s+/g, '')}@acme.example`;
    const password = `${username} world passphrase`;
    const portal = browser({ request: (p, init) => fetch(`${this.adminBase}${String(p)}`, init) });
    await portal.init();
    const created = await this.expectOk(portal.post('/auth/register', { username, password }), 'sign up');
    if (created.status !== 'ok') throw new Error(`sign up: ${JSON.stringify(created)}`);
    const me = await this.expectOk(portal.get('/api/profile'), 'read profile');
    this.people.set(person, { id: me.id as string, username, password, portal });
  }

  person(name: string) {
    const p = this.people.get(name);
    if (!p) throw new Error(`The World has no person "${name}" yet`);
    return p;
  }

  /** A user's own level for one operation, set in their own portal session. */
  async setOwnLevel(person: string, slug: string, name: string, level: string | null, expect: 'ok' | 'refused' = 'ok') {
    const id = await this.tasksInstance(slug);
    const op = await this.operation(slug, name);
    const res = this.person(person).portal!.put(`/api/me/endpoints/${id}/operations/${op.id}`, { level });
    if (expect === 'refused') await this.expectRefused(res, 'set own level');
    else await this.expectOk(res, 'set own level');
  }

  // ── pre-approval rules ──

  /** A pre-approval rule for one operation, written by the admin or, with `owner`, in that user's own portal. */
  async rule(
    slug: string,
    name: string,
    match: unknown[],
    opts: { owner?: string; extra?: Record<string, unknown>; expect?: 'ok' | 'refused' } = {},
  ) {
    const id = await this.tasksInstance(slug);
    const op = await this.operation(slug, name);
    const body = { operationId: op.id, match, reason: `the World's rule for ${name}`, ...opts.extra };
    const res = opts.owner
      ? this.person(opts.owner).portal!.post(`/api/me/endpoints/${id}/rules`, body)
      : this.admin.post(`/api/instances/${id}/rules`, body);
    if (opts.expect === 'refused') return void (await this.expectRefused(res, 'save rule'));
    const created = await this.expectOk(res, 'save rule');
    this.rules.push(created.id as string);
  }

  /** The rules of the instance as the admin sees them. */
  async ruleList(slug: string) {
    const id = await this.tasksInstance(slug);
    return (await this.expectOk(this.admin.get(`/api/instances/${id}/rules`), 'list rules')) as unknown as {
      id: string;
      inert: string | null;
      strictMissAt: string | null;
    }[];
  }

  // ── agents ──

  /** A new credential of `owner` for the agent; without `access`, it takes what the portal offers first. */
  async credential(agent: string, owner: string, access?: Access, name = `agent ${agent}`) {
    const portal = this.person(owner).portal!;
    const created = await this.expectOk(
      portal.post('/api/me/tokens', { name, scope: ['*'], ...(access ? { access } : {}) }),
      'create token',
    );
    await this.agents
      .get(agent)
      ?.client?.close()
      .catch(() => undefined);
    this.agents.set(agent, { token: created.token as string, tokenId: created.id as string, owner });
  }

  /** The agent connects through the app "Acme Chat" with OAuth: `owner` signs in on the consent page and lets it
   * read and write `slug`. Core restarts once with a public address; the World keeps the refresh token. */
  async oauthAgent(agent: string, owner: string, slug: string) {
    await this.tasksInstance(slug);
    await this.publicMcpAddress();
    const redirectUri = 'http://127.0.0.1:9/callback';
    const clients = (await this.expectOk(this.admin.get('/api/oauth/clients'), 'list clients')) as unknown as {
      clientId: string;
      name: string;
    }[];
    const clientId =
      clients.find((c) => c.name === 'Acme Chat')?.clientId ??
      ((
        await this.expectOk(
          this.admin.post('/api/oauth/clients', { name: 'Acme Chat', redirectUris: [redirectUri] }),
          'register client',
        )
      ).client_id as string);
    const verifier = randomBytes(32).toString('base64url');
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: 'acme-chat',
    });
    const consentPath = `/oauth/authorize?${q.toString()}`;
    const { send } = this.pageBrowser();
    await this.signInOnPage(send, owner, consentPath);
    const page = await send(consentPath);
    const form = /name="form" value="([^"]+)"/.exec(page.html)?.[1];
    const resource = /name="resource" value="([^"]+)"/.exec(page.html)?.[1];
    if (!form || !resource) throw new Error(`no consent form: ${page.html}`);
    const done = await send('/oauth/consent', { form, resource, access: 'write', decision: 'approve' });
    const code = new URL(done.location ?? redirectUri).searchParams.get('code');
    if (!code) throw new Error(`no code: ${done.location} ${done.html}`);
    const res = await fetch(`${this.mcpBase}/oauth/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        client_id: clientId,
        resource,
      }),
    });
    const tokens = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!tokens.access_token || !tokens.refresh_token) throw new Error(`token exchange: ${JSON.stringify(tokens)}`);
    this.agents.set(agent, {
      token: tokens.access_token,
      tokenId: '',
      owner,
      oauth: { clientId, refreshToken: tokens.refresh_token, resource },
    });
  }

  /** The OAuth agent asks for a new access token with its refresh token; the answer of the token service. */
  async renewOAuth(agent: string) {
    const a = this.agents.get(agent);
    if (!a?.oauth) throw new Error(`agent ${agent} did not sign in with OAuth`);
    const res = await fetch(`${this.mcpBase}/oauth/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: a.oauth.refreshToken,
        client_id: a.oauth.clientId,
        resource: a.oauth.resource,
      }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  /** An MCP session of the agent on the instance, kept open for later calls. */
  async session(agent: string, slug: string) {
    const a = this.agents.get(agent);
    if (!a) throw new Error(`The World has no agent ${agent} yet`);
    if (a.client) return a.client;
    return this.connect(agent, slug);
  }

  /** A fresh MCP session of the agent; with `prompts`, its app can show approval prompts of that kind, or both. */
  async connect(
    agent: string,
    slug: string,
    prompts?: {
      mode: 'url' | 'form' | 'both';
      answer: (p: Prompt) => Promise<PromptAnswer>;
    },
  ) {
    const a = this.agents.get(agent);
    if (!a) throw new Error(`The World has no agent ${agent} yet`);
    if (a.client) this.oldClients.push(a.client);
    const modes = { url: { url: {} }, form: { form: {} }, both: { url: {}, form: {} } };
    const capabilities = prompts ? { elicitation: modes[prompts.mode] } : {};
    const client = new Client({ name: `agent ${agent}`, version: '1.0.0' }, { capabilities });
    if (prompts)
      client.setRequestHandler(ElicitRequestSchema, async (req) => {
        const p = req.params as {
          mode?: string;
          message: string;
          url?: string;
          requestedSchema?: { properties?: Record<string, unknown> };
        };
        const prompt: Prompt = {
          mode: p.mode === 'url' ? 'url' : 'form',
          message: p.message,
          url: p.url,
          ...(p.mode === 'url' ? {} : { fields: Object.keys(p.requestedSchema?.properties ?? {}) }),
        };
        const action = await prompts.answer(prompt);
        return action === 'accept' && p.mode !== 'url' ? { action, content: {} } : { action };
      });
    const url = new URL(`${this.mcpBase}/${slug}`);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { authorization: `Bearer ${a.token}` } },
    });
    await client.connect(transport);
    a.client = client;
    a.transport = transport;
    return client;
  }

  /** The agent's app, which shows prompts of `mode` and answers each one with `answer`; the World keeps the prompts. */
  async app(
    agent: string,
    mode: 'url' | 'form' | 'both',
    answer: (p: Prompt) => Promise<PromptAnswer> = () => Promise.resolve('accept'),
  ) {
    await this.connect(agent, this.lastInstance, {
      mode,
      answer: (p) => {
        this.prompts.push(p);
        return answer(p);
      },
    });
  }

  /** Starts the agent's call of one operation without waiting for its answer; `callEnded` waits. */
  startCall(agent: string, name: string, params: Record<string, unknown>) {
    this.running = this.call(agent, name, params);
  }

  async callEnded() {
    await this.running;
  }

  /** The id of the agent's current MCP session. */
  sessionId(agent: string) {
    return this.agents.get(agent)?.transport?.sessionId;
  }

  /** Runs `code` with `execute`; `signal` cancels the agent's request. */
  async execute(agent: string, slug: string, code: string, signal?: AbortSignal) {
    try {
      const client = await this.session(agent, slug);
      const res = (await client.callTool({ name: 'execute', arguments: { code } }, undefined, { signal })) as {
        content: { text: string }[];
      };
      this.answer = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
      if (typeof this.answer.executionId === 'string') this.executionId = this.answer.executionId;
    } catch (err) {
      this.answer = { refused: err instanceof Error ? err.message : String(err) };
    }
  }

  async search(agent: string, slug: string, code: string) {
    const client = await this.session(agent, slug);
    const res = (await client.callTool({ name: 'search', arguments: { code } })) as { content: { text: string }[] };
    this.answer = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
  }

  /** The agent reads the guide of an operation in its session, and gets the best-practice key back. */
  async readGuide(agent: string, name: string) {
    await this.search(agent, this.lastInstance, `return await guides.get(${JSON.stringify(opKey(name))});`);
    return (this.answer.result as { best_practice_key?: string } | undefined)?.best_practice_key;
  }

  /** The agent calls one operation by name with these params, and gets its result back. */
  async call(agent: string, name: string, params: Record<string, unknown>) {
    await this.execute(
      agent,
      this.lastInstance,
      `return await tasks.call(${JSON.stringify(opKey(name))}, ${JSON.stringify(params)});`,
    );
  }

  async resume(agent: string, executionId: string) {
    this.answer = await this.resumeAnswer(agent, executionId);
  }

  /** What `resume` answers the agent, without keeping it as the last answer. */
  async resumeAnswer(agent: string, executionId: string) {
    const client = await this.session(agent, this.lastInstance);
    const res = (await client.callTool({ name: 'resume', arguments: { executionId } })) as {
      content: { text: string }[];
    };
    const answer = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
    if (typeof answer.executionId === 'string') this.executionId = answer.executionId;
    return answer;
  }

  /** The approval card in the agent's app calls one of its own tools, such as `approval_status`. */
  async cardTool(agent: string, name: string, args: Record<string, unknown>) {
    const client = await this.session(agent, this.lastInstance);
    const res = (await client.callTool({ name, arguments: args })) as {
      structuredContent?: Record<string, unknown>;
      content: { text: string }[];
    };
    return res.structuredContent ?? (JSON.parse(res.content[0]!.text) as Record<string, unknown>);
  }

  // ── the access gateway ──

  /** Puts the access gateway in front of core: its key set answers at its team domain, and core trusts it. */
  async accessGateway() {
    const { jwk } = await gatewayKey();
    const certs = `https://${GATEWAY.teamDomain}/cdn-cgi/access/certs`;
    const real = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      return url === certs ? Promise.resolve(Response.json({ keys: [jwk] })) : real(input, init);
    };
    this.cleanups.push(() => Promise.resolve((globalThis.fetch = real)));
    await this.expectOk(
      this.admin.put('/api/settings/mcp', { clientAuth: { external: true }, cfAccess: GATEWAY }),
      'turn on the access gateway',
    );
  }

  /** What the access gateway adds to a request it lets through: an assertion with these claims. */
  async gatewayAssertion(claims: Record<string, unknown>) {
    const { privateKey } = await gatewayKey();
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'acme-access-1' })
      .setIssuer(`https://${GATEWAY.teamDomain}`)
      .setAudience(GATEWAY.aud)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  }

  // ── the approval page ──

  /** The link of the last approval: the last link prompt of an app, else the last parked call. */
  approvalLink() {
    const link =
      this.prompts.findLast((p) => p.mode === 'url')?.url ?? (this.answer.approval as { url: string } | undefined)?.url;
    if (!link) throw new Error(`No approval link: ${JSON.stringify(this.answer)}`);
    return new URL(link, this.mcpBase).pathname;
  }

  /** A fresh browser on the MCP listener, with its own cookies; `headers` go with every request, `extra` with one. */
  pageBrowser(headers: Record<string, string> = {}) {
    const jar = new Map<string, string>();
    const send = async (p: string, form?: Record<string, string>, extra: Record<string, string> = {}) => {
      const res = await fetch(`${this.mcpBase}${p}`, {
        method: form ? 'POST' : 'GET',
        redirect: 'manual',
        headers: {
          ...headers,
          ...extra,
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
          ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: form ? new URLSearchParams(form).toString() : undefined,
      });
      for (const sc of res.headers.getSetCookie()) {
        const pair = sc.split(';')[0]!;
        const eq = pair.indexOf('=');
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      const page: PageResponse = {
        status: res.status,
        csp: res.headers.get('content-security-policy') ?? '',
        cookies: res.headers.getSetCookie(),
        location: res.headers.get('location'),
        html: await res.text(),
      };
      return page;
    };
    return { send, jar };
  }

  /** `person` signs in with a password on the sign-in form that the page at `pagePath` shows, in the browser of `send`. */
  async signInOnPage(send: ReturnType<SynoikiaWorld['pageBrowser']>['send'], person: string, pagePath: string) {
    const { username, password } = this.person(person);
    const login = await send(pagePath);
    return send('/oauth/login', { csrf: csrfOf(login.html), continue: pagePath, username, password });
  }

  /** The approval page of the last approval (or of `url`), in a fresh browser that signs in as `person`. */
  async approvalPage(person: string, url?: string) {
    const pagePath = url ? new URL(url, this.mcpBase).pathname : this.approvalLink();
    const { send } = this.pageBrowser();
    await this.signInOnPage(send, person, pagePath);
    const opened = await send(pagePath);
    const post = (form: Record<string, string>) => send(pagePath, form);
    return {
      html: opened.html,
      status: opened.status,
      post,
      send,
      decide: async (decision: 'approve' | 'deny' | 'approve_session', confirm?: string) => {
        const res = await post({
          csrf: csrfOf(opened.html),
          decision,
          ...(confirm ? { confirm } : {}),
          ...(decision === 'approve_session' ? { grant: '1' } : {}),
        });
        if (res.status !== 200) throw new Error(`decide: ${res.status} ${res.html}`);
        return res;
      },
    };
  }

  /** `person` approves the agent's parked call on the approval page, and the agent resumes it. */
  async approveAndResume(agent: string, person: string, confirm?: string) {
    const executionId = this.answer.executionId as string;
    const page = await this.approvalPage(person);
    await page.decide('approve', confirm);
    await this.resume(agent, executionId);
  }
}

setWorldConstructor(SynoikiaWorld);

After(async (world: SynoikiaWorld) => {
  await world.stop();
});
