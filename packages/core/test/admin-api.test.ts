import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { base32Decode, currentStep, totpAt } from '../src/auth/totp.js';
import { signPayload } from '../src/auth/tokens.js';
import { writeAudit } from '../src/audit.js';
import { applyRegistrySync } from '../src/catalog/registry.js';
import {
  mcpTokens,
  operationGroups,
  operations,
  pendingApprovals,
  preApprovalRules,
  userLevels,
  users,
} from '../src/db/schema.js';
import { createAdminApp } from '../src/http/admin-app.js';
import { updateSettings } from '../src/settings.js';
import { CORE_VERSION } from '../src/version.js';
import { eq } from 'drizzle-orm';
import { browser } from './admin-client.js';
import { createTestApp } from './helpers.js';

const PASSWORD = 'correct horse battery';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function setup(env: Record<string, string> = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-admin-'));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const ctx = await createTestApp(
    { DATA_DIR: dataDir, ...env },
    { memoryDb: true, supervisor: { backoff: { initialMs: 20, maxMs: 100 }, initTimeoutMs: 3000, rpcTimeoutMs: 5000 } },
  );
  cleanup.push(() => ctx.stop());
  const app = createAdminApp(ctx);
  return { ctx, app, client: () => browser(app).init() };
}

async function signedIn(t: Awaited<ReturnType<typeof setup>>) {
  const b = await t.client();
  expect((await b.post('/api/setup', { username: 'admin', password: PASSWORD })).status).toBe(200);
  return b;
}

describe('setup, login and sessions', () => {
  it('creates the first account once and signs it in', async () => {
    const t = await setup();
    const b = await t.client();
    expect(await (await b.get('/api/session')).json()).toMatchObject({
      authenticated: false,
      setupRequired: true,
      localLoginEnabled: true,
    });
    expect((await b.post('/api/setup', { username: 'admin', password: 'short' })).status).toBe(400);
    expect((await b.post('/api/setup', { username: 'admin', password: PASSWORD })).status).toBe(200);
    expect(await (await b.get('/api/session')).json()).toMatchObject({
      authenticated: true,
      user: { username: 'admin' },
    });
    expect((await (await t.client()).post('/api/setup', { username: 'x', password: PASSWORD })).status).toBe(409);
  });

  it('requires the CSRF token and a same-origin Origin on state-changing requests', async () => {
    const t = await setup();
    const b = await t.client();
    expect(
      (await b.post('/api/setup', { username: 'admin', password: PASSWORD }, { 'x-csrf-token': 'nope' })).status,
    ).toBe(403);
    const noCsrf = browser(t.app, { csrf: false });
    await noCsrf.init();
    expect((await noCsrf.post('/api/setup', { username: 'admin', password: PASSWORD })).status).toBe(403);
    expect(
      (await b.post('/api/setup', { username: 'admin', password: PASSWORD }, { origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect(
      (await b.post('/api/setup', { username: 'admin', password: PASSWORD }, { origin: 'http://localhost' })).status,
    ).toBe(200);
  });

  it('logs in and out, and locks a username after repeated failures', async () => {
    const t = await setup();
    await signedIn(t);
    const b = await t.client();
    expect((await b.get('/api/instances')).status).toBe(401);
    expect((await b.post('/auth/login', { username: 'admin', password: 'wrong password!' })).status).toBe(401);
    expect(await (await b.post('/auth/login', { username: 'admin', password: PASSWORD })).json()).toMatchObject({
      status: 'ok',
    });
    expect((await b.get('/api/instances')).status).toBe(200);
    await b.post('/auth/logout');
    expect((await b.get('/api/instances')).status).toBe(401);

    for (let i = 0; i < 5; i++) await b.post('/auth/login', { username: 'admin', password: 'wrong password!' });
    const locked = await b.post('/auth/login', { username: 'admin', password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ error: 'locked' });
  });

  it('adds a TOTP step after enrollment and blocks code replay', async () => {
    const t = await setup();
    const b = await signedIn(t);
    const { secret } = (await (await b.post('/api/profile/totp/begin')).json()) as { secret: string };
    expect(base32Decode(secret)).toHaveLength(20);
    const step = currentStep();
    const confirm = await b.post('/api/profile/totp/confirm', { code: totpAt(secret, step) });
    expect(((await confirm.json()) as { recoveryCodes: string[] }).recoveryCodes).toHaveLength(10);
    await b.post('/auth/logout');

    expect(await (await b.post('/auth/login', { username: 'admin', password: PASSWORD })).json()).toEqual({
      status: 'totp_required',
    });
    expect((await b.get('/api/instances')).status).toBe(401);
    expect((await b.post('/auth/totp', { code: totpAt(secret, step) })).status).toBe(401); // replay of the enrollment code
    expect((await b.post('/auth/totp', { code: totpAt(secret, step + 1) })).status).toBe(200);
    expect((await b.get('/api/instances')).status).toBe(200);
  });

  it('forces TOTP enrollment when required, allowing only enrollment routes', async () => {
    const t = await setup();
    const b = await signedIn(t);
    expect((await b.put('/api/settings/security', { requireTotp: true })).status).toBe(200);
    expect(await (await b.get('/api/session')).json()).toMatchObject({ mustEnrollTotp: true });
    expect(await (await b.get('/api/instances')).json()).toMatchObject({ error: 'totp_enrollment_required' });
    expect((await b.post('/api/profile/totp/begin')).status).toBe(200);
  });

  it('refuses to disable local login without working SSO', async () => {
    const t = await setup();
    const b = await signedIn(t);
    expect(await (await b.put('/api/settings/security', { disableLocalLogin: true })).json()).toMatchObject({
      error: 'oidc_required',
    });
  });

  it('keeps single sign-on usable while local login is off (review L18)', async () => {
    const t = await setup();
    const b = await signedIn(t);
    const sso = (await (
      await b.post('/api/users', { username: 'sso', password: PASSWORD, roleId: 'admin' })
    ).json()) as { id: string };
    t.ctx.db
      .update(users)
      .set({ oidcIssuer: 'https://idp.example.com', oidcSubject: 'sub-1' })
      .where(eq(users.id, sso.id))
      .run();
    const ssoClient = await t.client();
    expect((await ssoClient.post('/auth/login', { username: 'sso', password: PASSWORD })).status).toBe(200);
    updateSettings(t.ctx.db, 'security', { disableLocalLogin: true });

    const refused = { error: 'local_login_disabled' };
    expect(await (await b.patch(`/api/users/${sso.id}`, { disabled: true })).json()).toMatchObject(refused);
    expect(await (await b.put('/api/settings/oidc', { enabled: false })).json()).toMatchObject(refused);
    expect(await (await ssoClient.post('/api/profile/oidc/unlink')).json()).toMatchObject(refused);
    expect(t.ctx.users.get(sso.id)).toMatchObject({ disabled: false, oidcSubject: 'sub-1' });

    updateSettings(t.ctx.db, 'security', { disableLocalLogin: false });
    expect((await b.patch(`/api/users/${sso.id}`, { disabled: true })).status).toBe(200);
  });

  it('links an OIDC identity through a same-site hop, since the IdP redirect carries no session cookie', async () => {
    const t = await setup();
    const b = await signedIn(t);
    const { user } = (await (await b.get('/api/session')).json()) as { user: { id: string } };
    const identity = { issuer: 'https://idp.example.com', subject: 'sub-1', groups: [] };
    const state = {
      purpose: 'admin_link' as const,
      userId: user.id,
      verifier: 'v',
      state: 's',
      nonce: 'n',
      redirectUri: 'https://admin.lan/auth/oidc/callback',
    };
    vi.spyOn(t.ctx.oidc, 'complete').mockResolvedValue({ identity, state });
    const allowed = vi.spyOn(t.ctx.oidc, 'isAllowed').mockReturnValue(false);
    // A cross-site redirect from the IdP: the SameSite=Strict session cookie is not sent.
    const crossSite = await t.client();
    const callback = () => crossSite.get('/auth/oidc/callback?code=c&state=s');

    expect((await callback()).headers.get('location')).toBe('/profile?error=oidc_not_allowed');
    allowed.mockReturnValue(true);
    const hop = await callback();
    expect(hop.headers.get('cache-control')).toBe('no-store');
    expect(hop.headers.get('referrer-policy')).toBe('no-referrer');
    const finish = /url=([^"]+)"/.exec(await hop.text())?.[1];
    expect(finish).toMatch(/^\/auth\/oidc\/link\/finish\?t=/);
    expect(t.ctx.users.get(user.id).oidcSubject).toBeNull();

    // Without the session (or as another user) the hop links nothing.
    expect((await crossSite.get(finish!)).headers.get('location')).toBe('/login?error=session_changed');
    await t.ctx.users.create({ username: 'other', password: PASSWORD, roleId: 'admin' });
    const other = await t.client();
    await other.post('/auth/login', { username: 'other', password: PASSWORD });
    expect((await other.get(finish!)).headers.get('location')).toBe('/profile?error=session_changed');
    expect(t.ctx.users.get(user.id).oidcSubject).toBeNull();

    expect((await b.get(finish!)).headers.get('location')).toBe('/profile?linked=1');
    expect(t.ctx.users.get(user.id)).toMatchObject({ oidcSubject: 'sub-1' });
  });

  it('refuses a link callback whose state names no user', async () => {
    const t = await setup();
    const b = await signedIn(t);
    const { user } = (await (await b.get('/api/session')).json()) as { user: { id: string } };
    const state = { purpose: 'admin_link' as const, verifier: 'v', state: 's', nonce: 'n', redirectUri: 'r' };
    const identity = { issuer: 'https://idp.example.com', subject: 'sub-1', groups: [] };
    vi.spyOn(t.ctx.oidc, 'complete').mockResolvedValue({ identity, state });
    vi.spyOn(t.ctx.oidc, 'isAllowed').mockReturnValue(true);
    const res = await (await t.client()).get('/auth/oidc/callback?code=c&state=s');
    expect(res.headers.get('location')).toBe('/login?error=wrong_flow');
    expect(t.ctx.users.get(user.id).oidcSubject).toBeNull();
  });

  it('refuses a link token that is tampered, expired or signed for another purpose', async () => {
    const t = await setup();
    const b = await signedIn(t);
    const { user } = (await (await b.get('/api/session')).json()) as { user: { id: string } };
    const link = { purpose: 'oidc_link', userId: user.id, issuer: 'https://idp.example.com', subject: 'sub-1' };
    const finish = async (token: string) =>
      (await b.get(`/auth/oidc/link/finish?t=${encodeURIComponent(token)}`)).headers.get('location');
    const good = signPayload(t.ctx.keys.state, link, 60_000);

    expect(await finish(`${good}x`)).toBe('/profile?error=session_changed');
    expect(await finish(signPayload(t.ctx.keys.state, link, -1))).toBe('/profile?error=session_changed');
    expect(await finish(signPayload(t.ctx.keys.state, { mfaUser: user.id }, 60_000))).toBe(
      '/profile?error=session_changed',
    );
    expect(await finish(signPayload(t.ctx.keys.state, { ...link, purpose: 'other' }, 60_000))).toBe(
      '/profile?error=session_changed',
    );
    expect(t.ctx.users.get(user.id).oidcSubject).toBeNull();
    expect(await finish(good)).toBe('/profile?linked=1');
  });

  it('manages users; password changes sign out other sessions', async () => {
    const t = await setup();
    const b = await signedIn(t);
    const created = (await (
      await b.post('/api/users', { username: 'second', password: PASSWORD, roleId: 'admin' })
    ).json()) as {
      id: string;
    };
    const other = await t.client();
    await other.post('/auth/login', { username: 'second', password: PASSWORD });
    expect((await other.get('/api/instances')).status).toBe(200);
    await b.patch(`/api/users/${created.id}`, { password: 'a brand new password' });
    expect((await other.get('/api/instances')).status).toBe(401);

    const me = (await (await b.get('/api/profile')).json()) as { id: string };
    expect((await b.patch(`/api/users/${me.id}`, { disabled: true })).status).toBe(409);
  });
});

describe('deleting users', () => {
  async function withVictim() {
    const t = await setup();
    const b = await signedIn(t);
    const add = async (username: string, roleId = 'admin') =>
      ((await (await b.post('/api/users', { username, password: PASSWORD, roleId })).json()) as { id: string }).id;
    return { ...t, b, add, me: t.ctx.db.select().from(users).where(eq(users.username, 'admin')).get()!.id };
  }

  it('deletes a user, revokes their credentials and clears what names them', async () => {
    const t = await withVictim();
    const id = await t.add('gone');
    const victim = await t.client();
    await victim.post('/auth/login', { username: 'gone', password: PASSWORD });
    expect((await victim.get('/api/instances')).status).toBe(200);

    const inst = await t.ctx.instances.create({ pluginId: 'echo', slug: 'echo', connection: {} });
    await t.b.post(`/api/instances/${inst.id}/sync`);
    const [opRow] = t.ctx.db.select().from(operations).where(eq(operations.instanceId, inst.id)).all();
    const [group] = t.ctx.db.select().from(operationGroups).where(eq(operationGroups.instanceId, inst.id)).all();
    t.ctx.db.update(operations).set({ acknowledgedBy: id }).where(eq(operations.id, opRow!.id)).run();
    t.ctx.db.update(operationGroups).set({ levelChangedBy: id }).where(eq(operationGroups.id, group!.id)).run();
    t.ctx.db
      .insert(userLevels)
      .values({ id: 'level', userId: id, instanceId: inst.id, groupId: group!.id, level: 'read' })
      .run();
    const rule = (ownerUserId: string | null, ruleId: string) =>
      t.ctx.db
        .insert(preApprovalRules)
        .values({ id: ruleId, instanceId: inst.id, operationId: opRow!.id, reason: 'r', createdBy: id, ownerUserId })
        .run();
    rule(id, 'personal');
    rule(null, 'shared');
    const token = t.ctx.tokens.create({ name: 'gone-token', scope: ['*'] }, { userId: id });
    const grants = vi.spyOn(t.ctx.oauth, 'revokeUserGrants');
    const approval = (ownerUserId: string) =>
      t.ctx.approvals.request({
        instanceId: inst.id,
        operationId: opRow!.id,
        operationKey: opRow!.key,
        classification: 'write',
        paramsDisplay: {},
        paramsHash: 'h',
        resolvedTargets: [],
        summary: 's',
        client: { kind: 'token' },
        ownerUserId,
        timeoutMs: 60_000,
        prompts: { url: () => new Promise(() => {}) },
        formApprovals: false,
      });
    const mine = approval(id);
    const theirs = approval(t.me);

    expect((await t.b.del(`/api/users/${id}`)).status).toBe(204);
    expect(await mine.decision).toMatchObject({ outcome: 'cancelled', reason: 'user_deleted' });
    expect(t.ctx.approvals.cancel(theirs.id, 'test')).toBe(true);
    expect((await victim.get('/api/instances')).status).toBe(401);
    expect(t.ctx.tokens.verify(token.token)).toBeNull();
    expect(grants).toHaveBeenCalledWith(id, 'user_deleted', { userId: t.me });

    const db = t.ctx.db;
    expect(db.select().from(users).where(eq(users.id, id)).get()).toBeUndefined();
    expect(db.select().from(userLevels).where(eq(userLevels.userId, id)).all()).toEqual([]);
    expect(db.select().from(operations).where(eq(operations.id, opRow!.id)).get()).toMatchObject({
      acknowledgedBy: null,
    });
    expect(db.select().from(operationGroups).where(eq(operationGroups.id, group!.id)).get()).toMatchObject({
      levelChangedBy: null,
    });
    // The personal rule goes: a null owner would make it an admin rule for every caller.
    expect(db.select().from(preApprovalRules).all()).toEqual([
      expect.objectContaining({ id: 'shared', createdBy: null, ownerUserId: null }),
    ]);
    expect(db.select().from(mcpTokens).where(eq(mcpTokens.id, token.id)).get()).toMatchObject({ createdBy: null });
    expect(db.select().from(pendingApprovals).where(eq(pendingApprovals.id, mine.id)).get()).toMatchObject({
      status: 'cancelled',
      ownerUserId: null,
    });
    expect(await (await t.b.get('/api/users')).json()).toEqual([expect.objectContaining({ username: 'admin' })]);

    type Row = { decision: string; actorName: string | null; detail: unknown };
    const audit = async (q: string) => ((await (await t.b.get(`/api/audit?${q}`)).json()) as { rows: Row[] }).rows;
    expect(await audit('decision=user_deleted')).toEqual([
      expect.objectContaining({
        actorName: 'admin',
        detail: { userId: id, username: 'gone', registeredVia: null },
      }),
    ]);
    const byGone = await audit('actor=GONE');
    expect(byGone.map((r) => r.decision).sort()).toEqual(['login', 'mcp_token_created']);
    expect(byGone.every((r) => r.actorName === 'gone')).toBe(true);
    const csv = await (await t.b.get('/api/audit/export.csv?decision=mcp_token_created')).text();
    expect(csv).toContain(`,user,${id},gone,`);
  });

  it('ends the session grants the user approved, so a new user with the name gets none', async () => {
    const t = await withVictim();
    const grant = (createdBy: string, principal: string) =>
      t.ctx.grants.create({
        instanceId: 'i1',
        principal,
        createdBy,
        approvalId: 'a1',
        expiresAt: new Date(Date.now() + 3_600_000),
      });
    const bob = await t.add('bob');
    grant('bob', 'external:bob');
    grant('admin', 'external:admin');
    expect((await t.b.patch(`/api/users/${bob}`, { disabled: true })).status).toBe(200);
    expect(t.ctx.grants.active('i1', 'external:bob')).toBeUndefined();

    grant('bob', 'external:bob');
    writeAudit(t.ctx.db, { kind: 'config', decision: 'probe', actorKind: 'user', actorId: bob });
    expect((await t.b.del(`/api/users/${bob}`)).status).toBe(204);
    const again = await t.add('bob');
    expect(t.ctx.grants.active('i1', 'external:bob')).toBeUndefined();
    expect(t.ctx.grants.active('i1', 'external:admin')).toBeDefined();

    // Audit rows of the deleted bob and the new bob stay apart.
    type Row = { actorId: string; actorName: string; actorDeleted: boolean };
    const rows = ((await (await t.b.get('/api/audit?actor=bob')).json()) as { rows: Row[] }).rows;
    const by = (id: string) => [
      ...new Set(rows.filter((r) => r.actorId === id).map((r) => [r.actorName, r.actorDeleted].join())),
    ];
    expect(by(bob)).toEqual(['bob,true']);
    expect(by(again)).toEqual([]);
    writeAudit(t.ctx.db, { kind: 'config', decision: 'probe', actorKind: 'user', actorId: again });
    const now = ((await (await t.b.get('/api/audit?actor=bob')).json()) as { rows: Row[] }).rows;
    expect(now.filter((r) => r.actorId === again).map((r) => r.actorDeleted)).toEqual([false]);
    expect(now.filter((r) => r.actorId === bob).map((r) => r.actorDeleted)).toEqual([true]);
    const csv = await (await t.b.get('/api/audit/export.csv?decision=probe')).text();
    expect(csv.split('\n')[0]).toContain(',actorName,actorDeleted,');
    expect(csv).toContain(`,user,${again},bob,false,`);
    expect(csv).toContain(`,user,${bob},bob,true,`);
  });

  it('refuses a direct delete while the user still owns a live approval', async () => {
    const t = await withVictim();
    const id = await t.add('gone');
    const inst = await t.ctx.instances.create({ pluginId: 'echo', slug: 'echo', connection: {} });
    await t.b.post(`/api/instances/${inst.id}/sync`);
    const [opRow] = t.ctx.db.select().from(operations).where(eq(operations.instanceId, inst.id)).all();
    const live = t.ctx.approvals.request({
      instanceId: inst.id,
      operationId: opRow!.id,
      operationKey: opRow!.key,
      classification: 'write',
      paramsDisplay: {},
      paramsHash: 'h',
      resolvedTargets: [],
      summary: 's',
      client: { kind: 'token' },
      ownerUserId: id,
      timeoutMs: 60_000,
      prompts: { url: () => new Promise(() => {}) },
      formApprovals: false,
    });
    expect(() => t.ctx.users.delete(id)).toThrow(expect.objectContaining({ code: 'approvals_pending' }));
    expect(t.ctx.users.get(id)).toMatchObject({ username: 'gone' });
    expect(t.ctx.approvals.cancel(live.id, 'test')).toBe(true);
    t.ctx.users.delete(id);
    expect(t.ctx.db.select().from(pendingApprovals).where(eq(pendingApprovals.id, live.id)).get()).toMatchObject({
      ownerUserId: null,
    });
  });

  it('refuses to delete yourself, the last admin, the last user or the last SSO user', async () => {
    const t = await withVictim();
    const refused = async (id: string, error: string) =>
      expect(await (await t.b.del(`/api/users/${id}`)).json()).toMatchObject({ error });
    await refused(t.me, 'self_delete');
    expect((await t.b.del('/api/users/nobody')).status).toBe(404);
    expect(() => t.ctx.users.assertDeletable(t.me)).toThrow(expect.objectContaining({ code: 'last_user' }));

    const viewer = await t.add('viewer', t.ctx.roles.create({ name: 'Viewer' }).id);
    expect(() => t.ctx.users.delete(t.me)).toThrow(expect.objectContaining({ code: 'last_admin' }));

    const sso = await t.add('sso');
    t.ctx.db
      .update(users)
      .set({ oidcIssuer: 'https://idp.example.com', oidcSubject: 'sub-1' })
      .where(eq(users.id, sso))
      .run();
    updateSettings(t.ctx.db, 'security', { disableLocalLogin: true });
    await refused(sso, 'local_login_disabled');
    expect((await t.b.del(`/api/users/${viewer}`)).status).toBe(204);
    expect(t.ctx.users.get(sso)).toMatchObject({ oidcSubject: 'sub-1' });
  });
});

describe('audit log', () => {
  it('names user actors, filters by username and exports the name', async () => {
    const t = await setup();
    const b = await signedIn(t);
    const admin = t.ctx.db.select().from(users).where(eq(users.username, 'admin')).get()!;
    writeAudit(t.ctx.db, { kind: 'config', decision: 'probe_user', actorKind: 'user', actorId: admin.id });
    writeAudit(t.ctx.db, { kind: 'call', decision: 'probe_client', actorKind: 'mcp_client', actorId: admin.id });
    writeAudit(t.ctx.db, { kind: 'config', decision: 'probe_system', actorKind: 'system', actorId: 'admin' });
    writeAudit(t.ctx.db, { kind: 'config', decision: 'probe_gone', actorKind: 'user', actorId: 'deleted-user' });

    type Row = { decision: string; actorId: string | null; actorName: string | null };
    const list = async (query: string) =>
      ((await (await b.get(`/api/audit?decision=probe_${query}`)).json()) as { rows: Row[] }).rows;
    const byDecision = Object.fromEntries((await list('')).map((r) => [r.decision, r.actorName]));
    expect(byDecision).toEqual({ probe_user: 'admin', probe_client: null, probe_system: null, probe_gone: null });

    const decisions = async (actor: string) => (await list(`&actor=${actor}`)).map((r) => r.decision).sort();
    expect(await decisions('ADMIN')).toEqual(['probe_user']);
    expect(await decisions('admin')).toEqual(['probe_system', 'probe_user']);
    expect(await decisions(admin.id)).toEqual(['probe_client', 'probe_user']);
    expect(await decisions('deleted-user')).toEqual(['probe_gone']);

    const csv = (await (await b.get('/api/audit/export.csv?decision=probe_user')).text()).split('\n');
    expect(csv[0]).toContain(',actorKind,actorId,actorName,actorDeleted,decidedBy,');
    expect(csv[1]).toContain(`,user,${admin.id},admin,`);
  });
});

describe('approval browsers and session grants', () => {
  it('lists and signs out approval browsers, and lists and revokes session grants', async () => {
    const t = await setup();
    const b = await signedIn(t);
    const admin = t.ctx.db.select().from(users).get()!;
    t.ctx.sessions.create(admin.id, 'approval_ui', { idleMs: 60_000, absoluteMs: 60_000 }, { userAgent: 'Firefox' });
    expect(await (await b.get('/api/profile/approval-sessions')).json()).toEqual([
      expect.objectContaining({ userAgent: 'Firefox' }),
    ]);
    expect(await (await b.post('/api/profile/approval-sessions/revoke', {})).json()).toEqual({ revoked: 1 });
    expect(await (await b.get('/api/profile/approval-sessions')).json()).toEqual([]);
    // The admin session itself stays.
    expect((await b.get('/api/profile')).status).toBe(200);
    // A TOTP reset signs approval browsers out: their proof was made with the old authenticator.
    t.ctx.sessions.create(admin.id, 'approval_ui', { idleMs: 60_000, absoluteMs: 60_000 });
    expect((await b.post(`/api/users/${admin.id}/reset-totp`, {})).status).toBe(200);
    expect(t.ctx.sessions.listKind(admin.id, 'approval_ui')).toEqual([]);

    const instance = await t.ctx.instances.create({ pluginId: 'echo', slug: 'echo', connection: {} });
    const grant = t.ctx.grants.create({
      instanceId: instance.id,
      principal: 'token:x',
      client: 'token:Chat',
      createdBy: 'admin',
      approvalId: 'a1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await (await b.get(`/api/instances/${instance.id}/session-grants`)).json()).toEqual([
      expect.objectContaining({ id: grant.id, client: 'token:Chat', createdBy: 'admin' }),
    ]);
    expect((await b.del(`/api/instances/${instance.id}/session-grants/${grant.id}`)).status).toBe(204);
    expect((await b.del(`/api/instances/${instance.id}/session-grants/${grant.id}`)).status).toBe(404);
    expect(t.ctx.grants.list()).toEqual([]);
  });
});

describe('instances and access', () => {
  it('redacts registry attributes in the picker (review L12)', async () => {
    const t = await setup();
    const b = await signedIn(t);
    const inst = await t.ctx.instances.create({
      pluginId: 'echo',
      slug: 'echo',
      connection: { token: 'upstream-token-5678' },
    });
    applyRegistrySync(t.ctx.db, inst.id, [
      {
        kind: 'entity',
        id: 'widget.door',
        name: 'Door',
        attrs: { access_token: 'img-abc', image_url: '/api/image?token=upstream-token-5678', fps: 5 },
      },
    ]);
    const body = JSON.stringify(await (await b.get(`/api/instances/${inst.id}/registry?kind=entity`)).json());
    expect(body).toContain('widget.door');
    expect(body).not.toContain('img-abc');
    expect(body).not.toContain('upstream-token-5678');
    expect(body).toContain('"fps":5');
  });

  async function withInstance() {
    const t = await setup();
    const b = await signedIn(t);
    const res = await b.post('/api/instances', {
      pluginId: 'echo',
      slug: 'echo',
      connection: { token: 'a-long-secret-token-9876' },
    });
    expect(res.status).toBe(201);
    const inst = (await res.json()) as { id: string; status: string };
    expect(inst.status).toBe('ready');
    return { ...t, b, id: inst.id };
  }

  it('manages connection settings without ever returning secrets', async () => {
    const t = await withInstance();
    const conn = await (await t.b.get(`/api/instances/${t.id}/connection`)).json();
    expect(conn).toMatchObject({ config: {}, secrets: { token: { set: true, hint: '…9876' } } });
    expect(JSON.stringify(conn)).not.toContain('a-long-secret');
    expect((await t.b.put(`/api/instances/${t.id}/connection`, { config: { mode: 5 } })).status).toBe(400);
    expect(await (await t.b.post(`/api/instances/${t.id}/connection/test`)).json()).toMatchObject({ ok: true });
    // Malformed JSON is the client's error, not a 500 (review L19).
    const cookie = [...t.b.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const bad = await t.app.request(`/api/instances/${t.id}/connection/test`, {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': t.b.jar.get('syn_csrf')!, 'content-type': 'application/json' },
      body: '{"config": ',
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_json' });
    expect(
      await (await t.b.post(`/api/instances/${t.id}/connection/test`, { config: { mode: 'fail-init' } })).json(),
    ).toMatchObject({ ok: false });

    // Pointing the connection somewhere else never takes the stored secret along.
    const moved = await t.b.post(`/api/instances/${t.id}/connection/test`, {
      config: { url: 'https://attacker.example' },
    });
    expect(moved.status).toBe(400);
    expect(await moved.json()).toMatchObject({ error: 'secrets_required', details: ['token'] });
    expect(
      (await t.b.put(`/api/instances/${t.id}/connection`, { config: { url: 'https://attacker.example' } })).status,
    ).toBe(400);
    expect(
      await (
        await t.b.post(`/api/instances/${t.id}/connection/test`, {
          config: { url: 'https://nas.example' },
          secrets: { token: 'a-fresh-secret-value' },
        })
      ).json(),
    ).toMatchObject({ ok: true });
  });

  it('syncs, shows groups with reasons, and enforces write acknowledgement', async () => {
    const t = await withInstance();
    expect(await (await t.b.post(`/api/instances/${t.id}/sync`)).json()).toMatchObject({ added: 6 });
    expect(await (await t.b.get(`/api/instances/${t.id}/groups`)).json()).toMatchObject([
      { key: 'echo', level: 'ask', counts: { read: 1, write: 3, locked: 2, pendingReview: 0 } },
    ]);
    // At Read, the group's writes are simply off: there is no "write at level Read".
    expect((await t.b.patch(`/api/instances/${t.id}/groups/echo`, { level: 'read' })).status).toBe(200);
    const ops = (await (await t.b.get(`/api/instances/${t.id}/operations?reason=level_none`)).json()) as {
      key: string;
      level: string;
    }[];
    expect(ops.map((o) => [o.key, o.level])).toEqual([
      ['echo.confirm', 'none'],
      ['echo.guided', 'none'],
      ['echo.set', 'none'],
    ]);

    // Write needs no acknowledgement list or typed slug: it acknowledges the writes it lets run.
    const ok = await t.b.patch(`/api/instances/${t.id}/groups/echo`, { level: 'write' });
    expect(await ok.json()).toMatchObject({ level: 'write', counts: { pendingReview: 0 } });
    expect((await t.b.get(`/api/instances/${t.id}/groups/bulk-level/preview?level=write`)).status).toBe(404);
    const bulk = await t.b.post(`/api/instances/${t.id}/groups/bulk-level`, { level: 'write' });
    expect(bulk.status).toBe(200);
    expect(await bulk.json()).toEqual([{ key: 'echo', label: 'echo', from: 'write' }]);
  });

  it('rejects rules on locked operations and unknown match fields, and flags inert rules', async () => {
    const t = await withInstance();
    await t.b.post(`/api/instances/${t.id}/sync`);
    await t.b.patch(`/api/instances/${t.id}/groups/echo`, { level: 'read' });
    const ops = (await (await t.b.get(`/api/instances/${t.id}/operations`)).json()) as { id: string; key: string }[];
    const opId = (k: string) => ops.find((o) => o.key === k)!.id;

    expect(
      (await t.b.post(`/api/instances/${t.id}/rules`, { operationId: opId('echo.delete'), reason: 'nope' })).status,
    ).toBe(409);
    expect((await t.b.post(`/api/instances/${t.id}/rules`, { operationId: opId('echo.set') })).status).toBe(400); // reason required
    const badField = await t.b.post(`/api/instances/${t.id}/rules`, {
      operationId: opId('echo.set'),
      reason: 'media',
      match: [{ field: '/other', op: 'prefix', value: 'x' }],
    });
    expect(await badField.json()).toMatchObject({ error: 'unknown_match_field' });

    const created = await t.b.post(`/api/instances/${t.id}/rules`, {
      operationId: opId('echo.set'),
      reason: 'media volumes',
      match: [{ field: '/name', op: 'prefix', value: 'vol/media/' }],
      rateLimit: 10,
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ windowSeconds: 3600, inert: 'level_none' });
    const [rule] = (await (await t.b.get(`/api/instances/${t.id}/rules`)).json()) as { id: string }[];
    expect(
      await (await t.b.patch(`/api/instances/${t.id}/rules/${rule!.id}`, { enabled: false })).json(),
    ).toMatchObject({ enabled: false, inert: null });
    expect((await t.b.del(`/api/instances/${t.id}/rules/${rule!.id}`)).status).toBe(204);
  });

  it('sets per-operation levels, keeps locked ops off Write, and has no portal approval inbox', async () => {
    const t = await withInstance();
    await t.b.post(`/api/instances/${t.id}/sync`);
    type Op = {
      id: string;
      key: string;
      level: string;
      levelOverride: string | null;
      mode: string | null;
      allowedLevels: string[];
      description: string | null;
    };
    const list = async () => (await (await t.b.get(`/api/instances/${t.id}/operations`)).json()) as Op[];
    const opId = async (k: string) => (await list()).find((o) => o.key === k)!.id;
    const patch = async (key: string, body: unknown) =>
      t.b.patch(`/api/instances/${t.id}/operations/${await opId(key)}`, body);

    expect((await patch('echo.delete', { level: 'write' })).status).toBe(409);
    expect(await (await patch('echo.delete', { level: 'ask' })).json()).toMatchObject({ levelOverride: 'ask' });
    expect(await (await patch('echo.set', { level: 'write' })).json()).toMatchObject({
      levelOverride: 'write',
      writeAcknowledged: true,
    });
    expect((await patch('echo.set', { level: 'admin' })).status).toBe(400);
    // Each kind only takes the levels that mean something for it.
    expect(await (await patch('echo.query', { level: 'write' })).json()).toMatchObject({
      error: 'invalid_level_for_operation',
    });
    expect((await patch('echo.set', { level: 'read' })).status).toBe(400);
    const byKey = Object.fromEntries((await list()).map((o) => [o.key, o]));
    expect(byKey['echo.delete']).toMatchObject({ level: 'ask', mode: 'approve', allowedLevels: ['none', 'ask'] });
    expect(byKey['echo.set']).toMatchObject({ level: 'write', mode: 'auto', allowedLevels: ['none', 'ask', 'write'] });
    expect(byKey['echo.guided']).toMatchObject({ level: 'ask', levelOverride: null, mode: 'approve' });
    expect(byKey['echo.query']).toMatchObject({
      level: 'read',
      allowedLevels: ['none', 'read', 'ask'],
      description: 'Echoes the query back.',
    });
    expect(byKey['echo.set']?.description).toBeNull();

    expect(await (await patch('echo.set', { level: null })).json()).toMatchObject({ levelOverride: null });
    const group = ((await (await t.b.get(`/api/instances/${t.id}/groups`)).json()) as { counts: object }[])[0];
    expect(group?.counts).toMatchObject({ overridden: 1 });

    // Approvals are decided only on the approval page the MCP client opens.
    expect((await t.b.get('/api/approvals')).status).toBe(404);
    const overview = (await (await t.b.get('/api/overview')).json()) as Record<string, unknown>;
    expect(overview).not.toHaveProperty('pendingApprovals');
    expect(overview.version).toBe(CORE_VERSION);

    const csv = await (await t.b.get('/api/audit/export.csv?kind=config')).text();
    expect(csv.split('\n')[0]).toMatch(/^id,at,kind,/);
    expect(csv).toContain('operation_updated');
  });

  it('sets an endpoint’s client auth methods and shows the effective ones', async () => {
    const t = await withInstance();
    const patch = (authMethods: unknown) => t.b.patch(`/api/instances/${t.id}`, { authMethods });
    expect((await patch(['bearer', 'telepathy'])).status).toBe(400);
    expect(await (await patch(['oauth', 'bearer', 'oauth'])).json()).toMatchObject({
      authMethods: ['bearer', 'oauth'],
    });
    const effective = async () =>
      ((await (await t.b.get('/api/overview')).json()) as { instances: { effectiveAuthMethods: string[] }[] })
        .instances[0]?.effectiveAuthMethods;
    expect(await effective()).toEqual(['bearer', 'oauth']);
    expect((await t.b.put('/api/settings/mcp', { clientAuth: { bearer: false, oauth: true } })).status).toBe(200);
    expect(await effective()).toEqual(['oauth']);
    expect(await (await patch([])).json()).toMatchObject({ authMethods: [] });
    expect(await effective()).toEqual([]);
    expect(await (await patch(null)).json()).toMatchObject({ authMethods: null });
    expect(await effective()).toEqual(['oauth']);
    // A client that still sends the retired auth mode is refused, not ignored.
    expect((await t.b.patch(`/api/instances/${t.id}`, { authMode: 'bearer' })).status).toBe(400);
    expect(
      (await t.b.post('/api/instances', { pluginId: 'echo', slug: 'echo-2', connection: {}, authMode: 'bearer' }))
        .status,
    ).toBe(400);
  });

  it('refuses client auth settings with no method, or external auth without its provider', async () => {
    const t = await setup();
    const b = await signedIn(t);
    const put = (body: unknown) => b.put('/api/settings/mcp', body);
    const none = await put({ clientAuth: { bearer: false, oauth: false, external: false } });
    expect(none.status).toBe(400);
    expect(await none.json()).toMatchObject({ error: 'invalid_settings' });
    expect((await put({ clientAuth: { external: true } })).status).toBe(400);
    expect(
      (await put({ clientAuth: { external: true }, cfAccess: { teamDomain: 'team.example', aud: '' } })).status,
    ).toBe(400);
    expect((await put({ external: { provider: 'other' } })).status).toBe(400);
    const ok = await put({ clientAuth: { external: true }, cfAccess: { teamDomain: 'team.example', aud: 'tag' } });
    expect(await ok.json()).toMatchObject({
      clientAuth: { bearer: true, oauth: true, external: true },
      external: { provider: 'cloudflare' },
    });
    // The provider can't lose its configuration while external auth is on.
    expect((await put({ cfAccess: { teamDomain: '', aud: '' } })).status).toBe(400);
    // A partial save keeps the methods and provider fields it leaves out.
    expect((await put({ clientAuth: { bearer: false } })).status).toBe(200);
    const partial = await put({ clientAuth: { external: true }, cfAccess: { aud: 'tag-2' } });
    expect(await partial.json()).toMatchObject({
      clientAuth: { bearer: false, oauth: true, external: true },
      cfAccess: { teamDomain: 'team.example', aud: 'tag-2' },
    });
    for (const retired of [{ defaultAuthMode: 'bearer' }, { trustedIdentityHeader: 'remote-user' }])
      expect(await (await put(retired)).json()).toMatchObject({ error: 'invalid_settings' });
  });

  it('issues MCP bearer tokens once and never lists their value', async () => {
    const t = await withInstance();
    const created = (await (await t.b.post('/api/tokens', { name: 'claude code', scope: [t.id] })).json()) as {
      id: string;
      token: string;
    };
    expect(created.token).toMatch(/^syn_/);
    const listed = await (await t.b.get('/api/tokens')).text();
    expect(listed).not.toContain(created.token);
    expect(t.ctx.tokens.verify(created.token)?.id).toBe(created.id);
    expect((await t.b.post('/api/tokens', { name: 'x', scope: ['not-an-instance'] })).status).toBe(400);
    expect((await t.b.del(`/api/tokens/${created.id}`)).status).toBe(204);
    expect(t.ctx.tokens.verify(created.token)).toBeNull();
  });

  it('deletes an endpoint only with the typed slug', async () => {
    const t = await withInstance();
    expect((await t.b.del(`/api/instances/${t.id}`, { confirm: 'nope' })).status).toBe(409);
    expect((await t.b.del(`/api/instances/${t.id}`, { confirm: 'echo' })).status).toBe(204);
    expect(await (await t.b.get('/api/instances')).json()).toEqual([]);
  });

  it('streams live events over SSE', async () => {
    const t = await withInstance();
    const res = await t.b.get('/api/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    t.ctx.events.emit('sync.failed', { instanceId: t.id, slug: 'echo', error: 'boom' });
    let text = '';
    while (!text.includes('sync.failed')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('"error":"boom"');
    await reader.cancel();
  });
});
