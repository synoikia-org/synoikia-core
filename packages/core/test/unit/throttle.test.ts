import { describe, expect, it } from 'vitest';
import { LoginThrottle } from '../../src/auth/throttle.js';
import { SlidingWindowLimiter } from '../../src/gate/rate-limit.js';

describe('LoginThrottle', () => {
  it('stays bounded under random usernames and IPs, keeping recent lockouts (review L15)', () => {
    let now = 0;
    const throttle = new LoginThrottle({}, () => now, 100);
    // Looking up names that never failed stores nothing.
    for (let i = 0; i < 1000; i++) expect(throttle.lockedFor(`nobody-${i}`, 'mcp')).toBe(0);
    expect(throttle.size).toBe(0);

    for (let i = 0; i < 5; i++) throttle.fail('admin', 'mcp');
    for (let i = 0; i < 1000; i++) {
      throttle.fail(`random-${i}`, 'mcp');
      throttle.allowIp(`10.0.${i >> 8}.${i & 255}`);
    }
    expect(throttle.size).toBeLessThanOrEqual(200);
    // Entries whose window has passed go first; a live lockout that keeps being checked stays.
    now = 60_000;
    expect(throttle.lockedFor('admin', 'mcp')).toBeGreaterThan(0);
    for (let i = 0; i < 99; i++) throttle.fail(`later-${i}`, 'mcp');
    expect(throttle.lockedFor('admin', 'mcp')).toBeGreaterThan(0);
  });

  it('locks the name again after a burst of failures pushed the count past five', () => {
    let now = 0;
    const throttle = new LoginThrottle({}, () => now);
    // Concurrent wrong passwords all pass the lock check before any of them is recorded.
    for (let i = 0; i < 20; i++) {
      throttle.fail('alice');
      now += 100;
    }
    expect(throttle.lockedFor('alice')).toBeGreaterThan(0);
    // The lock started at the fifth failure, 400 ms in, and ends 15 minutes later.
    now = 400 + 15 * 60_000;
    expect(throttle.lockedFor('alice')).toBe(0);
    for (let i = 0; i < 6; i++) throttle.fail('alice');
    expect(throttle.lockedFor('alice')).toBeGreaterThan(0);
  });

  it('bounds the rate limiter the same way', () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(() => now, 50);
    for (let i = 0; i < 500; i++) limiter.take(`k${i}`, 10, 60_000);
    expect(limiter.size).toBeLessThanOrEqual(50);
    now = 120_000;
    expect(limiter.take('k499', 1, 60_000)).toBe(true);
    expect(limiter.take('k499', 1, 60_000)).toBe(false);
  });
});
