import type { JWTVerifyGetKey } from 'jose';
import type { Settings } from '../settings.js';
import { cloudflareAccess } from './external-cloudflare.js';

/** External client auth (design §6.2): a provider in front of the MCP port names the user behind a request.
 * A new provider is one module here and one id in {@link EXTERNAL_PROVIDER_IDS}. */

export const EXTERNAL_PROVIDER_IDS = ['cloudflare'] as const;
export type ExternalProviderId = (typeof EXTERNAL_PROVIDER_IDS)[number];

export type McpSettings = Settings<'mcp'>;

/** The key set of a provider's domain, in place of the one it publishes (tests); undefined fetches it. */
export type ExternalKeys = (domain: string) => JWTVerifyGetKey | undefined;

export type ExternalIdentity = { ok: true; identity: string } | { ok: false; reason: string };

export interface ExternalProvider {
  id: ExternalProviderId;
  /** Shown in logs and messages. */
  name: string;
  /** The settings this provider needs are present. */
  configured(settings: McpSettings): boolean;
  /** The user the request comes from, or why none; `reason` is for the server log only. `keys` replaces the
   * provider's published key set (tests). */
  identify(headers: Headers, settings: McpSettings, keys?: ExternalKeys): Promise<ExternalIdentity>;
}

const PROVIDERS: Record<ExternalProviderId, ExternalProvider> = {
  cloudflare: cloudflareAccess,
};

/** The provider the settings select. */
export function externalProvider(settings: Pick<McpSettings, 'external'>): ExternalProvider {
  return PROVIDERS[settings.external.provider];
}
