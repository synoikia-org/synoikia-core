import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';
import { hostAllowed, LogThrottle } from '../../src/http/mcp/endpoint.js';

describe('hostAllowed', () => {
  it('lets in a listed name, the public address and an IPv6 loopback', () => {
    const config = loadConfig({});
    expect(hostAllowed({ ...config, MCP_ALLOWED_HOSTS: ['mcp.lan'] }, 'mcp.lan:8080')).toBe(true);
    expect(hostAllowed({ ...config, PUBLIC_MCP_URL: 'https://mcp.example.com' }, 'mcp.example.com')).toBe(true);
    expect(hostAllowed(config, '[::1]:8080')).toBe(true);
  });
});

describe('LogThrottle', () => {
  it('drops repeats of one key within the window, then counts them', () => {
    const throttle = new LogThrottle();
    expect(throttle.admit('k', 0)).toBe(0);
    expect(throttle.admit('k', 1000)).toBeNull();
    expect(throttle.admit('k', 2000)).toBeNull();
    expect(throttle.admit('k', 61_000)).toBe(2);
    expect(throttle.admit('other', 61_000)).toBe(0);
  });
});
