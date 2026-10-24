import { describe, expect, it } from 'vitest';
import { hostAllowed } from '../../src/http/common.js';

describe('hostAllowed', () => {
  it('lets in a listed name, the public address and an IPv6 loopback', () => {
    expect(hostAllowed({ allowed: ['mcp.lan'] }, 'mcp.lan:8080')).toBe(true);
    expect(hostAllowed({ publicUrl: 'https://mcp.example.com', allowed: [] }, 'mcp.example.com')).toBe(true);
    expect(hostAllowed({ allowed: [] }, '[::1]:8080')).toBe(true);
  });
});
