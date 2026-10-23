import { execFileSync, fork } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isPluginChannelFault, refuseChannelHandles } from '../../src/plugins/channel-fault.js';

// ADR-0020: real Node parents and children, so a Node update that changes the internals fails here.
const dir = mkdtempSync(path.join(tmpdir(), 'synoikia-channel-fault-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CHILD = `
import dgram from 'node:dgram';
import net from 'node:net';
import { writeSync } from 'node:fs';
const kind = process.argv[2];
if (kind === 'not-json') writeSync(3, 'not json\\n');
if (kind === 'ack') process.send({ cmd: 'NODE_HANDLE_ACK' });
if (kind === 'nack') process.send({ cmd: 'NODE_HANDLE_NACK' });
if (kind === 'bad-dgram') { const s = dgram.createSocket('udp4'); s.bind(0, '127.0.0.1', () => { s.type = 'bogus'; process.send({}, s); }); }
if (kind === 'server') { const srv = net.createServer(); srv.listen(0, '127.0.0.1', () => process.send({}, srv)); }
setTimeout(() => process.send({ after: kind }), 100);
setTimeout(() => process.exit(0), 300);
`;
const PARENT = `
import { fork } from 'node:child_process';
process.on('uncaughtException', (err) => {
  process.stdout.write(JSON.stringify({ name: err.name, message: err.message, stack: err.stack }));
  process.exit(0);
});
fork(process.argv[2], [process.argv[3]], { execArgv: ['--permission', '--allow-fs-read=' + process.argv[4]], serialization: 'json' });
`;
const child = path.join(dir, 'child.mjs');
writeFileSync(child, CHILD);
writeFileSync(path.join(dir, 'parent.mjs'), PARENT);

function nodeError(kind: string): Error {
  const out = execFileSync(process.execPath, [path.join(dir, 'parent.mjs'), child, kind, dir], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const { name, message, stack } = JSON.parse(out) as Record<string, string>;
  return Object.assign(name === 'SyntaxError' ? new SyntaxError(message) : new Error(message), { stack });
}

/** Forks the child as core does; resolves with how often it was refused and the messages that arrived. */
function refused(kind: string): Promise<{ count: number; messages: unknown[] }> {
  const proc = fork(child, [kind], {
    execArgv: ['--permission', `--allow-fs-read=${dir}`],
    serialization: 'json',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let count = 0;
  const messages: unknown[] = [];
  refuseChannelHandles(proc, () => count++);
  proc.on('message', (m) => messages.push(m));
  return new Promise((resolve) => proc.on('exit', () => resolve({ count, messages })));
}

describe('refuseChannelHandles', () => {
  it('refuses NODE_HANDLE_ACK and NODE_HANDLE_NACK, and the channel keeps working', async () => {
    expect(await refused('ack')).toEqual({ count: 1, messages: [{ after: 'ack' }] });
    expect(await refused('nack')).toEqual({ count: 1, messages: [{ after: 'nack' }] });
  });

  it('closes a handle without converting it, even a forged one', async () => {
    expect((await refused('bad-dgram')).count).toBe(1);
    expect((await refused('server')).count).toBe(1);
  });
});

describe('isPluginChannelFault', () => {
  it('matches a line that is not JSON on the channel', () => {
    expect(isPluginChannelFault(nodeError('not-json'))).toBe(true);
  });

  it('does not match a fault of core', () => {
    let parseError: unknown;
    try {
      JSON.parse('not json');
    } catch (err) {
      parseError = err;
    }
    expect(isPluginChannelFault(parseError)).toBe(false);
    expect(isPluginChannelFault(Object.assign(new Error('assertion'), { code: 'ERR_INTERNAL_ASSERTION' }))).toBe(false);
    expect(isPluginChannelFault(new TypeError('x is undefined'))).toBe(false);
    expect(isPluginChannelFault('not an error')).toBe(false);
  });

  it('does not match frame text inside the message', () => {
    expect(
      isPluginChannelFault(
        new SyntaxError('x\n    at parseChannelMessages (node:internal/child_process/serialization:1'),
      ),
    ).toBe(false);
  });
});
