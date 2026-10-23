import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PluginProcess } from '../src/plugins/process.js';

// Issue #120: a child that answers and exits at once must not have its answer rejected.
const dir = mkdtempSync(path.join(tmpdir(), 'synoikia-exit-race-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
writeFileSync(
  path.join(dir, 'index.mjs'),
  `import net from 'node:net';
const channel = new net.Socket({ fd: 3, readable: true, writable: true });
channel.setEncoding('utf8');
channel.on('data', (text) => {
  const { id } = JSON.parse(text.split('\\n')[0]);
  channel.write(JSON.stringify({ jsonrpc: '2.0', id, result: null }) + '\\n', () => process.exit(0));
});
`,
);

describe('PluginProcess exit', () => {
  it('keeps an answer that the child sent just before it exited', async () => {
    const outcomes: string[] = [];
    for (let round = 0; round < 100; round++) {
      const proc = new PluginProcess({ dir, entry: 'index.mjs', instanceId: `race-${round}` });
      const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
      proc.start();
      outcomes.push(
        await proc.call('shutdown', undefined, 5000).then(
          () => 'answered',
          (err: Error) => err.message,
        ),
      );
      await exited;
    }
    expect(outcomes.filter((o) => o !== 'answered')).toEqual([]);
  }, 60_000);
});
