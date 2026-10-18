import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { After, QuickPickleWorld, setWorldConstructor } from 'quickpickle';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ZodError } from 'zod';
import {
  buildOpenApiCatalog,
  checkManifest,
  compileRules,
  HttpJsonClient,
  parseManifest,
  parsePluginSettings,
  readInstructionsFile,
  restBinding,
  SDK_VERSION,
} from '@synoikia/plugin-sdk';
import type {
  CompiledRules,
  HttpJsonClientOptions,
  InitParams,
  Manifest,
  OpenApiCatalog,
  OpenApiCatalogOptions,
  OperationDescriptor,
  OperationDraft,
  PluginSettings,
  ResolvedTarget,
  RestBinding,
  RpcNotification,
  RpcResponse,
} from '@synoikia/plugin-sdk';
import { acmeDescription, keyOf } from './acme-description.js';

const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGIN_MAIN = path.join(SDK_ROOT, 'features/support/acme-tasks-plugin.main.ts');

export const API_TOKEN = 'acme-tok-9f8e7d6c';

/** The manifest plugin author 3 starts from: nothing but the required fields. */
const minimalManifest = () => ({
  id: 'acme-tasks',
  name: 'Acme Tasks',
  version: '1.0.0',
  sdk: '^0.2.2',
  entry: 'dist/index.js',
  binding: { namespace: 'acme', functions: ['call'] },
  connection: { schema: { type: 'object', properties: { baseUrl: { type: 'string' } } } },
});

export interface AcmeList {
  id?: string;
  name?: string;
  /** Set for a list of another user. */
  owner?: string;
  tasks: { title: string; done: boolean; tags?: string[] }[];
}

export interface Received {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** What the plugin got back from one call: a value or an error. */
export type Outcome = { ok: true; value: unknown } | { ok: false; error: Error & { code?: string } };

const closeServer = (server: http.Server) =>
  new Promise<void>((r) => {
    server.closeAllConnections();
    server.close(() => r());
  });

/** An error's readable text: every Zod issue with its path, or the message. */
export function explain(err: unknown): string {
  if (err instanceof ZodError) return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
  return err instanceof Error ? err.message : String(err);
}

export class PluginAuthorWorld extends QuickPickleWorld {
  dir = '';
  manifest: Record<string, unknown> = minimalManifest();
  pluginYaml = '';
  /** What the steps put in plugin.yaml, written out as YAML. */
  yamlDoc: { rules?: Record<string, unknown>[] } & Record<string, unknown> = {};
  /** The plugin's own `plugin:` section schema, when the scenario gives one. */
  pluginSection?: { parse(value: unknown): Record<string, unknown> };
  /** Operations the plugin's discovery finds, before the rules apply. */
  drafts: OperationDraft[] = [];
  /** Custom confirm sources the plugin registers. */
  custom: Record<string, () => string | undefined> = {};

  validated?: { manifest?: Manifest; error?: string };
  descriptor?: Record<string, unknown>;
  descriptorResult?: { value?: unknown; error?: string };
  compatible?: boolean;
  instructions?: { text?: string; error?: string };
  problems: string[] = [];
  settings?: { value?: PluginSettings; error?: string };
  catalog?: { operations?: OperationDescriptor[]; error?: string };
  compiled?: CompiledRules;
  literal?: string;
  masked?: unknown;
  /** The client of a plugin that signs in with a session. */
  session?: HttpJsonClient;
  multipart?: Record<string, string>;
  address?: { value?: string; error?: string };
  outcomes: Outcome[] = [];
  /** What one step keeps for the next steps of its scenario. */
  kept: Record<string, unknown> = {};

  /** The fake "Acme Tasks" upstream. */
  lists: AcmeList[] = [];
  account: Record<string, unknown> = { name: 'Acme home' };
  received: Received[] = [];
  otherHostReceived: Received[] = [];
  signIns = 0;
  sessions = new Set<string>();
  sessionMode = false;
  version = 'Acme Tasks 4.2';
  failures = new Map<string, string>();
  slowMs = 0;
  bigAnswer = false;
  token = API_TOKEN;
  maxBytes?: number;
  timeoutMs?: number;
  /** The OpenAPI description Acme Tasks serves, and the versions it serves it for. */
  description: Record<string, unknown> = acmeDescription();
  descriptionText?: string;
  descriptionRefs = new Set(['v4.2']);
  descriptionFailures = new Set<string>();
  descriptionSlowMs = 0;
  openApiOptions: Partial<Pick<OpenApiCatalogOptions, 'minOperations' | 'actionWords' | 'pathActionWords'>> = {};
  openapi?: OpenApiCatalog;
  /** What the plugin process sent: log lines, and closed connections among them. */
  pluginLog: string[] = [];
  replies: RpcResponse[] = [];
  private plugin?: ChildProcess;
  private waiting = new Map<number, (res: RpcResponse) => void>();
  private rpcId = 0;
  private servers: http.Server[] = [];
  port = 0;
  otherPort = 0;
  private cookie?: string;
  private sessionCounter = 0;

  async init() {
    await super.init();
    this.dir = mkdtempSync(path.join(tmpdir(), 'synoikia-plugin-author-'));
  }

  // --- the plugin folder ---

  /** Writes a file in the plugin folder, creating its folders. */
  writeFile(file: string, data: string | Uint8Array) {
    const full = path.join(this.dir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, data);
  }

  /** Sets a manifest field by its dotted path, such as `binding.namespace`. */
  setManifest(field: string, value: unknown) {
    const parts = field.split('.');
    let at = this.manifest;
    for (const p of parts.slice(0, -1)) at = (at[p] ??= {}) as Record<string, unknown>;
    at[parts.at(-1)!] = value;
  }

  get connection() {
    const c = this.manifest.connection as { schema: { properties: Record<string, unknown> }; ui?: unknown };
    return c as {
      schema: { properties: Record<string, Record<string, unknown>> };
      ui?: Record<string, Record<string, unknown>>;
      help?: string;
    };
  }

  connectionHint(field: string): Record<string, unknown> {
    const ui = (this.connection.ui ??= {});
    return (ui[field] ??= {});
  }

  matchProfile(name: string): Record<string, unknown>[] {
    const profiles = (this.manifest.matchProfiles ??= {}) as Record<string, Record<string, unknown>[]>;
    return (profiles[name] ??= []);
  }

  /** Adds to plugin.yaml: a rule, or top-level settings. */
  addRule(rule: Record<string, unknown>) {
    (this.yamlDoc.rules ??= []).push(rule);
    this.pluginYaml = stringifyYaml(this.yamlDoc);
  }

  setYaml(settings: Record<string, unknown>) {
    Object.assign(this.yamlDoc, settings);
    this.pluginYaml = stringifyYaml(this.yamlDoc);
  }

  /** Reads the manifest from the folder and validates it, as core does when it loads the plugin. */
  validate() {
    this.writeFile('manifest.json', JSON.stringify(this.manifest, null, 2));
    try {
      this.validated = { manifest: parseManifest(this.readJson('manifest.json')) };
    } catch (err) {
      this.validated = { error: explain(err) };
    }
  }

  readInstructions() {
    this.validate();
    const file = this.validated?.manifest?.instructions;
    if (!file) throw new Error(`the manifest is not valid: ${this.validated?.error ?? 'no instructions file'}`);
    try {
      this.instructions = { text: readInstructionsFile(this.dir, file) };
    } catch (err) {
      this.instructions = { error: explain(err) };
    }
  }

  /** Loads `plugin.yaml` from the folder. */
  loadSettings() {
    this.writeFile('plugin.yaml', this.pluginYaml);
    try {
      this.settings = { value: parsePluginSettings(this.readYaml('plugin.yaml'), this.pluginSection) };
    } catch (err) {
      this.settings = { error: explain(err) };
    }
  }

  /** The checks beyond the schema, with `plugin.yaml`. */
  check() {
    this.writeFile('manifest.json', JSON.stringify(this.manifest, null, 2));
    this.loadSettings();
    if (this.settings?.error) throw new Error(`plugin.yaml is not valid: ${this.settings.error}`);
    this.problems = checkManifest(this.readJson('manifest.json'), this.settings?.value);
  }

  /** The catalog the plugin builds: the found operations, with the rules of `plugin.yaml` applied. */
  buildCatalog() {
    this.loadSettings();
    if (this.settings?.error) {
      this.catalog = { error: this.settings.error };
      return;
    }
    const rules = this.rules();
    try {
      this.catalog = {
        operations: this.drafts.filter((d) => !rules.excluded(d.key)).flatMap((d) => rules.describe(d)),
      };
    } catch (err) {
      this.catalog = { error: explain(err) };
    }
  }

  rules(): CompiledRules {
    if (!this.settings) this.loadSettings();
    if (!this.settings?.value) throw new Error(`plugin.yaml is not valid: ${this.settings?.error}`);
    this.compiled ??= compileRules(this.settings.value, {
      lookup: (op, args, timeoutMs) => this.lookup(op, args, timeoutMs),
      custom: Object.fromEntries(Object.entries(this.custom).map(([name, fn]) => [name, () => fn()])),
    });
    return this.compiled;
  }

  operation(key: string): OperationDescriptor {
    if (!this.catalog?.operations) throw new Error(`no catalog: ${this.catalog?.error ?? 'not built'}`);
    const op = this.catalog.operations.find((o) => o.key === key);
    if (!op) throw new Error(`the catalog has no "${key}": ${this.catalog.operations.map((o) => o.key).join(', ')}`);
    return op;
  }

  async confirmLiteral(key: string, params: unknown, targets: ResolvedTarget[] = []) {
    await this.startAcme();
    this.literal = await this.rules().confirmLiteral({ key, params, targets });
  }

  /** The plugin's `lookup` hook: reads from Acme Tasks. */
  private lookup(op: string, args: unknown[], timeoutMs: number): Promise<unknown> {
    const paths: Record<string, () => string> = {
      'lists.get': () => `/lists/${encodeURIComponent(String(args[0]))}`,
      'lists.all': () => '/lists',
      'account.info': () => '/account',
    };
    const p = paths[op];
    if (!p) return Promise.reject(new Error(`no lookup ${op}`));
    return this.client().request('GET', p(), { timeoutMs });
  }

  private readJson(file: string): unknown {
    return JSON.parse(this.readText(file)) as unknown;
  }

  private readYaml(file: string): unknown {
    return parseYaml(this.readText(file)) as unknown;
  }

  private readText(file: string): string {
    return readFileSync(path.join(this.dir, file), 'utf8');
  }

  // --- the fake "Acme Tasks" upstream and the plugin's client ---

  list(name: string): AcmeList {
    const list = this.lists.find((l) => l.name === name);
    if (!list) throw new Error(`Acme Tasks has no list "${name}"`);
    return list;
  }

  addList(name: string, titles: string[] = []) {
    const list: AcmeList = {
      id: `l-${this.lists.length + 1}`,
      name,
      tasks: titles.map((title) => ({ title, done: false })),
    };
    this.lists.push(list);
    return list;
  }

  async startAcme() {
    if (this.port) return;
    this.port = await this.listen((req, res, body) => this.acme(req, res, body), this.received);
    this.otherPort = await this.listen((_req, res) => res.end('{}'), this.otherHostReceived);
  }

  private async listen(
    handle: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void,
    log: Received[],
  ): Promise<number> {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        log.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
        handle(req, res, body);
      });
    });
    this.servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return (server.address() as AddressInfo).port;
  }

  private acme(req: http.IncomingMessage, res: http.ServerResponse, body: string) {
    const send = (status: number, payload?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(payload === undefined ? '' : typeof payload === 'string' ? payload : JSON.stringify(payload));
    };
    const url = new URL(req.url ?? '/', 'http://acme');
    const parts = url.pathname
      .replace(/^\/api/, '')
      .split('/')
      .filter(Boolean);
    if (parts[0] === 'login' && req.method === 'POST') {
      this.signIns++;
      const sid = `s${++this.sessionCounter}`;
      this.sessions.add(sid);
      return send(200, {}, { 'set-cookie': `sid=${sid}; HttpOnly` });
    }
    if (parts[0] === 'spec') return this.serveDescription(parts[1] ?? '', send);
    if (this.sessionMode) {
      const sid = /sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      if (!sid || !this.sessions.has(sid)) return send(401, { message: 'sign in first' });
    } else if (req.headers.authorization !== `Bearer ${API_TOKEN}`) {
      return send(403, { message: 'token revoked' });
    }
    if (parts[0] === 'version') return send(200, this.version);
    if (parts[0] === 'account') return send(200, this.account);
    if (parts[0] === 'echo') return send(200, {});
    if (parts[0] === 'tokens' && req.method === 'POST') return send(201, { token: 'acme-tok-1a2b3c4d' });
    if (parts[0] === 'moved') return send(302, '', { location: `http://127.0.0.1:${this.otherPort}/api/lists` });
    if (parts[0] !== 'lists') return send(404, { message: 'not found' });
    if (parts.length === 1) return send(200, this.lists);
    const list = this.lists.find((l) => l.id === parts[1]);
    if (!list) return send(404, { message: 'no such list' });
    const failure = this.failures.get(list.name ?? '');
    if (failure !== undefined) return send(500, failure);
    if (this.bigAnswer) return send(200, 'x'.repeat(2048));
    const answer = () => {
      if (parts.length === 2 && req.method === 'DELETE') {
        this.lists.splice(this.lists.indexOf(list), 1);
        return send(204);
      }
      if (parts.length === 2) return send(200, list);
      if (parts[2] === 'share' || parts[2] === 'import') return send(200, {});
      if (parts[2] !== 'tasks') return send(404, { message: 'not found' });
      if (req.method === 'GET')
        return send(
          200,
          list.tasks.filter((t) => !t.done).map((t) => t.title),
        );
      if (req.method === 'POST') {
        const { title } = JSON.parse(body || '{}') as { title?: string };
        if (!title) return send(422, { message: 'title is required' });
        list.tasks.push({ title, done: false });
        return send(201, { title });
      }
      if (req.method === 'PATCH' && parts[3]) {
        const task = list.tasks.find((t) => t.title === decodeURIComponent(parts[3]!));
        if (task) task.done = true;
        return send(204);
      }
      return send(404, { message: 'not found' });
    };
    if (this.slowMs) setTimeout(answer, this.slowMs);
    else answer();
  }

  get descriptionYaml(): string {
    return this.descriptionText ?? stringifyYaml(this.description);
  }

  private serveDescription(ref: string, send: (status: number, payload?: unknown) => void) {
    if (this.descriptionFailures.has(ref)) return send(500, { message: 'storage offline' });
    if (!this.descriptionRefs.has(ref)) return send(404, { message: 'not found' });
    const text = this.descriptionYaml;
    if (this.descriptionSlowMs) setTimeout(() => send(200, text), this.descriptionSlowMs);
    else send(200, text);
  }

  /** How often Acme Tasks served its description. */
  get descriptionReads(): number {
    return this.received.filter((r) => r.path.startsWith('/api/spec/')).length;
  }

  /** Stops Acme Tasks, so its port refuses connections. */
  async stopAcme() {
    await this.startAcme();
    await closeServer(this.servers.shift()!);
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}/api`;
  }

  client(opts: Partial<HttpJsonClientOptions> = {}): HttpJsonClient {
    const token = this.token;
    return new HttpJsonClient({
      baseUrl: this.baseUrl,
      service: 'Acme Tasks',
      headers: (): Record<string, string> =>
        this.sessionMode ? (this.cookie ? { cookie: this.cookie } : {}) : { authorization: `Bearer ${token}` },
      ...(this.maxBytes ? { maxBytes: this.maxBytes } : {}),
      ...(this.timeoutMs ? { timeoutMs: this.timeoutMs } : {}),
      ...opts,
    });
  }

  /** A client that signs in to Acme Tasks with a form, before its first call and again after a refusal. */
  sessionClient(): HttpJsonClient {
    const client: HttpJsonClient = this.client({
      before: async (deadline) => {
        if (!this.cookie) await this.signIn(client, deadline);
      },
      onAuthFailure: async (deadline) => {
        await this.signIn(client, deadline);
        return true;
      },
    });
    return client;
  }

  async signIn(client: HttpJsonClient, deadline?: number) {
    const res = await client.raw('POST', '/login', {
      body: { username: 'author3', password: 'acme sign-in phrase' },
      bodyEncoding: 'form',
      ...(deadline ? { deadline } : {}),
    });
    const cookies = res.headers['set-cookie'] ?? [];
    this.cookie = cookies[0]?.split(';')[0];
    return cookies;
  }

  // --- the OpenAPI catalog ---

  /** The catalog key of the Acme Tasks operation with this summary. */
  keyOf(summary: string): string {
    return keyOf(this.description, summary);
  }

  /** Builds the catalog from the description Acme Tasks gives, with the rules of `plugin.yaml`. */
  buildFromDescription() {
    this.loadSettings();
    if (this.settings?.error) throw new Error(`plugin.yaml is not valid: ${this.settings.error}`);
    try {
      this.openapi = buildOpenApiCatalog(this.descriptionYaml, {
        service: 'Acme Tasks',
        rules: this.rules(),
        ...this.openApiOptions,
      });
      this.catalog = { operations: this.openapi.operations };
    } catch (err) {
      this.catalog = { error: explain(err) };
    }
  }

  /** The plugin's `acme.request(...)`, over the catalog built from the description. */
  binding(): RestBinding {
    if (!this.openapi) this.buildFromDescription();
    const catalog = this.openapi;
    if (!catalog) throw new Error(`no catalog: ${this.catalog?.error}`);
    const others = new Set(this.lists.filter((l) => l.owner).map((l) => l.id));
    return restBinding({
      namespace: 'acme',
      service: 'Acme Tasks',
      rules: this.rules(),
      catalog: async () => catalog,
      client: () => this.client(),
      splitWhen: { 'other-user': (call) => others.has(call.params.path?.listId) },
    });
  }

  // --- the plugin process, driven as core drives it ---

  /** Writes plugin.yaml, with the lists of plugin author 3 in the plugin's own section. */
  writePluginYaml() {
    this.setYaml({ plugin: { myLists: this.lists.filter((l) => !l.owner).map((l) => l.id!) } });
    this.writeFile('plugin.yaml', this.pluginYaml);
  }

  /** Starts the plugin as its own process, with plugin.yaml and the lists of plugin author 3. */
  async startPlugin() {
    await this.startAcme();
    this.writePluginYaml();
    const child = fork(PLUGIN_MAIN, [], {
      cwd: SDK_ROOT,
      execArgv: ['--import', 'tsx', '--conditions', 'synoikia-source'],
      env: { ...process.env, ACME_PLUGIN_DIR: this.dir },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    child.on('message', (msg: RpcResponse | RpcNotification) => {
      if ('id' in msg) this.waiting.get(msg.id)?.(msg);
      else if (msg.method === 'log') this.pluginLog.push(msg.params.message);
    });
    this.plugin = child;
  }

  /** Sends one request to the plugin, as core does, and waits for its reply. */
  send(method: string, params?: unknown): Promise<RpcResponse> {
    if (!this.plugin) throw new Error('core has not started the plugin');
    const id = ++this.rpcId;
    const reply = new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the plugin did not answer ${method}`)), 10_000);
      this.waiting.set(id, (res) => {
        clearTimeout(timer);
        this.waiting.delete(id);
        this.replies.push(res);
        resolve(res);
      });
    });
    this.plugin.send({ jsonrpc: '2.0', id, method, params });
    return reply;
  }

  /** The connection core gives the plugin. */
  initParams(over: Partial<InitParams> = {}): InitParams {
    return {
      instanceId: 'tasks',
      config: { baseUrl: this.baseUrl },
      secrets: { token: this.token },
      sdkVersion: SDK_VERSION,
      ...over,
    };
  }

  get lastReply(): RpcResponse {
    const r = this.replies.at(-1);
    if (!r) throw new Error('the plugin sent no reply');
    return r;
  }

  /** Runs one call of the plugin and keeps what it got back. */
  async call(run: () => Promise<unknown>): Promise<Outcome> {
    await this.startAcme();
    let outcome: Outcome;
    try {
      outcome = { ok: true, value: await run() };
    } catch (err) {
      outcome = { ok: false, error: err as Error & { code?: string } };
    }
    this.outcomes.push(outcome);
    return outcome;
  }

  get last(): Outcome {
    const o = this.outcomes.at(-1);
    if (!o) throw new Error('the plugin made no call');
    return o;
  }

  async stop() {
    this.plugin?.kill();
    await Promise.all(this.servers.map(closeServer));
    rmSync(this.dir, { recursive: true, force: true });
  }
}

setWorldConstructor(PluginAuthorWorld);

After(async (world: PluginAuthorWorld) => {
  await world.stop();
});
