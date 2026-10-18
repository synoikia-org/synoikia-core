import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
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
