import { describe, expect, it } from 'vitest';
import { createInstanceRedactor, GLOBAL_SENSITIVE_KEYS } from '../../src/gate/redact.js';
import { BindingError, runInSandbox } from '../../src/sandbox/index.js';
import type { Binding } from '../../src/sandbox/index.js';

const echo: Binding = async (args) => ({ echoed: args });
const run = (code: string, bindings: Record<string, Record<string, Binding>> = { t: { call: echo } }, limits = {}) =>
  runInSandbox({ code, bindings, limits });

describe('runInSandbox', () => {
  it('cannot reach the host through binding functions or the constructor chain', async () => {
    const r = await run(`
      const probes = [
        () => t.call.constructor('return typeof process')(),
        () => t.call.constructor.constructor('return typeof require')(),
        () => Object.getPrototypeOf(async () => {}).constructor('return typeof globalThis.process')(),
        () => (function () { return this; })().process,
        () => typeof t.call.apply === 'function' && t.call.apply(null, []) && 'no-host-apply',
      ];
      const out = [];
      for (const p of probes) {
        try { out.push(String(await p())); } catch (e) { out.push('threw'); }
      }
      return out;
    `);
    expect(r).toMatchObject({ ok: true, value: ['undefined', 'undefined', 'undefined', 'undefined', 'no-host-apply'] });
  });

  it('only offers the bindings it was given, as own properties', async () => {
    const r = await run(`return Object.keys(t);`);
    expect(r).toMatchObject({ ok: true, value: ['call'] });
    // Namespaces are frozen plain objects: nothing inherited is callable as a binding.
    const inherited = await run(`return [typeof t.constructor, typeof t.hasOwnProperty, typeof t.__proto__.call];`);
    expect(inherited).toMatchObject({ ok: true, value: ['function', 'function', 'undefined'] });
    // Reserved and non-identifier names never become namespaces or functions.
    const odd = await runInSandbox({
      code: `return [typeof console.call, typeof globalThis['bad-name']];`,
      bindings: { console: { call: echo }, 'bad-name': { call: echo } },
    });
    expect(odd).toMatchObject({ ok: true, value: ['undefined', 'undefined'] });
  });
});

describe('redaction of everything leaving the sandbox', () => {
  const SECRET = 'sk-live-0123456789'; // gitleaks:allow (a fake secret)

  it("keeps the error code when a plugin's sensitive keys include `code`, and still scrubs secret values", async () => {
    // A plugin may list `code` (a PIN, say) as sensitive; that must not hide OPERATION_DISABLED & co.
    const byCode = createInstanceRedactor({ keyLists: [GLOBAL_SENSITIVE_KEYS, ['code']], secretValues: [SECRET] });
    const denied: Binding = async () => {
      throw new BindingError('OPERATION_DISABLED', 'widget.set is not enabled');
    };
    const r = await runInSandbox({
      code: 'return await t.call();',
      bindings: { t: { call: denied } },
      limits: {},
      redact: byCode,
    });
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_DISABLED', message: 'widget.set is not enabled' },
    });
    const thrown = await runInSandbox({
      code: `throw Object.assign(new Error('x'), { code: '${SECRET}' });`,
      bindings: {},
      limits: {},
      redact: byCode,
    });
    expect(JSON.stringify(thrown)).not.toContain(SECRET);
  });
});
