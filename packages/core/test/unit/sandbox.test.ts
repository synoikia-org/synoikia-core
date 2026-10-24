import { describe, expect, it } from 'vitest';
import { createInstanceRedactor, GLOBAL_SENSITIVE_KEYS } from '../../src/gate/redact.js';
import { BindingError, Budget, runInSandbox } from '../../src/sandbox/index.js';
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

describe('limits while a binding waits (ADR-0005)', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waits: Binding = async (_args, budget) => {
    budget.pause();
    await sleep(5000);
    budget.resume();
    return 'approved';
  };
  const bindings = { t: { wait: waits, quick: echo } };

  it('ends a run that logs in a loop while a binding waits', async () => {
    const start = performance.now();
    const r = await run(`const p = t.wait(); await t.quick(); for (;;) console.log(''); await p;`, bindings, {
      timeoutMs: 500,
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
    expect(performance.now() - start).toBeLessThan(2500);
  });

  it('cuts a log line at a whole character and keeps to the byte cap', async () => {
    const r = await run(`console.log('a' + '\u{1F600}'.repeat(300)); return 1;`, undefined, { maxLogBytes: 1002 });
    const text = r.logs.join('');
    expect(text).toBe(`a${'\u{1F600}'.repeat(250)}`);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1002);
  });
});

describe('Budget (ADR-0005)', () => {
  it('ends the run on resume when the CPU used while paused took the time that was left', () => {
    let cpu = 0;
    let expired = 0;
    const budget = new Budget(
      1000,
      () => expired++,
      () => cpu,
    );
    budget.start();
    budget.pause();
    cpu += 1000;
    budget.resume();
    expect(budget.expired).toBe(true);
    expect(budget.remainingMs()).toBe(0);
    expect(expired).toBe(1);
    budget.stop();
  });

  it('keeps the run going on resume when CPU is left, and charges it', () => {
    let cpu = 0;
    const budget = new Budget(
      1000,
      () => undefined,
      () => cpu,
    );
    budget.start();
    budget.pause();
    cpu += 400;
    budget.resume();
    expect(budget.expired).toBe(false);
    expect(budget.remainingMs()).toBeLessThanOrEqual(600);
    budget.stop();
  });
});
