import { describe, expect, it, vi } from 'vitest';
import type { ParkedApproval } from '../../src/approvals/service.js';
import { ExecutionRegistry, RESULT_TTL_MS } from '../../src/runtime/executions.js';
import type { PendingResult } from '../../src/runtime/executions.js';

const approval = (id: string): ParkedApproval => ({
  approvalId: id,
  path: `/a/${id}`,
  operationKey: 'echo.set',
  summary: 'set',
  expiresAt: new Date(Date.now() + 60_000),
  inSession: false,
});

describe('ExecutionRegistry', () => {
  it('answers only its owner, waits for a change, refuses a second waiter and drops stale results', async () => {
    let now = Date.now();
    const reg = new ExecutionRegistry(() => now);
    const abort = vi.fn();
    reg.adopt({ id: 'x', owner: 'alice', instanceId: 'i1', approval: approval('p1'), abort });
    expect(reg.status('x', 'bob', 'i1')).toBeUndefined();
    expect(reg.status('x', 'alice', 'i2')).toBeUndefined();
    expect(reg.status('x', 'alice', 'i1')).toMatchObject({ state: 'pending', approvalId: 'p1' });
    expect(reg.currentApproval('x', 'alice', 'i1')?.approvalId).toBe('p1');
    expect(reg.currentApproval('x', 'bob', 'i1')).toBeUndefined();
    expect(reg.currentApproval('x', 'alice', 'i2')).toBeUndefined();
    expect(await reg.wait('x', 'bob', 'i1', 10)).toBe('not_found');

    // Nothing changes: the wait ends with the same approval.
    const still = (await reg.wait('x', 'alice', 'i1', 20)) as PendingResult;
    expect(still).toMatchObject({ status: 'awaiting_approval', approval: { approvalId: 'p1' }, repeat: true });

    const first = reg.wait('x', 'alice', 'i1', 5_000);
    expect(await reg.wait('x', 'alice', 'i1', 10)).toBe('busy');
    reg.settled('x', 'p1', { outcome: 'approved', decidedBy: 'admin' });
    // No approver name to the client; a waiting resume shows, so the card does not ask the chat to continue.
    expect(reg.status('x', 'alice', 'i1')).toEqual({ state: 'approved', resumeWaiting: true });
    expect(reg.currentApproval('x', 'alice', 'i1')).toBeUndefined();
    reg.awaiting('x', approval('p2'));
    const next = (await first) as PendingResult;
    expect(next).toMatchObject({ status: 'awaiting_approval', approval: { approvalId: 'p2' } });
    expect(next.repeat).toBeUndefined();

    reg.settled('x', 'p2', { outcome: 'denied', decidedBy: 'admin' });
    expect(reg.status('x', 'alice', 'i1')).toEqual({ state: 'denied' });
    const running = (await reg.wait('x', 'alice', 'i1', 10)) as PendingResult;
    expect(running).toMatchObject({ status: 'running', error: { code: 'STILL_RUNNING' } });

    reg.abort('i2');
    expect(abort).not.toHaveBeenCalled();
    reg.abort('i1');
    expect(abort).toHaveBeenCalledOnce();
    reg.finish('x', { ok: false, error: { code: 'PERMISSION_DENIED', message: 'no' }, logs: [] });
    expect(reg.status('x', 'alice', 'i1')).toMatchObject({ state: 'done', decision: 'denied' });

    now += RESULT_TTL_MS + 1;
    expect(await reg.wait('x', 'alice', 'i1', 10)).toBe('not_found');
  });

  it('marks an approval as a repeat only after the owner was given it', async () => {
    const reg = new ExecutionRegistry();
    reg.adopt({ id: 'z', owner: 'alice', instanceId: 'i1', approval: approval('p1'), abort: () => {} });
    // The next approval arrives while no resume waits: the first resume to return it is not a repeat.
    reg.settled('z', 'p1', { outcome: 'approved' });
    reg.awaiting('z', approval('p2'));
    const fresh = (await reg.wait('z', 'alice', 'i1', 10)) as PendingResult;
    expect(fresh).toMatchObject({ approval: { approvalId: 'p2' } });
    expect(fresh.repeat).toBeUndefined();
    expect(await reg.wait('z', 'alice', 'i1', 10)).toMatchObject({ approval: { approvalId: 'p2' }, repeat: true });
  });

  it('returns a finished result once, then forgets it; a waiter wakes on abort of its request', async () => {
    const reg = new ExecutionRegistry();
    reg.adopt({ id: 'y', owner: 'alice', instanceId: 'i1', approval: approval('p1'), abort: () => {} });
    const ac = new AbortController();
    const waiting = reg.wait('y', 'alice', 'i1', 60_000, ac.signal);
    ac.abort();
    expect(await waiting).toMatchObject({ status: 'awaiting_approval' });
    reg.finish('y', { ok: true, value: 'done', truncated: false, logs: [] });
    expect(await reg.wait('y', 'alice', 'i1', 10)).toMatchObject({ ok: true, value: 'done' });
    expect(await reg.wait('y', 'alice', 'i1', 10)).toBe('not_found');
  });
});
