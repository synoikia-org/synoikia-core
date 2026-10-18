import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { exportJWK, createLocalJWKSet, generateKeyPair, SignJWT } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { UrlPromptRequest } from '../src/approvals/service.js';
import { currentStep, totpAt } from '../src/auth/totp.js';
import { setGroupLevel, updateOperation } from '../src/catalog/groups.js';
import { getSettings, updateSettings } from '../src/settings.js';
import { operations, settings, users } from '../src/db/schema.js';
import { createMcpApp } from '../src/http/mcp-app.js';
import { executeCode } from '../src/runtime/index.js';
import { createTestApp } from './helpers.js';

const PASSWORD = 'correct horse battery';
const CF_TEAM = 'approvals.cloudflareaccess.com';
const CF_AUD = 'approvals-aud';

const cf = vi.hoisted(() => ({ keys: undefined as JWTVerifyGetKey | undefined }));
vi.mock('jose', async (importOriginal) => {
  const jose = await importOriginal<typeof import('jose')>();
  const createRemoteJWKSet = ((url: URL) =>
    url.hostname === 'approvals.cloudflareaccess.com'
      ? (...args: Parameters<JWTVerifyGetKey>) => cf.keys!(...args)
      : jose.createRemoteJWKSet(url)) as typeof jose.createRemoteJWKSet;
  return { ...jose, createRemoteJWKSet };
});

let signAssertion: (claims: Record<string, unknown>) => Promise<string>;
beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  cf.keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });
  signAssertion = (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(`https://${CF_TEAM}`)
      .setAudience(CF_AUD)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
});

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function formBrowser(
  app: Pick<Hono, 'request'>,
  extraHeaders: Record<string, string> = {},
  jar = new Map<string, string>(),
) {
  return async (url: string, fields?: Record<string, string>) => {
    const headers: Record<string, string> = { ...extraHeaders };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (fields) headers['content-type'] = 'application/x-www-form-urlencoded';
    const res = await app.request(url, {
      method: fields ? 'POST' : 'GET',
      headers,
      body: fields ? new URLSearchParams(fields).toString() : undefined,
    });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair!.indexOf('=');
      const value = pair!.slice(i + 1);
      if (value) jar.set(pair!.slice(0, i), value);
      else jar.delete(pair!.slice(0, i));
    }
    return res;
  };
}
const hidden = (page: string, name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(page)?.[1] ?? '';

/** An echo endpoint at Ask, an admin (with TOTP unless `totp: false`) and one call awaiting approval. */
async function withPendingCall(
  code: string,
  opts: {
    totp?: boolean;
    lockedAsk?: boolean;
    ownedByOther?: boolean;
    ownerless?: boolean;
    external?: boolean;
    username?: string;
  } = {},
) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-approval-'));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  let clock = Date.now();
  const ctx = await createTestApp({ DATA_DIR: dataDir }, { memoryDb: true, now: () => new Date(clock) });
  cleanup.push(() => ctx.stop());

  const username = opts.username ?? 'admin';
  const admin = await ctx.users.create({ username, password: PASSWORD });
  let secret = '';
  const step = currentStep();
  if (opts.totp !== false) {
    secret = ctx.users.beginTotp(admin.id).secret;
    ctx.users.confirmTotp(admin.id, totpAt(secret, step - 1));
  }

  if (opts.external)
    updateSettings(ctx.db, 'mcp', {
      clientAuth: { bearer: true, oauth: true, external: true },
      cfAccess: { teamDomain: CF_TEAM, aud: CF_AUD },
    });
  const instance = await ctx.instances.create({ pluginId: 'echo', slug: 'echo', connection: {} });
  await ctx.instances.syncNow(instance.id);
  setGroupLevel(ctx.db, instance.id, 'echo', 'ask');
  if (opts.lockedAsk) {
    const del = ctx.db.select().from(operations).where(eq(operations.key, 'echo.delete')).get()!;
    updateOperation(ctx.db, instance.id, del.id, { level: 'ask' });
  }

  const opened: UrlPromptRequest[] = [];
  const run = executeCode(
    ctx.gateDeps(),
    ctx.instances.runtime(instance.id),
    {
      client: { kind: 'mcp_client', id: 'claude' },
      // The caller's credential belongs to the admin, unless another user's client made the call.
      principal: {
        ceiling: 'write' as const,
        roleId: 'admin',
        userId: opts.ownerless
          ? undefined
          : opts.ownedByOther
            ? (await ctx.users.create({ username: 'bob', password: PASSWORD })).id
            : admin.id,
      },
      prompts: {
        url: async (req) => {
          opened.push(req);
          return { action: 'accept' };
        },
      },
    },
    code,
  );
  for (let i = 0; i < 200 && opened.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  const mcpApp = createMcpApp(ctx);
  const jar = new Map<string, string>();
  const browse = formBrowser(mcpApp, {}, jar);

  /** Signs in through the MCP-port login (password, then the current TOTP step). */
  const signIn = async (page: string) => {
    const login = await (await browse(page)).text();
    expect(login).toContain('Sign in to review this approval request');
    const afterPassword = await browse('/oauth/login', {
      username,
      password: PASSWORD,
      csrf: hidden(login, 'csrf'),
      continue: page,
    });
    if (opts.totp === false) return afterPassword;
    const totpForm = await afterPassword.text();
    return browse('/oauth/login/totp', {
      mfa: hidden(totpForm, 'mfa'),
      csrf: hidden(totpForm, 'csrf'),
      continue: page,
      code: totpAt(secret, step),
    });
  };
  return {
    ctx,
    run,
    browse,
    /** A browser behind Cloudflare Access: every request carries the assertion (and, if `shared`, `browse`'s cookies). */
    accessBrowser: (assertion: string, shared = false) =>
      formBrowser(mcpApp, { 'cf-access-jwt-assertion': assertion }, shared ? jar : new Map()),
    signIn,
    page: opened[0]!.path,
    jar,
    adminId: admin.id,
    instanceId: instance.id,
    advance: (ms: number) => (clock += ms),
  };
}

describe('approval page', () => {
  it('keeps approval sign-ins apart from OAuth consent sign-ins (review L14)', async () => {
    const t = await withPendingCall(`return (await echo.call('echo.set', { name: 'vol/a' })).key;`);
    const signedIn = await t.signIn(t.page);
    const cookie = signedIn.headers.getSetCookie().find((c) => c.startsWith('syn_mcp_approve='))!;
    expect(cookie).toMatch(/Path=\/a(;|$)/);
    expect(cookie).toMatch(/HttpOnly/);
    const raw = cookie.slice('syn_mcp_approve='.length).split(';')[0]!;
    const limits = { idleMs: 60 * 60_000, absoluteMs: 24 * 60 * 60_000 };
    expect(t.ctx.sessions.validate(raw, 'approval_ui', limits)).not.toBeNull();
    // The same session can't stand in for a consent sign-in.
    expect(t.ctx.sessions.validate(raw, 'oauth_ui', limits)).toBeNull();
    expect(signedIn.headers.getSetCookie().some((c) => c.startsWith('syn_mcp_oauth='))).toBe(false);
  });

  it('leaves a call without an owner to admins', async () => {
    const t = await withPendingCall(`return await echo.call('echo.set', { name: 'vol/a' });`, { ownerless: true });
    const role = t.ctx.roles.create({ name: 'Viewers' });
    // Another admin stays, so the signed-in admin can become a Viewer.
    await t.ctx.users.create({ username: 'other-admin', password: PASSWORD });
    t.ctx.users.setRole(t.adminId, role.id, {});
    expect((await t.signIn(t.page)).status).toBe(303);
    expect((await t.browse(t.page)).status).toBe(403);
  });

  describe('with an external provider', () => {
    const OWNER = 'me@example.com';
    const owner = () => signAssertion({ sub: 'u-1', email: OWNER });
    const pending = (opts: { ownedByOther?: boolean; external?: boolean } = {}) =>
      withPendingCall(`return (await echo.call('echo.set', { name: 'vol/a' })).key;`, {
        external: true,
        username: OWNER,
        totp: false,
        ...opts,
      });
    const settle = async (t: Awaited<ReturnType<typeof withPendingCall>>) => {
      t.ctx.approvals.cancelAll();
      await t.run;
    };

    it('shows the sign-in page for a service token, a missing or invalid assertion, or an unknown user', async () => {
      const t = await pending();
      const assertions = [
        await signAssertion({ sub: '', common_name: 'abc.access' }),
        'not-a-jwt',
        (await owner()).slice(0, -4) + 'AAAA',
        await signAssertion({ sub: 'u-2', email: 'nobody@example.com' }),
      ];
      for (const browse of [t.browse, ...assertions.map((a) => t.accessBrowser(a))]) {
        const res = await browse(t.page);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('Sign in to review this approval request');
        expect((await browse(t.page, { decision: 'approve', csrf: 'x' })).status).toBe(200);
      }
      // Self-registration does not apply here: the unknown identity got no account.
      expect(t.ctx.users.byUsernameInsensitive('nobody@example.com')).toBeUndefined();
      await settle(t);
    });

    it('ignores the assertion when the provider has no configuration', async () => {
      const t = await pending();
      // Straight to the row: a save through updateSettings refuses `external` without a configuration.
      const mcp = { ...getSettings(t.ctx.db, 'mcp'), cfAccess: { teamDomain: '', aud: '' } };
      t.ctx.db.update(settings).set({ value: mcp }).where(eq(settings.key, 'mcp')).run();
      const res = await t.accessBrowser(await owner())(t.page);
      expect(await res.text()).toContain('Sign in to review this approval request');
      await settle(t);
    });

    it('never matches an owner from the sign-up form or OIDC, even with the same name', async () => {
      for (const registeredVia of ['signup', 'oidc'] as const) {
        const t = await pending();
        t.ctx.db.update(users).set({ registeredVia }).where(eq(users.id, t.adminId)).run();
        const res = await t.accessBrowser(await owner())(t.page);
        expect(await res.text()).toContain('Sign in to review this approval request');
        await settle(t);
      }
    });
  });
});
