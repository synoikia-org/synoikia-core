import { describe, expect, it } from 'vitest';
import { hostAllowed, originAllowed } from '../../src/http/common.js';

describe('hostAllowed', () => {
  it('lets in a listed name, the public address and an IPv6 loopback', () => {
    expect(hostAllowed({ allowed: ['mcp.lan'] }, 'mcp.lan:8080')).toBe(true);
    expect(hostAllowed({ publicUrl: 'https://mcp.example.com', allowed: [] }, 'mcp.example.com')).toBe(true);
    expect(hostAllowed({ allowed: [] }, '[::1]:8080')).toBe(true);
  });

  it('compares names without case, and refuses a trailing dot, a missing Host and a name it does not list', () => {
    expect(hostAllowed({ allowed: ['synoikia.lan'] }, 'SYNOIKIA.lan')).toBe(true);
    expect(hostAllowed({ allowed: ['synoikia.lan'] }, 'synoikia.lan.')).toBe(false);
    expect(hostAllowed({ allowed: [] }, 'localhost.')).toBe(false);
    expect(hostAllowed({ allowed: [] }, undefined)).toBe(false);
    expect(hostAllowed({ allowed: ['mcp.lan'] }, 'synoikia.lan')).toBe(false);
  });
});

describe('originAllowed', () => {
  it('lets in a request without Origin, and refuses a null or foreign Origin', () => {
    expect(originAllowed({ allowed: [] }, undefined)).toBe(true);
    expect(originAllowed({ allowed: [] }, 'null')).toBe(false);
    expect(originAllowed({ allowed: ['synoikia.lan'] }, 'http://attacker.example')).toBe(false);
    expect(originAllowed({ allowed: ['synoikia.lan'] }, 'http://synoikia.lan:8081')).toBe(true);
  });
});
