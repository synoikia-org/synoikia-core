import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { ExternalIdentity, ExternalProvider } from './external.js';

/** Cloudflare Access as an external provider (design §6.2): the `Cf-Access-Jwt-Assertion` of a user. */

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** The team domain without the scheme or a trailing slash an admin may have written. */
const domainOf = (teamDomain: string) => teamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');

const MAX_CLAIM = 120;
const clip = (v: string) => (v.length > MAX_CLAIM ? `${v.slice(0, MAX_CLAIM)}…` : v);

/** A JWT's claimed issuer and audience, unverified, only to explain a rejection: strings only, clipped. */
export function claimedIssuer(token: string): { iss?: string; aud?: string } | null {
  let payload: Record<string, unknown>;
  try {
    payload = decodeJwt(token);
  } catch {
    return null;
  }
  const { iss, aud } = payload;
  const auds = (Array.isArray(aud) ? aud : [aud]).filter((a): a is string => typeof a === 'string');
  return {
    iss: typeof iss === 'string' ? clip(iss) : undefined,
    aud: auds.length ? clip(auds.join(',')) : undefined,
  };
}

/** Verifies a `Cf-Access-Jwt-Assertion` (signature, issuer, audience, expiry) and returns the user's email
 * or why it was rejected. `keys` replaces the team's key set (tests). */
export async function checkCloudflareAccess(
  teamDomain: string,
  aud: string,
  assertion: string,
  keys?: JWTVerifyGetKey,
): Promise<ExternalIdentity> {
  const domain = domainOf(teamDomain);
  let jwks = keys ?? jwksCache.get(domain);
  if (!jwks) {
    const remote = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`));
    jwksCache.set(domain, remote);
    jwks = remote;
  }
  const issuer = `https://${domain}`;
  try {
    const { payload } = await jwtVerify(assertion, jwks, {
      issuer,
      audience: aud,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat'],
    });
    // A service token's assertion has an empty `sub` and names the token's client ID in `common_name`:
    // it is no user, so it is refused (design §6.2).
    if (payload.common_name !== undefined || !payload.sub)
      return { ok: false, reason: 'service token assertion: only user identities are accepted' };
    const email = typeof payload.email === 'string' ? payload.email : '';
    return email.includes('@')
      ? { ok: true, identity: email }
      : { ok: false, reason: 'valid assertion without a user email' };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    const claimed = claimedIssuer(assertion);
    if (!claimed) return { ok: false, reason: `${why} (not a JWT)` };
    // The AUD tag and team domain are not secrets: every assertion Access issues carries them.
    return {
      ok: false,
      reason: `${why} (assertion iss=${claimed.iss ?? '-'} aud=${claimed.aud ?? '-'}; expected iss=${issuer} aud=${aud})`,
    };
  }
}

export const cloudflareAccess: ExternalProvider = {
  id: 'cloudflare',
  name: 'Cloudflare Access',
  configured: (settings) => !!settings.cfAccess.teamDomain && !!settings.cfAccess.aud,
  async identify(headers, settings, keys) {
    const assertion = headers.get('cf-access-jwt-assertion');
    if (!assertion)
      return {
        ok: false,
        reason: 'no Cf-Access-Jwt-Assertion header: the request did not come through the Cloudflare Access application',
      };
    const checked = await checkCloudflareAccess(
      settings.cfAccess.teamDomain,
      settings.cfAccess.aud,
      assertion,
      keys?.(domainOf(settings.cfAccess.teamDomain)),
    );
    return checked.ok ? checked : { ok: false, reason: `Cloudflare Access assertion rejected: ${checked.reason}` };
  },
};
