import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isPluginChannelFault } from '../../src/plugins/channel-fault.js';

// ADR-0020: the errors come from a real Node parent and child, so a Node update that changes them fails here.
const dir = mkdtempSync(path.join(tmpdir(), 'synoikia-channel-fault-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CHILD = `
import { writeSync } from 'node:fs';
const kind = process.argv[2];
if (kind === 'not-json') writeSync(3, 'not json\\n');
else process.send({ cmd: kind });
setTimeout(() => process.exit(0), 200);
`;
const PARENT = `
import { fork } from 'node:child_process';
process.on('uncaughtException', (err) => {
  process.stdout.write(JSON.stringify({ name: err.name, message: err.message, code: err.code, stack: err.stack }));
  process.exit(0);
});
fork(process.argv[2], [process.argv[3]], { execArgv: ['--permission', '--allow-fs-read=' + process.argv[4]], serialization: 'json' });
`;
writeFileSync(path.join(dir, 'child.mjs'), CHILD);
writeFileSync(path.join(dir, 'parent.mjs'), PARENT);

function nodeError(kind: string): Error {
  const out = execFileSync(process.execPath, [path.join(dir, 'parent.mjs'), path.join(dir, 'child.mjs'), kind, dir], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const { name, message, code, stack } = JSON.parse(out) as Record<string, string>;
  const err = name === 'SyntaxError' ? new SyntaxError(message) : new Error(message);
  return Object.assign(err, { code, stack });
}

describe('isPluginChannelFault', () => {
  it('matches a line that is not JSON on the channel', () => {
    expect(isPluginChannelFault(nodeError('not-json'))).toBe(true);
  });

  it('matches a NODE_HANDLE_ACK or NODE_HANDLE_NACK from the child', () => {
    expect(isPluginChannelFault(nodeError('NODE_HANDLE_ACK'))).toBe(true);
    expect(isPluginChannelFault(nodeError('NODE_HANDLE_NACK'))).toBe(true);
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
    const forged = new Error('x\n    at ChildProcess.<anonymous> (node:internal/child_process:1');
    expect(isPluginChannelFault(Object.assign(forged, { code: 'ERR_INTERNAL_ASSERTION' }))).toBe(false);
  });
});
