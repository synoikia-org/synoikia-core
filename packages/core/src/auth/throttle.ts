/** Brute-force protection (ADR-0008): 5 failures per username per 15 min lock it 15 min, plus a per-IP
 * budget; in memory, and counted per surface so MCP-port failures never lock the admin portal. */

import { HitWindows } from '../gate/rate-limit.js';

export type LoginSurface = 'admin' | 'mcp';
const failureKey = (username: string, surface: LoginSurface) => `${surface}:${username.toLowerCase()}`;

export interface ThrottleOptions {
  maxFailures: number;
  windowMs: number;
  ipLimit: number;
  ipWindowMs: number;
}

const DEFAULTS: ThrottleOptions = { maxFailures: 5, windowMs: 15 * 60_000, ipLimit: 60, ipWindowMs: 5 * 60_000 };

export class LoginThrottle {
  private readonly failures: HitWindows;
  private readonly locks: HitWindows;
  private readonly ipHits: HitWindows;
  private readonly opts: ThrottleOptions;

  constructor(
    opts: Partial<ThrottleOptions> = {},
    private readonly now: () => number = Date.now,
    maxKeys?: number,
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    // Bounded: random usernames or spoofed IPs from the internet can't grow these without limit.
    this.failures = new HitWindows(now, maxKeys);
    this.locks = new HitWindows(now, maxKeys);
    this.ipHits = new HitWindows(now, maxKeys);
  }

  /** Tracked keys (tests and diagnostics). */
  get size(): number {
    return this.failures.size + this.locks.size + this.ipHits.size;
  }

  /** Counts a request from `ip`; false when the IP is over budget. */
  allowIp(ip: string | undefined): boolean {
    if (!ip) return true;
    if (this.ipHits.recent(ip, this.opts.ipWindowMs).length >= this.opts.ipLimit) return false;
    this.ipHits.add(ip, this.opts.ipWindowMs);
    return true;
  }

  /** Seconds until the username may try again, or 0. */
  lockedFor(username: string, surface: LoginSurface = 'admin'): number {
    const lockedAt = this.locks.recent(failureKey(username, surface), this.opts.windowMs).at(-1);
    if (lockedAt === undefined) return 0;
    return Math.ceil((lockedAt + this.opts.windowMs - this.now()) / 1000);
  }

  /** Records a failure; returns true if this failure triggered a lockout, which lasts a window from now. */
  fail(username: string, surface: LoginSurface = 'admin'): boolean {
    const key = failureKey(username, surface);
    // Five or more, not exactly five: concurrent failures can pass the fifth before any of them locks.
    if (this.failures.add(key, this.opts.windowMs).length < this.opts.maxFailures) return false;
    if (this.lockedFor(username, surface) > 0) return false;
    this.locks.add(key, this.opts.windowMs);
    return true;
  }

  succeed(username: string, surface: LoginSurface = 'admin') {
    this.failures.delete(failureKey(username, surface));
    this.locks.delete(failureKey(username, surface));
  }
}
