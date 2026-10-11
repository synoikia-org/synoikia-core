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
import { sha256, signPayload } from '../src/auth/tokens.js';
import { auditLog, operations, pluginInstances, settings, users } from '../src/db/schema.js';
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
  it('needs a signed-in user and a POST: opening the link alone decides nothing', async () => {
    const t = await withPendingCall(
      `return (await echo.call('echo.set', { name: 'vol/a', password: 'hunter2' })).key;`,
    );
    expect(t.page).toMatch(/^\/a\/[\w-]+$/);

    const signedIn = await t.signIn(t.page);
    expect(signedIn.status).toBe(303);
    expect(signedIn.headers.get('location')).toBe(t.page);
    expect(t.ctx.db.select().from(auditLog).where(eq(auditLog.decidedVia, 'url')).all()).toHaveLength(0);

    const pageHtml = await (await t.browse(t.page)).text();
    expect(pageHtml).toContain('echo.set');
    expect(pageHtml).not.toContain('hunter2');
    expect(pageHtml).toContain('Signed in as <strong>admin</strong>');
    expect(pageHtml).not.toContain('name="totp"');

    // Without the CSRF field the POST is refused.
    expect((await t.browse(t.page, { decision: 'approve' })).status).toBe(400);
    const done = await t.browse(t.page, { decision: 'approve', csrf: hidden(pageHtml, 'csrf') });
    expect(await done.text()).toContain('was approved');
    await expect(t.run).resolves.toMatchObject({ ok: true, value: 'echo.set' });
    const audit = t.ctx.db.select().from(auditLog).where(eq(auditLog.decidedVia, 'url')).all();
    expect(audit.map((a) => [a.decision, a.actorId, a.decidedBy])).toEqual([['human-approved', 'claude', 'admin']]);

    // The link is burnt once decided.
    expect((await t.browse(t.page)).status).toBe(404);
  });

  it('asks locked operations for the typed confirmation only, and can deny', async () => {
    const t = await withPendingCall(`return (await echo.call('echo.delete', { name: 'vol/x' })).key;`, {
      lockedAsk: true,
    });
    await t.signIn(t.page);
    t.advance(6 * 60_000);
    const pageHtml = await (await t.browse(t.page)).text();
    expect(pageHtml).toContain('Type <code>vol/x</code> to approve');
    expect(pageHtml).not.toContain('name="totp"');
    expect(pageHtml).not.toContain('Authenticator code');
    const csrf = hidden(pageHtml, 'csrf');

    for (const confirm of [undefined, 'nope', 'VOL/X']) {
      const res = await t.browse(t.page, { decision: 'approve', csrf, ...(confirm ? { confirm } : {}) });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('exactly to approve');
    }

    expect(await (await t.browse(t.page, { decision: 'deny', csrf })).text()).toContain('was denied');
    await expect(t.run).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
  });

  it('approves a locked operation with the typed confirmation', async () => {
    const t = await withPendingCall(`return (await echo.call('echo.delete', { name: 'vol/x' })).key;`, {
      lockedAsk: true,
      totp: false,
    });
    await t.signIn(t.page);
    const csrf = hidden(await (await t.browse(t.page)).text(), 'csrf');
    const res = await t.browse(t.page, { decision: 'approve', confirm: 'vol/x', csrf });
    expect(await res.text()).toContain('was approved');
    await expect(t.run).resolves.toMatchObject({ ok: true, value: 'echo.delete' });
  });

  it('lets users without TOTP approve', async () => {
    const t = await withPendingCall(`return (await echo.call('echo.set', { name: 'x' })).key;`, { totp: false });
    expect((await t.signIn(t.page)).status).toBe(303);
    const res = await t.browse(t.page);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('name="totp"');
    const done = await t.browse(t.page, { decision: 'approve', csrf: hidden(html, 'csrf') });
    expect(await done.text()).toContain('was approved');
    await expect(t.run).resolves.toMatchObject({ ok: true, value: 'echo.set' });
    const [row] = t.ctx.db.select().from(auditLog).where(eq(auditLog.decidedVia, 'url')).all();
    expect(row).toMatchObject({ decidedBy: 'admin', detail: expect.objectContaining({ approverSignIn: 'session' }) });
  });

  it('accepts only a CSRF field made for this approval, this approver and this browser', async () => {
    const t = await withPendingCall(`return (await echo.call('echo.set', { name: 'vol/a' })).key;`, { totp: false });
    await t.signIn(t.page);
    await t.browse(t.page);
    const cookie = t.jar.get('syn_mcp_csrf')!;
    const token = t.page.slice('/a/'.length);
    const field = (bind: { a: string; u: string; c: string }) =>
      signPayload(t.ctx.keys.state, bind, 60_000, t.ctx.now().getTime());
    const right = { a: sha256(token), u: t.adminId, c: sha256(cookie) };
    for (const csrf of [
      cookie, // the bare double-submit value
      field({ ...right, a: sha256('another-approval-token') }),
      field({ ...right, u: 'another-user-id' }),
      field({ ...right, c: sha256('a-planted-cookie') }),
      `${field(right)}x`,
    ]) {
      const res = await t.browse(t.page, { decision: 'approve', csrf });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('The form expired');
    }
    expect(await (await t.browse(t.page, { decision: 'approve', csrf: field(right) })).text()).toContain(
      'was approved',
    );
    await expect(t.run).resolves.toMatchObject({ ok: true });
  });

  it('enforces "require two-factor" on the MCP-port sign-in (it faces the internet)', async () => {
    const t = await withPendingCall(`await echo.call('echo.set', { name: 'x' });`, { totp: false });
    updateSettings(t.ctx.db, 'security', { requireTotp: true });
    const res = await t.signIn(t.page);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('requires two-factor authentication');
    // No session was started: the page still asks to sign in.
    expect(await (await t.browse(t.page)).text()).toContain('Sign in to review this approval request');
    t.ctx.approvals.cancelAll();
    await t.run;
  });

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

  it('offers "Approve for this session"; the grant then covers that client’s later Ask calls', async () => {
    const t = await withPendingCall(`return (await echo.call('echo.set', { name: 'vol/a' })).key;`);
    await t.signIn(t.page);
    const html = await (await t.browse(t.page)).text();
    expect(html).toContain('Approve once');
    expect(html).toContain('Approve for this session');
    expect(html).toMatch(/<option value="1"/);
    expect(html).toMatch(/<option value="4"/);
    // Approving once stays the main action; a session grant is the deliberate one.
    expect(html).toMatch(/class="primary" type="submit" name="decision" value="approve"/);
    expect(html).toContain('<strong>claude</strong>');

    // A length the page did not offer is refused.
    const bad = await t.browse(t.page, { csrf: hidden(html, 'csrf'), decision: 'approve_session', grant: '99' });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('Choose a session length');

    const res = await t.browse(t.page, { csrf: hidden(html, 'csrf'), decision: 'approve_session', grant: '1' });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('run without asking until');
    expect(await t.run).toMatchObject({ ok: true, value: 'echo.set' });
    const [grant] = t.ctx.grants.list();
    expect(grant).toMatchObject({ principal: 'claude', createdBy: 'admin' });
    expect(grant!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3_600_000 + 5_000);

    const instanceId = grant!.instanceId;
    const caller = {
      client: { kind: 'mcp_client' as const, id: 'claude' },
      principal: { ceiling: 'write' as const, roleId: 'admin' },
    };
    const again = await executeCode(
      t.ctx.gateDeps(),
      t.ctx.instances.runtime(instanceId),
      caller,
      `return (await echo.call('echo.set', { name: 'vol/b' })).key;`,
    );
    expect(again).toMatchObject({ ok: true, value: 'echo.set' });
    const last = t.ctx.db.select().from(auditLog).all().at(-1)!;
    expect(last.decision).toBe(`auto-approved:grant:${grant!.id}`);

    // Another client is not covered.
    const stranger = await executeCode(
      t.ctx.gateDeps(),
      t.ctx.instances.runtime(instanceId),
      { ...caller, client: { kind: 'mcp_client', id: 'other' } },
      `return (await echo.call('echo.set', { name: 'vol/c' })).key;`,
    );
    expect(stranger).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(
      t.ctx.db
        .select()
        .from(auditLog)
        .all()
        .some((a) => a.decision === 'session_grant.created'),
    ).toBe(true);
  });

  it('never offers a session grant for locked operations, or when the endpoint turns it off', async () => {
    const locked = await withPendingCall(`await echo.call('echo.delete', { name: 'vol/x' });`, { lockedAsk: true });
    await locked.signIn(locked.page);
    expect(await (await locked.browse(locked.page)).text()).not.toContain('Approve for this session');
    locked.ctx.approvals.cancelAll();
    await locked.run;

    const off = await withPendingCall(`await echo.call('echo.set', { name: 'x' });`);
    // Straight to the row: an update through the manager restarts the endpoint and cancels the approval.
    off.ctx.db
      .update(pluginInstances)
      .set({ settings: { sessionGrantMaxHours: 0 } })
      .run();
    await off.signIn(off.page);
    const html = await (await off.browse(off.page)).text();
    expect(html).not.toContain('Approve for this session');
    // Even a forged POST gets no grant.
    const res = await off.browse(off.page, { csrf: hidden(html, 'csrf'), decision: 'approve_session', grant: '1' });
    expect(res.status).toBe(400);
    expect(off.ctx.grants.list()).toEqual([]);
    off.ctx.approvals.cancelAll();
    await off.run;
  });

  it('keeps the approval browser signed in for hours', async () => {
    const t = await withPendingCall(`return (await echo.call('echo.set', { name: 'vol/a' })).key;`);
    await t.signIn(t.page);
    const html = await (await t.browse(t.page)).text();
    await t.browse(t.page, { csrf: hidden(html, 'csrf'), decision: 'approve' });
    await t.run;

    t.advance(3 * 60 * 60_000); // past the old 60-minute limit, within 12 h idle
    const opened: UrlPromptRequest[] = [];
    const instanceId = t.ctx.instances.list()[0]!.id;
    const run = executeCode(
      t.ctx.gateDeps(),
      t.ctx.instances.runtime(instanceId),
      {
        client: { kind: 'mcp_client', id: 'claude' },
        principal: { ceiling: 'write' as const, roleId: 'admin' },
        prompts: { url: async (req) => (opened.push(req), { action: 'accept' }) },
      },
      `return (await echo.call('echo.set', { name: 'vol/b' })).key;`,
    );
    for (let i = 0; i < 200 && opened.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    const second = await (await t.browse(opened[0]!.path)).text();
    expect(second).toContain('Signed in as <strong>admin</strong>');
    await t.browse(opened[0]!.path, { csrf: hidden(second, 'csrf'), decision: 'approve' });
    expect(await run).toMatchObject({ ok: true });

    // The approval session follows the admin's settings.
    updateSettings(t.ctx.db, 'security', { approvalSessionIdleHours: 1 });
    t.advance(2 * 60 * 60_000);
    const cancelled = executeCode(
      t.ctx.gateDeps(),
      t.ctx.instances.runtime(instanceId),
      {
        client: { kind: 'mcp_client', id: 'claude' },
        principal: { ceiling: 'write' as const, roleId: 'admin' },
        prompts: { url: async (req) => (opened.push(req), { action: 'accept' }) },
      },
      `await echo.call('echo.set', { name: 'vol/c' });`,
    );
    for (let i = 0; i < 200 && opened.length === 1; i++) await new Promise((r) => setTimeout(r, 10));
    expect(await (await t.browse(opened[1]!.path)).text()).toContain('Sign in to review this approval request');
    t.ctx.approvals.cancelAll();
    await cancelled;
  });

  it('lets only the user whose client made the call decide, even against another admin', async () => {
    const t = await withPendingCall(`return await echo.call('echo.set', { name: 'vol/a' });`, { ownedByOther: true });
    expect((await t.signIn(t.page)).status).toBe(303);
    const page = await t.browse(t.page);
    expect(page.status).toBe(403);
    const html = await page.text();
    expect(html).toContain('belongs to another user');
    expect(html).not.toContain('echo.set');
    expect((await t.browse(t.page, { decision: 'approve', csrf: 'x' })).status).toBe(403);
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

  it('rejects unknown tokens', async () => {
    const t = await withPendingCall(`await echo.call('echo.set', { name: 'x' });`);
    expect((await t.browse('/a/not-a-real-token-at-all-000000')).status).toBe(404);
    expect((await t.browse('/a/short')).status).toBe(404);
    t.ctx.approvals.cancelAll();
    await t.run;
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

    it("signs the owner in from the provider's assertion: GET renders, POST with CSRF decides", async () => {
      const t = await pending();
      const browse = t.accessBrowser(await owner());
      const res = await browse(t.page);
      expect(res.status).toBe(200);
      expect(res.headers.getSetCookie().some((c) => c.startsWith('syn_mcp_csrf='))).toBe(true);
      // No approval session is kept: the provider vouches for every request.
      expect(res.headers.getSetCookie().some((c) => c.startsWith('syn_mcp_approve='))).toBe(false);
      const html = await res.text();
      expect(html).toContain(`Signed in as <strong>${OWNER}</strong> via Cloudflare Access`);
      expect(html).not.toContain('name="totp"');

      // Without the CSRF field the POST is refused.
      const forged = await browse(t.page, { decision: 'approve' });
      expect(forged.status).toBe(400);
      expect(await forged.text()).toContain('The form expired');

      const done = await browse(t.page, { decision: 'approve', csrf: hidden(html, 'csrf') });
      expect(await done.text()).toContain('was approved');
      await expect(t.run).resolves.toMatchObject({ ok: true, value: 'echo.set' });
      const [row] = t.ctx.db.select().from(auditLog).where(eq(auditLog.decidedVia, 'url')).all();
      expect(row).toMatchObject({ decidedBy: OWNER, detail: expect.objectContaining({ approverSignIn: 'external' }) });
    });

    it("refuses another user's assertion", async () => {
      const t = await pending({ ownedByOther: true });
      const browse = t.accessBrowser(await owner());
      const res = await browse(t.page);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain('belongs to another user');
      expect((await browse(t.page, { decision: 'approve', csrf: 'x' })).status).toBe(403);
      await settle(t);
    });

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

    it('ignores the assertion for a disabled owner', async () => {
      const t = await pending();
      await t.ctx.users.create({ username: 'other-admin', password: PASSWORD });
      t.ctx.users.setDisabled(t.adminId, true);
      const res = await t.accessBrowser(await owner())(t.page);
      expect(await res.text()).toContain('Sign in to review this approval request');
      await settle(t);
    });

    it('ignores the assertion on an endpoint without the external method', async () => {
      const t = await pending();
      t.ctx.db
        .update(pluginInstances)
        .set({ authMethods: ['bearer'] })
        .where(eq(pluginInstances.id, t.instanceId))
        .run();
      const res = await t.accessBrowser(await owner())(t.page);
      expect(await res.text()).toContain('Sign in to review this approval request');
      await settle(t);
    });

    it('ignores the assertion when the external method is off globally', async () => {
      const t = await pending();
      updateSettings(t.ctx.db, 'mcp', { clientAuth: { bearer: true, oauth: true, external: false } });
      const res = await t.accessBrowser(await owner())(t.page);
      expect(await res.text()).toContain('Sign in to review this approval request');
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

    it('lets a page sign-in win over the assertion', async () => {
      const t = await pending();
      await t.ctx.users.create({ username: 'eve@example.com', password: PASSWORD });
      expect((await t.signIn(t.page)).status).toBe(303);
      // Alone, eve's assertion is refused; with the owner's page sign-in, the session decides.
      const eve = await signAssertion({ sub: 'u-3', email: 'eve@example.com' });
      expect((await t.accessBrowser(eve)(t.page)).status).toBe(403);
      const html = await (await t.accessBrowser(eve, true)(t.page)).text();
      expect(html).toContain(`Signed in as <strong>${OWNER}</strong> ·`);
      await settle(t);
    });
  });
});
