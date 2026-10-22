import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';
import { hostAllowed } from '../../src/http/mcp/endpoint.js';

describe('hostAllowed', () => {
  it('lets in a listed name, the public address and an IPv6 loopback', () => {
    const config = loadConfig({});
    expect(hostAllowed({ ...config, MCP_ALLOWED_HOSTS: ['mcp.lan'] }, 'mcp.lan:8080')).toBe(true);
    expect(hostAllowed({ ...config, PUBLIC_MCP_URL: 'https://mcp.example.com' }, 'mcp.example.com')).toBe(true);
    expect(hostAllowed(config, '[::1]:8080')).toBe(true);
  });
});
