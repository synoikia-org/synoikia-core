import { createHash, createHmac, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { After, QuickPickleWorld, setWorldConstructor } from 'quickpickle';
import { afterAll, inject } from 'vitest';
import { startFakeHttp } from '@synoikia/core/testing';
import { createAppContext } from '../../../core/src/app.js';
import type { AppContext } from '../../../core/src/app.js';
import { loadConfig } from '../../../core/src/config/env.js';
import { createLogger } from '../../../core/src/log.js';
import { startServers } from '../../../core/src/server.js';
import type { RunningServers } from '../../../core/src/server.js';
import { browser as apiClient } from '../../../core/test/admin-client.js';

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../core');
/** The upstream fake and the fixture plugin of core's World, for scenarios that need an instance. */
export const CORE_FIXTURES = path.join(CORE, 'test/fixtures/world');
export const ADMIN = { username: 'admin', password: 'world admin passphrase' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = () => createLogger('error', () => undefined);

// A data directory with the migrated database and the admin, built once and copied for each scenario, as in
// core's World. Its name holds a fingerprint of the migrations, so test processes share it until they change.
let template: Promise<string> | undefined;

async function buildTemplate(): Promise<string> {
  const migrations = path.join(CORE, 'drizzle');
  const hash = createHash('sha256');
  for (const file of (readdirSync(migrations, { recursive: true }) as string[]).sort())
    if (statSync(path.join(migrations, file)).isFile())
      hash.update(file).update(readFileSync(path.join(migrations, file)));
  const name = `synoikia-portal-template-${hash.digest('hex').slice(0, 16)}`;
  const target = path.join(tmpdir(), name);
  if (existsSync(path.join(target, '.ready'))) return target;
  const dir = mkdtempSync(path.join(tmpdir(), 'synoikia-portal-template-build-'));
  const ctx = await createAppContext(
    loadConfig({ DATA_DIR: dir, ADMIN_BOOTSTRAP_USERNAME: ADMIN.username, ADMIN_BOOTSTRAP_PASSWORD: ADMIN.password }),
    { log: quiet() },
  );
  await ctx.stop();
  writeFileSync(path.join(dir, '.ready'), '');
  try {
    renameSync(dir, target);
  } catch {
    rmSync(dir, { recursive: true, force: true });
  }
  return target;
}

// One Chromium for each test file; each scenario gets its own browser context, so no cookie or storage leaks.
let chromiumOnce: Promise<Browser> | undefined;
afterAll(async () => {
  const running = await chromiumOnce;
  chromiumOnce = undefined;
  await running?.close();
});

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

export type ApiClient = ReturnType<typeof apiClient>;

export interface Person {
  username: string;
  password: string;
  /** The base32 secret of their authenticator app, once they set one up. */
  totpSecret?: string;
}

/** A fresh core for each scenario, with the built portal, and a person's browser on it. */
export class PortalWorld extends QuickPickleWorld {
  dataDir = '';
  ctx?: AppContext;
  servers?: RunningServers;
  base = '';
  context!: BrowserContext;
  page!: Page;
  /** The admin's own Admin API session, for what the admin set up before the scenario. */
  admin?: ApiClient;
  people = new Map<string, Person>();
  roles = new Map<string, string>();
  cleanups: (() => Promise<unknown>)[] = [];

  async init() {
    await super.init();
    const { info } = this as unknown as { info: { config: { stepTimeout: number } } };
    info.config.stepTimeout = 15_000;
    this.dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-portal-'));
    cpSync(await (template ??= buildTemplate()), this.dataDir, { recursive: true });
    rmSync(path.join(this.dataDir, '.ready'));
    this.people.set('admin', { ...ADMIN });
    await this.startCore();
    const shared = await (chromiumOnce ??= chromium.launch());
    this.context = await shared.newContext({ baseURL: this.base });
    this.page = await this.context.newPage();
  }

  private async startCore() {
    this.ctx = await createAppContext(
      loadConfig({
        DATA_DIR: this.dataDir,
        MCP_HOST: '127.0.0.1',
        MCP_PORT: '0',
        ADMIN_HOST: '127.0.0.1',
        ADMIN_PORT: '0',
        ADMIN_UI_DIR: inject('portalDir'),
      }),
      { log: quiet(), oidcAllowInsecure: true },
    );
    await this.ctx.start();
    this.servers = await startServers(this.ctx);
    this.base = `http://127.0.0.1:${this.servers.admin.port}`;
  }

  private async stopCore() {
    await this.servers?.close(1000);
    await this.ctx?.stop();
    this.servers = undefined;
    this.ctx = undefined;
  }

  /** A new server: core on an empty data directory, without any account. The browser stays on the old address. */
  async freshCore() {
    await this.stopCore();
    rmSync(this.dataDir, { recursive: true, force: true });
    this.dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-portal-'));
    this.people.clear();
    this.admin = undefined;
    await this.startCore();
    await this.context.close();
    this.context = await (await chromiumOnce!).newContext({ baseURL: this.base });
    this.page = await this.context.newPage();
  }

  async stop() {
    for (const undo of this.cleanups.splice(0).reverse()) await undo().catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.stopCore();
    if (this.dataDir) rmSync(this.dataDir, { recursive: true, force: true });
  }

  // ── the Admin API, for what people set up before the scenario ──

  async expectOk(res: Promise<Response>, what: string) {
    const r = await res;
    if (!r.ok) throw new Error(`${what}: ${r.status} ${await r.text()}`);
    return (await r.json().catch(() => undefined)) as Record<string, unknown>;
  }

  /** A signed-out Admin API session of its own, like a second browser. */
  async apiSession() {
    const client = apiClient({
      request: (p, init) => fetch(`${this.base}${String(p)}`, { ...init, redirect: 'manual' }),
    });
    await client.init();
    return client;
  }

  /** The Admin API session of a person with a password; a person with an app gives its current code. */
  async apiAs(name: string) {
    const who = this.person(name);
    const client = await this.apiSession();
    const res = await this.expectOk(client.post('/auth/login', who), `sign in as ${name}`);
    if (res.status === 'totp_required')
      await this.expectOk(client.post('/auth/totp', { code: totpCode(who.totpSecret!) }), `code of ${name}`);
    return client;
  }

  async adminApi() {
    return (this.admin ??= await this.apiAs('admin'));
  }

  person(name: string) {
    const p = this.people.get(name);
    if (!p) throw new Error(`The World has no person "${name}" yet`);
    return p;
  }

  async role(name: string) {
    const known = this.roles.get(name);
    if (known) return known;
    const created = await this.expectOk((await this.adminApi()).post('/api/roles', { name }), 'create role');
    this.roles.set(name, created.id as string);
    return created.id as string;
  }

  /** A user with a password that the admin made; `roleId` defaults to a role of that name. */
  async user(name: string, role: { name: string } | { id: string }) {
    const known = this.people.get(name);
    if (known) return known;
    const roleId = 'id' in role ? role.id : await this.role(role.name);
    const username = name.startsWith('user ') ? `${name.replace(/\s+/g, '')}@acme.example` : name;
    const password = `${username} world passphrase`;
    await this.expectOk((await this.adminApi()).post('/api/users', { username, password, roleId }), 'create user');
    const p = { username, password };
    this.people.set(name, p);
    return p;
  }

  /** The person sets up an authenticator app in their profile, confirmed with the code of the previous period. */
  async authenticatorApp(name: string) {
    const client = name === 'admin' ? await this.adminApi() : await this.apiAs(name);
    const begun = await this.expectOk(client.post('/api/profile/totp/begin'), 'start two-factor setup');
    const secret = begun.secret as string;
    await this.expectOk(
      client.post('/api/profile/totp/confirm', { code: totpCode(secret, -1) }),
      'confirm two-factor setup',
    );
    this.person(name).totpSecret = secret;
  }

  /** A fake service on its own port that stops with the scenario. */
  async fakeService(routes: Parameters<typeof startFakeHttp>[0]['routes']) {
    const fake = await startFakeHttp({ routes });
    this.cleanups.push(() => fake.close());
    return fake;
  }

  // ── the identity provider "Acme ID" ──

  /** The admin points core's single sign-on at a fake identity provider that signs in `acme.next`. */
  async singleSignOn(label: string) {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'acme-id-1', alg: 'RS256', use: 'sig' };
    const codes = new Map<string, { nonce: string; sub: string }>();
    const b64 = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
    const idp = await this.fakeService({
      'GET /.well-known/openid-configuration': () => ({
        body: {
          issuer: idp.url,
          authorization_endpoint: `${idp.url}/authorize`,
          token_endpoint: `${idp.url}/token`,
          jwks_uri: `${idp.url}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        },
      }),
      'GET /jwks': () => ({ body: { keys: [jwk] } }),
      'GET /authorize': (req) => {
        const code = randomBytes(12).toString('hex');
        codes.set(code, { nonce: req.query.get('nonce')!, sub: this.acmeNext });
        const back = new URL(req.query.get('redirect_uri')!);
        back.searchParams.set('code', code);
        back.searchParams.set('state', req.query.get('state')!);
        back.searchParams.set('iss', idp.url);
        return { status: 302, headers: { location: back.toString() } };
      },
      'POST /token': (req) => {
        const grant = codes.get(new URLSearchParams(String(req.body)).get('code') ?? '');
        if (!grant) return { status: 400, body: { error: 'invalid_grant' } };
        const now = Math.floor(Date.now() / 1000);
        const claims = { iss: idp.url, sub: grant.sub, aud: 'synoikia', nonce: grant.nonce, iat: now, exp: now + 300 };
        const input = `${b64({ alg: 'RS256', kid: 'acme-id-1', typ: 'JWT' })}.${b64(claims)}`;
        const signature = createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url');
        return { body: { access_token: 'acme-at', token_type: 'Bearer', id_token: `${input}.${signature}` } };
      },
    });
    await this.expectOk(
      (await this.adminApi()).put('/api/settings/oidc', {
        enabled: true,
        issuer: idp.url,
        clientId: 'synoikia',
        label,
      }),
      'set up single sign-on',
    );
  }

  /** The subject the identity provider signs in next. */
  acmeNext = 'acme-admin';

  /** The admin links their own account to the identity provider from their Admin API session. */
  async linkSingleSignOn() {
    const admin = await this.adminApi();
    let at = new URL('/auth/oidc/link', this.base);
    for (let hop = 0; hop < 10; hop++) {
      const own = at.origin === this.base;
      if (own && !at.pathname.startsWith('/auth/')) return at;
      const res = own ? await admin.get(at.pathname + at.search) : await fetch(at, { redirect: 'manual' });
      // The link callback answers with a page that refreshes to the next address.
      const next =
        res.headers.get('location') ??
        /http-equiv="refresh" content="0;url=([^"]+)"/.exec(await res.text())?.[1]?.replace(/&amp;/g, '&');
      if (!next) throw new Error(`link single sign-on stopped at ${at.pathname}: ${res.status}`);
      at = new URL(next, at);
    }
    throw new Error('link single sign-on: too many redirects');
  }

  // ── the browser ──

  async open(where: string) {
    await this.page.goto(where);
  }

  /** The person fills in the sign-in form in the browser and sends it. */
  async signIn(name: string, password = this.person(name).password) {
    await this.page.getByLabel('Username').fill(this.person(name).username);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }
}

setWorldConstructor(PortalWorld);

// Quickpickle gives the After hook the 3 s step limit; a slow stop ends in the background.
After(async (world: PortalWorld) => {
  await Promise.race([world.stop(), sleep(2500)]);
});
