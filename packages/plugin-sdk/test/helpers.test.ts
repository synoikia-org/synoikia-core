import { describe, expect, it, vi } from 'vitest';
import { definePlugin, lazy, PendingRequests, requireString } from '../src/index.js';

describe('PendingRequests', () => {
  it('settles requests by id and ignores unknown ids', async () => {
    const pending = new PendingRequests();
    const { id, promise } = pending.start('pool.query', 1000);
    expect(pending.take('nope')).toBeUndefined();
    const settler = pending.take(id)!;
    expect(settler.label).toBe('pool.query');
    settler.resolve(42);
    await expect(promise).resolves.toBe(42);
    expect(pending.take(id)).toBeUndefined();
    expect(pending.size).toBe(0);
  });

  it('times out with the given error', async () => {
    vi.useFakeTimers();
    try {
      const pending = new PendingRequests((label, ms) => new Error(`${label} after ${ms}`));
      const { promise } = pending.start('slow', 50);
      const caught = promise.catch((e: Error) => e.message);
      vi.advanceTimersByTime(60);
      await expect(caught).resolves.toBe('slow after 50');
      expect(pending.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails everything pending', async () => {
    const pending = new PendingRequests();
    const a = pending.start('a', 1000).promise;
    const b = pending.start('b', 1000);
    expect(pending.fail(b.id, new Error('send failed'))).toBe(true);
    pending.failAll(new Error('closed'));
    await expect(a).rejects.toThrow('closed');
    await expect(b.promise).rejects.toThrow('send failed');
    expect(pending.fail(b.id, new Error('again'))).toBe(false);
  });
});

describe('lazy', () => {
  it('loads once, shares concurrent loads, and reloads after reset', async () => {
    let n = 0;
    const l = lazy(async () => ++n);
    expect(l.peek()).toBeUndefined();
    expect(await Promise.all([l.get(), l.get()])).toEqual([1, 1]);
    expect(l.peek()).toBe(1);
    l.reset();
    expect(await l.get()).toBe(2);
    expect(await l.reload()).toBe(3);
  });
});

describe('definePlugin', () => {
  const init = (config: Record<string, unknown> = { baseUrl: 'https://x' }) => ({
    instanceId: 'i',
    config,
    secrets: { token: 't' },
    sdkVersion: '1',
  });

  function make(opts: { probe?: () => Promise<void>; version?: () => Promise<string> } = {}) {
    const closed: string[] = [];
    let loads = 0;
    const inits: number[] = [];
    const handlers = definePlugin({
      connect: ({ config }) => ({ url: requireString(config, 'baseUrl') }),
      close: (c) => void closed.push(c.url),
      probe: opts.probe,
      version: opts.version ?? (async () => '1.2.3'),
      handlers: (kit) => {
        const catalog = kit.lazy(async () => ++loads);
        kit.onInit(() => inits.push(loads));
        return {
          syncCatalog: async () => ({ upstreamVersion: String(await catalog.get()), operations: [] }),
          resolveOperation: () => ({ key: kit.client().url, params: kit.init().secrets.token }),
          summarize: () => ({ text: 'x' }),
          invoke: async ({ context }) => (context.callId === 'v' ? kit.version() : kit.timeout(context)),
        };
      },
    });
    return { handlers, closed, inits };
  }

  it('builds the client, resets caches and closes the old client on re-init', async () => {
    const { handlers, closed, inits } = make();
    await handlers.init(init({ baseUrl: 'https://a' }));
    expect(await handlers.syncCatalog()).toMatchObject({ upstreamVersion: '1' });
    expect(await handlers.syncCatalog()).toMatchObject({ upstreamVersion: '1' });
    await handlers.init(init({ baseUrl: 'https://b' }));
    expect(closed).toEqual(['https://a']);
    expect(await handlers.syncCatalog()).toMatchObject({ upstreamVersion: '2' });
    expect(handlers.resolveOperation({ fn: 'call', args: [] })).toEqual({ key: 'https://b', params: 't' });
    expect(inits).toEqual([0, 1]);
    await handlers.shutdown!();
    expect(closed).toEqual(['https://a', 'https://b']);
  });

  it('reports connection tests without throwing', async () => {
    const ok = make();
    await ok.handlers.init(init());
    expect(await ok.handlers.testConnection()).toEqual({ ok: true, upstreamVersion: '1.2.3' });
    expect(await ok.handlers.getUpstreamVersion()).toBe('1.2.3');
    const bad = make({ probe: () => Promise.reject(new Error('denied')) });
    await bad.handlers.init(init());
    expect(await bad.handlers.testConnection()).toEqual({ ok: false, message: 'denied' });
  });

  it('gives invoke at least a second', async () => {
    const { handlers } = make();
    await handlers.init(init());
    expect(await handlers.invoke({ key: 'k', params: {}, context: { callId: 'c', deadlineMs: 5 } })).toBe(1000);
    expect(await handlers.invoke({ key: 'k', params: {}, context: { callId: 'c', deadlineMs: 5000 } })).toBe(5000);
    expect(await handlers.invoke({ key: 'k', params: {}, context: { callId: 'v', deadlineMs: 5000 } })).toBe('1.2.3');
  });
});
