import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { JWTVerifyGetKey } from 'jose';
import { checkCloudflareAccess } from '../src/auth/external-cloudflare.js';

/** Cloudflare Access assertions (design §6.2 `external` method). */
describe('checkCloudflareAccess', () => {
  const TEAM = 'home.cloudflareaccess.com';
  const AUD = 'aud-tag-123';

  async function team() {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const keys = createLocalJWKSet({ keys: [jwk] });
    const sign = (
      claims: Record<string, unknown>,
      opts: { iss?: string; aud?: string; exp?: string | null; iat?: boolean } = {},
    ) => {
      const jwt = new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(opts.iss ?? `https://${TEAM}`)
        .setAudience(opts.aud ?? AUD);
      if (opts.iat !== false) jwt.setIssuedAt();
      if (opts.exp !== null) jwt.setExpirationTime(opts.exp ?? '5m');
      return jwt.sign(privateKey);
    };
    return { keys, sign };
  }

  const who = async (teamDomain: string, assertion: string, keys: JWTVerifyGetKey) => {
    const result = await checkCloudflareAccess(teamDomain, AUD, assertion, keys);
    return result.ok ? result.identity : null;
  };

  it('accepts a valid user assertion and returns its email', async () => {
    const { keys, sign } = await team();
    await expect(who(TEAM, await sign({ sub: 'u-1', email: 'me@example.com' }), keys)).resolves.toBe('me@example.com');
    await expect(who(`https://${TEAM}/`, await sign({ sub: 'u-1', email: 'me@example.com' }), keys)).resolves.toBe(
      'me@example.com',
    );
  });

  it('refuses a service token assertion: it names no user', async () => {
    const { keys, sign } = await team();
    const service = await checkCloudflareAccess(TEAM, AUD, await sign({ sub: '', common_name: 'abc.access' }), keys);
    expect(service).toEqual({ ok: false, reason: expect.stringContaining('service token') });
    await expect(
      who(TEAM, await sign({ sub: 'u-1', email: 'a@b.c', common_name: 'abc.access' }), keys),
    ).resolves.toBeNull();
  });

  it('refuses an assertion without a user email', async () => {
    const { keys, sign } = await team();
    for (const claims of [{}, { sub: '' }, { email: '' }, { sub: 'u-1' }, { sub: 'u-1', email: 'service:abc' }])
      await expect(who(TEAM, await sign(claims), keys)).resolves.toBeNull();
  });

  it('rejects a wrong audience, a wrong issuer, an expired token, another key and garbage', async () => {
    const { keys, sign } = await team();
    const other = await team();
    const cases = [
      await sign({ email: 'a@b.c' }, { aud: 'someone-elses-app' }),
      await sign({ email: 'a@b.c' }, { iss: 'https://evil.cloudflareaccess.com' }),
      await sign({ email: 'a@b.c' }, { exp: '-1m' }),
      await other.sign({ email: 'a@b.c' }),
      'not-a-jwt',
    ];
    for (const assertion of cases) await expect(who(TEAM, assertion, keys)).resolves.toBeNull();
  });

  it('refuses an assertion without an expiry or an issue time', async () => {
    const { keys, sign } = await team();
    const user = { sub: 'u-1', email: 'me@example.com' };
    await expect(who(TEAM, await sign(user, { exp: null }), keys)).resolves.toBeNull();
    await expect(who(TEAM, await sign(user, { iat: false }), keys)).resolves.toBeNull();
  });

  it('says which claim did not match, for the server log', async () => {
    const { keys, sign } = await team();
    const wrongAud = await checkCloudflareAccess(TEAM, AUD, await sign({}, { aud: 'someone-elses-app' }), keys);
    expect(wrongAud.ok).toBe(false);
    expect(!wrongAud.ok && wrongAud.reason).toMatch(
      /"aud".*aud=someone-elses-app; expected iss=https:\/\/home\..* aud=aud-tag-123/,
    );
    const hostile = `e30.${Buffer.from(JSON.stringify({ iss: { toString: 1 }, aud: [{}, 'z'.repeat(500)] })).toString('base64url')}.`;
    const odd = await checkCloudflareAccess(TEAM, AUD, hostile, keys);
    expect(odd.ok).toBe(false);
    expect(!odd.ok && odd.reason).toMatch(/iss=- aud=z{120}…;/);
    const garbage = await checkCloudflareAccess(TEAM, AUD, 'not-a-jwt', keys);
    expect(!garbage.ok && garbage.reason).toContain('(not a JWT)');
  });
});
