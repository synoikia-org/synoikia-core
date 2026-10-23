import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Duplex, PassThrough } from 'node:stream';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Issue #120: Node can emit 'exit' before core has read the child's last answer. The fake child emits them in that order.
class FakeChild extends EventEmitter {
  pid = 4242;
  channel = new Duplex({ read: () => undefined, write: (_chunk, _encoding, done) => done() });
  stdio = [null, new PassThrough(), new PassThrough(), this.channel];
  stdout = this.stdio[1];
  stderr = this.stdio[2];
  kill = vi.fn();
}
let child: FakeChild;
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => (child = new FakeChild())) }));
const { PluginProcess } = await import('../src/plugins/process.js');

const dir = mkdtempSync(path.join(tmpdir(), 'synoikia-exit-race-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const settle = (p: Promise<unknown>) =>
  p.then(
    () => 'answered',
    (err: Error) => err.message,
  );

describe('PluginProcess exit', () => {
  it('keeps an answer that arrives after the exit and before the close', async () => {
    const proc = new PluginProcess({ dir, entry: 'index.mjs', instanceId: 'race' });
    proc.start();
    const outcome = settle(proc.call('shutdown', undefined, 5000));
    child.emit('exit', 0, null);
    child.channel.push(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: null })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    child.emit('close', 0, null);
    expect(await outcome).toBe('answered');
  });

  it('rejects an unanswered call only at the close', async () => {
    const proc = new PluginProcess({ dir, entry: 'index.mjs', instanceId: 'race' });
    proc.start();
    let outcome: string | undefined;
    void settle(proc.call('shutdown', undefined, 5000)).then((o) => (outcome = o));
    child.emit('exit', 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(outcome).toBeUndefined();
    child.emit('close', 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(outcome).toBe('Plugin exited (0) during shutdown');
  });
});
