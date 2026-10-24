import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { OidcService } from '../src/auth/oidc.js';
import { SessionService } from '../src/auth/sessions.js';
import { currentStep, totpAt } from '../src/auth/totp.js';
import { UserService } from '../src/auth/users.js';
import { SecretBox } from '../src/crypto/index.js';
import { openDatabase } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { ConflictError, ValidationError } from '../src/errors.js';
import { updateSettings } from '../src/settings.js';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function setup() {
  const db = openDatabase(':memory:');
  const box = SecretBox.fromKey(randomBytes(32));
  return { db, box, users: new UserService(db, box) };
}

const PASSWORD = 'correct horse battery';

describe('UserService', () => {
  it('runs first-run setup once and enforces the password policy', async () => {
    const t = setup();
    await expect(t.users.setupFirstUser('admin', 'short')).rejects.toBeInstanceOf(ValidationError);
    const admin = await t.users.setupFirstUser('admin', PASSWORD);
    expect(admin).toMatchObject({ username: 'admin', hasPassword: true, totpEnabled: false, owner: true });
    await expect(t.users.setupFirstUser('other', PASSWORD)).rejects.toBeInstanceOf(ConflictError);
    expect(await t.users.bootstrap('admin', PASSWORD)).toMatchObject({ status: 'owner_kept', changed: [] });
    await expect(t.users.bootstrap('service:x', PASSWORD)).rejects.toMatchObject({ code: 'invalid_username' });
    t.db.update(users).set({ owner: false }).run();
    await expect(t.users.bootstrap('admin', PASSWORD)).rejects.toMatchObject({ code: 'username_taken' });
    expect(await t.users.bootstrap('owner', PASSWORD)).toMatchObject({ status: 'owner_made' });
    expect(t.users.owner()).toMatchObject({ username: 'owner', kind: 'local', roleId: 'admin' });
    const hash = t.db.select().from(users).get()!.passwordHash!;
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  });

  it('changes passwords only with the current one, and keeps one active user', async () => {
    const t = setup();
    const u = await t.users.create({ username: 'admin', password: PASSWORD });
    await expect(t.users.setPassword(u.id, 'another long password', { currentPassword: 'nope' })).rejects.toThrow(
      /incorrect/,
    );
    await t.users.setPassword(u.id, 'another long password', { currentPassword: PASSWORD });
    expect(await t.users.verifyPassword('admin', 'another long password')).not.toBeNull();
    expect(() => t.users.setDisabled(u.id, true)).toThrow(/last active user/);
  });

  it('turns off its own TOTP only with a valid code and while the server does not require it', async () => {
    const t = setup();
    const u = await t.users.create({ username: 'admin', password: PASSWORD });
    const { secret } = t.users.beginTotp(u.id);
    t.users.confirmTotp(u.id, totpAt(secret, currentStep()));
    updateSettings(t.db, 'security', { requireTotp: true });
    expect(() => t.users.disableOwnTotp(t.users.get(u.id), '000000')).toThrow(ConflictError);
    updateSettings(t.db, 'security', { requireTotp: false });
    expect(t.users.disableOwnTotp(t.users.get(u.id), '000000')).toBe(false);
    expect(t.users.get(u.id).totpEnabled).toBe(true);
    expect(t.users.disableOwnTotp(t.users.get(u.id), totpAt(secret, currentStep() + 1))).toBe(true);
    expect(t.users.get(u.id).totpEnabled).toBe(false);
  });
});

describe('SessionService', () => {
  const limits = { idleMs: 30 * 60_000, absoluteMs: 12 * 3600_000 };

  it('stores only a peppered hash and enforces kind, idle and absolute expiry', async () => {
    const t = setup();
    const u = await t.users.create({ username: 'admin', password: PASSWORD });
    let now = new Date('2026-01-01T00:00:00Z');
    const sessions = new SessionService(t.db, randomBytes(32), () => now);
    const raw = sessions.create(u.id, 'admin', limits);
    expect(JSON.stringify(t.db.$client.prepare('select * from sessions').all())).not.toContain(raw);

    expect(sessions.validate(raw, 'admin', limits)?.user.username).toBe('admin');
    expect(sessions.validate(raw, 'oauth_ui', limits)).toBeNull();
    expect(sessions.validate('forged', 'admin', limits)).toBeNull();

    now = new Date(now.getTime() + 20 * 60_000);
    expect(sessions.validate(raw, 'admin', limits)).not.toBeNull(); // touched: idle clock resets
    now = new Date(now.getTime() + 31 * 60_000);
    expect(sessions.validate(raw, 'admin', limits)).toBeNull(); // idle expired and deleted

    const raw2 = sessions.create(u.id, 'admin', { idleMs: limits.idleMs, absoluteMs: 60_000 });
    now = new Date(now.getTime() + 61_000);
    expect(sessions.validate(raw2, 'admin', limits)).toBeNull(); // absolute expiry
  });
});

describe('OidcService', () => {
  async function fakeIdp() {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    const codes = new Map<
      string,
      { nonce: string; sub: string; email: string; groups: string[]; emailVerified?: boolean; redirectUri: string }
    >();
    const app = new Hono();
    let issuer = '';
    app.get('/.well-known/openid-configuration', (c) =>
      c.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      }),
    );
    app.get('/jwks', (c) => c.json({ keys: [jwk] }));
    app.post('/token', async (c) => {
      const form = await c.req.parseBody();
      const grant = codes.get(String(form.code));
      if (!grant || !form.code_verifier) return c.json({ error: 'invalid_grant' }, 400);
      if (form.redirect_uri !== grant.redirectUri)
        return c.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
      const idToken = await new SignJWT({
        nonce: grant.nonce,
        email: grant.email,
        ...(grant.emailVerified === undefined ? {} : { email_verified: grant.emailVerified }),
        groups: grant.groups,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(issuer)
        .setSubject(grant.sub)
        .setAudience('portal')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      return c.json({ access_token: 'at', token_type: 'Bearer', id_token: idToken, expires_in: 300 });
    });
    const server = await new Promise<Server>((resolve) => {
      const s = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve(s as Server));
    });
    cleanup.push(() => new Promise((r) => server.close(r)));
    issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { issuer, codes };
  }

  async function signIn(
    service: OidcService,
    idp: Awaited<ReturnType<typeof fakeIdp>>,
    who: { sub: string; email: string; groups?: string[]; emailVerified?: boolean | null },
  ) {
    const { url, stateToken } = await service.begin({
      purpose: 'admin_login',
      redirectUri: 'https://admin.lan/auth/oidc/callback',
    });
    const params = new URL(url).searchParams;
    expect(params.get('code_challenge_method')).toBe('S256');
    idp.codes.set('code-1', {
      nonce: params.get('nonce')!,
      sub: who.sub,
      email: who.email,
      groups: who.groups ?? [],
      // null: the IdP leaves the claim out; default: it vouches for the address.
      emailVerified: who.emailVerified === null ? undefined : (who.emailVerified ?? true),
      redirectUri: params.get('redirect_uri')!,
    });
    return service.complete(
      `?code=code-1&state=${params.get('state')}&iss=${encodeURIComponent(idp.issuer)}`,
      stateToken,
    );
  }

  it('matches allowed emails exactly or by a whole *@domain entry', async () => {
    const t = setup();
    const idp = await fakeIdp();
    const service = new OidcService(t.db, t.box, randomBytes(32), true);
    const policy = (emails: string[]) => ({ emails, subjects: [], group: '', groupsClaim: 'groups' });
    const save = (emails: string[]) =>
      service.updateSettings({ enabled: true, issuer: idp.issuer, clientId: 'portal', allowPolicy: policy(emails) });
    for (const bad of ['*@', '*.example.com', 'a*@x.com', '*@*', '*@-x.com', '*@x..com', '*@x.com@y.com'])
      expect(() => save([bad]), bad).toThrow(ValidationError);

    save(['Admin@Example.com', '*@Corp.Example']);
    expect(service.getSettings()?.allowPolicy.emails).toEqual(['Admin@Example.com', '*@corp.example']);
    const allowed = (email: string) => service.isAllowed({ issuer: idp.issuer, subject: 's', email, groups: [] });
    expect(allowed('admin@example.COM')).toBe(true);
    expect(allowed('other@example.com')).toBe(false);
    expect(allowed('Anyone@CORP.example')).toBe(true);
    for (const email of ['a@other.example', 'a@sub.corp.example', 'a@corp.example.evil.com', 'corp.example@evil.com'])
      expect(allowed(email), email).toBe(false);

    const unverified = await signIn(service, idp, { sub: 'u-1', email: 'a@corp.example', emailVerified: false });
    expect(service.isAllowed(unverified.identity)).toBe(false);
    const verified = await signIn(service, idp, { sub: 'u-2', email: 'a@corp.example' });
    expect(service.isAllowed(verified.identity)).toBe(true);
  });
});
