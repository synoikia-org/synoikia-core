import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app.js';
import { roleHasInstance } from '../catalog/role-levels.js';
import { users } from '../db/schema.js';
import { ConflictError, ValidationError } from '../errors.js';
import { getSettings } from '../settings.js';
import { McpTokenService, TOKEN_PREFIX } from './mcp-tokens.js';
import { ACCESS_PREFIX, canonicalResource } from './oauth.js';
import type { OAuthService } from './oauth.js';
import type { AccessCeiling } from '../gate/access.js';
import { effectiveAuthMethods } from '../instances/manager.js';
import { externalProvider } from './external.js';
import { claimedIssuer } from './external-cloudflare.js';
import { requestOrigin } from '../http/common.js';

/** Authentication for `/{slug}` (design §6.2): the endpoint's client auth methods narrowed to the enabled
 * ones; every accepted request yields an identity recorded on each audited call. */

export interface McpIdentity {
  kind: 'token' | 'oauth' | 'external';
  /** Stable principal for session binding: a token id, `grant:<id>`, or the external identity. */
  principal: string;
  /** Human-readable, shown in audit and approvals: `token:Claude Code`, `oauth:Claude for admin`. */
  label: string;
  /** Ceiling on what this principal can reach (design §6.3): from OAuth consent or the bearer token;
   * `external` is not limited here. */
  access: AccessCeiling;
  /** The user who owns the credential, or whom the external provider named; their role decides the reach (§6.4). */
  userId: string;
  roleId: string;
}

export type McpAuthResult =
  | { ok: true; identity: McpIdentity }
  | {
      ok: false;
      status: 401 | 403;
      error: string;
      message: string;
      wwwAuthenticate?: string;
      /** Why, in enough detail to fix a client or proxy. For the server log only, never the client. */
      detail: string;
    };

/** The MCP listener's public origin: PUBLIC_MCP_URL, or the request's origin where no security decision
 * depends on it (the approval link back to the same client, sign-in redirects). */
export function publicMcpBase(ctx: AppContext, c: Context): string {
  return (ctx.config.PUBLIC_MCP_URL ?? requestOrigin(c, ctx.config.TRUST_PROXY)).replace(/\/+$/, '');
}

export const resourceUrl = (base: string, slug: string) => canonicalResource(`${base}/${slug}`);

/** The endpoints that accept OAuth (design §6.2), with their resource URLs under `base`. */
export function oauthEndpoints(ctx: AppContext, base: string) {
  return ctx.instances
    .list()
    .filter((i) => effectiveAuthMethods(ctx.db, i.authMethods).includes('oauth'))
    .map((i) => ({ resource: resourceUrl(base, i.slug), slug: i.slug, name: i.displayName, id: i.id }));
}

/** What kind of bearer token this is, for the log: never any part of its value. */
function describeToken(token: string): string {
  if (token.startsWith(TOKEN_PREFIX)) return 'a Synoikia bearer token';
  if (token.startsWith(ACCESS_PREFIX)) return 'a Synoikia OAuth access token';
  const claimed = claimedIssuer(token);
  if (claimed) return `a JWT from another issuer (iss=${claimed.iss ?? '-'})`;
  return 'a token this server did not issue';
}

type Unowned = Omit<McpIdentity, 'userId' | 'roleId'>;

const refuse = (status: 401 | 403, error: string, message: string, detail: string): McpAuthResult => ({
  ok: false,
  status,
  error,
  message,
  detail,
});

/** The credential's owner must be enabled and their role must have this endpoint (design §6.4). */
function owned(ctx: AppContext, base: Unowned, userId: string | null | undefined, instanceId: string): McpAuthResult {
  const user = userId ? ctx.db.select().from(users).where(eq(users.id, userId)).get() : undefined;
  if (!user || user.disabled)
    return refuse(
      403,
      'forbidden',
      'The account behind this credential is disabled',
      `${base.label}: no enabled owner`,
    );
  if (!roleHasInstance(ctx.db, user.roleId, instanceId))
    return refuse(
      403,
      'insufficient_scope',
      'This endpoint is not available to your role',
      `${base.label}: role of ${user.username} does not include this endpoint`,
    );
  return { ok: true, identity: { ...base, userId: user.id, roleId: user.roleId } };
}

/** A user named by the external provider: matched by username, else registered with the default role (design §6.5). */
async function externalUser(ctx: AppContext, name: string): Promise<string | undefined> {
  const found = ctx.users.byExternalIdentity(name);
  if (found) return found.id;
  if (!ctx.users.registrationOpen()) return undefined;
  try {
    return (await ctx.users.register({ username: name }, 'external')).id;
  } catch (err) {
    // A concurrent first request registered it; a name taken by a self-registered user, or not a valid
    // username, stays unknown.
    if (err instanceof ConflictError) return ctx.users.byExternalIdentity(name)?.id;
    if (err instanceof ValidationError) return undefined;
    throw err;
  }
}

/** The owner is still enabled, in the same role, and the role still has the endpoint (parked runs). */
export function ownerLive(ctx: AppContext, identity: McpIdentity, instanceId: string): boolean {
  const user = ctx.db.select().from(users).where(eq(users.id, identity.userId)).get();
  return (
    !!user && !user.disabled && user.roleId === identity.roleId && roleHasInstance(ctx.db, user.roleId, instanceId)
  );
}

/** Whether the credential behind a principal still reaches the instance; external identities have no
 * credential to revoke. A parked execution checks this on each call (design §5.6). */
export function principalLive(ctx: AppContext, principal: string, instanceId: string): boolean {
  if (principal.startsWith('token:')) return ctx.tokens.liveFor(principal.slice('token:'.length), instanceId);
  if (principal.startsWith('grant:')) return ctx.oauth.grantLiveFor(principal.slice('grant:'.length), instanceId);
  return true;
}

const unknownUser = (base: Unowned) =>
  refuse(
    403,
    'forbidden',
    'No account matches this identity',
    `${base.label}: no user has that username and self-registration is off or the name is not a valid username`,
  );

/** The configured external provider names the caller, who must match an enabled user (design §6.2, §6.5). */
async function authenticateExternal(ctx: AppContext, c: Context, instanceId: string): Promise<McpAuthResult> {
  const settings = getSettings(ctx.db, 'mcp');
  const provider = externalProvider(settings);
  if (!provider.configured(settings))
    return refuse(401, 'unauthorized', 'Authentication required', `${provider.name} is not configured`);
  const found = await provider.identify(c.req.raw.headers, settings, ctx.externalKeys);
  // Every call belongs to a user (design §6.4): a caller the provider didn't name is refused.
  if (!found.ok) return refuse(401, 'unauthorized', `${provider.name} did not identify the caller`, found.reason);
  const who = found.identity;
  const base: Unowned = {
    kind: 'external',
    principal: `${provider.id}:${who}`,
    label: `external:${who}`,
    access: 'write',
  };
  const userId = await externalUser(ctx, who);
  if (!userId) return unknownUser(base);
  return owned(ctx, base, userId, instanceId);
}

export async function authenticateMcp(
  ctx: AppContext,
  oauth: OAuthService,
  c: Context,
  instance: { id: string; slug: string; authMethods: unknown },
): Promise<McpAuthResult> {
  const methods = effectiveAuthMethods(ctx.db, instance.authMethods);
  const auth = c.req.header('authorization');

  if (!methods.length) {
    const detail = 'no client auth method is both enabled globally and allowed on this endpoint';
    const held = auth?.match(/^Bearer\s+(\S+)$/i)?.[1];
    // Only a live credential learns why; anyone else gets the answer of an unknown slug.
    if (held && (ctx.tokens.verify(held) || oauth.verifyAccess(held, '')))
      return refuse(403, 'forbidden', 'This endpoint accepts no client auth method', detail);
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
      message: 'Authentication required',
      wwwAuthenticate: 'Bearer',
      detail,
    };
  }

  const allowBearer = methods.includes('bearer');
  // OAuth is off until PUBLIC_MCP_URL is set: its discovery documents must not come from the Host header.
  const allowOauth = methods.includes('oauth') && !!ctx.config.PUBLIC_MCP_URL;
  const base = publicMcpBase(ctx, c);
  const challenge = (error?: string) => {
    const params: string[] = [];
    if (allowOauth) params.push(`resource_metadata="${base}/.well-known/oauth-protected-resource/${instance.slug}"`);
    if (error) params.push(`error="${error}"`);
    return params.length ? `Bearer ${params.join(', ')}` : 'Bearer';
  };

  // A proxy that authenticated the caller is the usual reason a client sends what these methods can't use.
  const hint =
    c.req.header('cf-access-jwt-assertion') && !methods.includes('external')
      ? '; the request carries a Cloudflare Access assertion: enable External client auth for this endpoint to accept it'
      : '';
  const oauthOff = methods.includes('oauth') && !allowOauth ? '; OAuth is off until PUBLIC_MCP_URL is set' : '';
  const accepted = methods.join(', ');

  const token = auth?.match(/^Bearer\s+(\S+)$/i)?.[1];
  let externalWhy = '';
  if (!token && methods.includes('external')) {
    const result = await authenticateExternal(ctx, c, instance.id);
    // Unnamed, an endpoint that also takes tokens answers with the bearer challenge, so OAuth can start.
    if (result.ok || result.status === 403 || !(allowBearer || methods.includes('oauth'))) return result;
    externalWhy = `; ${result.detail}`;
  }
  if (!token)
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
      message: 'Authentication required',
      wwwAuthenticate: challenge(),
      detail: `${auth ? 'Authorization header is not a bearer token' : 'no Authorization header'}${externalWhy}${oauthOff}${hint}`,
    };

  if (allowBearer && token.startsWith(TOKEN_PREFIX)) {
    const row = ctx.tokens.verify(token);
    if (!row)
      return {
        ok: false,
        status: 401,
        error: 'invalid_token',
        message: 'Invalid or expired token',
        wwwAuthenticate: challenge('invalid_token'),
        detail: 'bearer token is unknown, revoked or expired',
      };
    if (!McpTokenService.inScope(row, instance.id)) {
      return {
        ok: false,
        status: 403,
        error: 'insufficient_scope',
        message: 'This token is not valid for this endpoint',
        detail: `bearer token "${row.name}" is not scoped to this endpoint`,
      };
    }
    return owned(
      ctx,
      { kind: 'token', principal: `token:${row.id}`, label: `token:${row.name}`, access: row.access },
      row.createdBy,
      instance.id,
    );
  }

  if (allowOauth && token.startsWith(ACCESS_PREFIX)) {
    const found = oauth.verifyAccess(token, instance.id);
    if (!found)
      return {
        ok: false,
        status: 401,
        error: 'invalid_token',
        message: 'Invalid or expired token',
        wwwAuthenticate: challenge('invalid_token'),
        detail: 'OAuth access token is unknown, revoked or expired',
      };
    if (!found.inAudience) {
      return {
        ok: false,
        status: 403,
        error: 'insufficient_scope',
        message: 'This token was not granted for this endpoint',
        detail: `OAuth grant of client "${found.client.name}" does not include this endpoint`,
      };
    }
    return owned(
      ctx,
      {
        kind: 'oauth',
        principal: `grant:${found.grantId}`,
        label: `oauth:${found.client.name} (${found.user.username})`,
        access: found.access,
      },
      found.user.id,
      instance.id,
    );
  }

  return {
    ok: false,
    status: 401,
    error: 'invalid_token',
    message: 'This endpoint does not accept that kind of token',
    wwwAuthenticate: challenge('invalid_token'),
    detail: `got ${describeToken(token)}, which this endpoint's methods (${accepted}) do not accept${oauthOff}${hint}`,
  };
}
