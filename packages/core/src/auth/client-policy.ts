import type { Settings } from '../settings.js';

/** MCP client policy (design §6.6): matches the self-declared `clientInfo.name` of `initialize`. */

export type ClientPolicy = Settings<'mcp'>['clientPolicy'];

/** Longest client name or version that core keeps; longer values are clipped. */
export const CLIENT_INFO_MAX = 100;
const SEEN_MAX = 50;

/** Case-insensitive exact match. `allow` also refuses a client without a name. */
export function clientAllowed(policy: ClientPolicy, name: string | undefined): boolean {
  if (policy.mode === 'off') return true;
  const listed = !!name && policy.names.some((n) => n.toLowerCase() === name.toLowerCase());
  return policy.mode === 'allow' ? listed : !listed;
}

export interface SeenClient {
  name: string;
  version: string;
  lastSeen: string;
}

/** The latest client names authenticated callers sent at `initialize`, most recent first; in memory only. */
export class SeenClients {
  private readonly seen = new Map<string, SeenClient>();

  constructor(private readonly now: () => Date) {}

  record(name: string, version = '') {
    const clipped = name.slice(0, CLIENT_INFO_MAX);
    const key = clipped.toLowerCase();
    this.seen.delete(key);
    this.seen.set(key, {
      name: clipped,
      version: version.slice(0, CLIENT_INFO_MAX),
      lastSeen: this.now().toISOString(),
    });
    if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.keys().next().value!);
  }

  list(): SeenClient[] {
    return [...this.seen.values()].reverse();
  }
}
