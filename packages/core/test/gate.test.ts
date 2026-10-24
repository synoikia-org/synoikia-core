import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest } from '@synoikia/plugin-sdk';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalLinkService } from '../src/approvals/links.js';
import { ApprovalService } from '../src/approvals/service.js';
import type {
  ApprovalRequestInput,
  ClientPrompts,
  FormPromptRequest,
  FormPromptResponse,
  UrlPromptRequest,
} from '../src/approvals/service.js';
import { setGroupLevel, updateOperation } from '../src/catalog/groups.js';
import { applyCatalogSync } from '../src/catalog/sync.js';
import { openDatabase } from '../src/db/index.js';
import { auditLog, guides, operations, pendingApprovals, pluginInstances, preApprovalRules } from '../src/db/schema.js';
import type { AccessCeiling, AccessLevel } from '../src/gate/access.js';
import { issueAttestationKey } from '../src/gate/attestation.js';
import type { CallerContext, GateDeps, InstanceRuntime } from '../src/gate/pipeline.js';
import { SlidingWindowLimiter } from '../src/gate/rate-limit.js';
import { createRedactor, GLOBAL_SENSITIVE_KEYS } from '../src/gate/redact.js';
import { parseInstanceSettings, readInstanceSettings } from '../src/instances/settings.js';
import type { InstanceSettings } from '../src/instances/settings.js';
import { PluginProcess } from '../src/plugins/process.js';
import { ExecutionRegistry } from '../src/runtime/executions.js';
import type { PendingResult } from '../src/runtime/executions.js';
import { executeCode, resumeExecution } from '../src/runtime/index.js';
import { seedInstance } from './helpers.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/plugins/echo');
const manifest = parseManifest(JSON.parse(readFileSync(path.join(FIXTURE, 'manifest.json'), 'utf8')));

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function setup(settings: Partial<InstanceSettings> = {}, opts: { formFallbackMs?: number } = {}) {
  const { db, instanceId } = seedInstance(openDatabase(':memory:'), 'echo');
  db.update(pluginInstances).set({ settings }).where(eq(pluginInstances.id, instanceId)).run();
  const proc = new PluginProcess({ dir: FIXTURE, entry: manifest.entry, instanceId, defaultTimeoutMs: 5000 });
  proc.start();
  cleanup.push(() => proc.stop(500));
  await proc.call('init', { instanceId, config: {}, secrets: {}, sdkVersion: '0.1.0' });
  applyCatalogSync(db, instanceId, await proc.call('syncCatalog'));

  const approvals = new ApprovalService(db, new ApprovalLinkService(db), undefined, opts.formFallbackMs);
  cleanup.push(() => approvals.cancelAll());
  const deps: GateDeps = { db, approvals, limiter: new SlidingWindowLimiter(), attestationKey: randomBytes(32) };
  /** What `catalogVersion()` reports: the running bundle's version while the catalog was synced from it. */
  const bundle: { catalog: string | undefined } = { catalog: '1.0.0' };
  const rt: InstanceRuntime = {
    instanceId,
    slug: 'echo',
    manifest,
    settings: { ...parseInstanceSettings({}), ...settings },
    redact: createRedactor(GLOBAL_SENSITIVE_KEYS, manifest.sensitiveKeys),
    plugin: () => proc,
    catalogVersion: () => bundle.catalog,
  };
  const opId = (key: string) => db.select().from(operations).where(eq(operations.key, key)).get()!.id;
  const setLevel = (level: AccessLevel) => setGroupLevel(db, instanceId, 'echo', level);
  const caller = (prompts?: ClientPrompts, ceiling: AccessCeiling = 'write'): CallerContext => ({
    client: { kind: 'mcp_client', id: 'claude-test' },
    principal: { ceiling, roleId: 'admin' },
    prompts,
  });
  const exec = (code: string, prompts?: ClientPrompts, ceiling?: AccessCeiling) =>
    executeCode(deps, rt, caller(prompts, ceiling), code);
  const audits = () => db.select().from(auditLog).where(eq(auditLog.kind, 'call')).all();
  const pending = () => db.select().from(pendingApprovals).where(eq(pendingApprovals.status, 'pending')).all();
  return { db, instanceId, proc, deps, rt, opId, setLevel, exec, audits, approvals, caller, pending, bundle };
}

/** A URL-prompt client; `onOpen` plays the human on the approval page, otherwise nobody decides. */
function urlClient(onOpen?: (req: UrlPromptRequest) => void, action: 'accept' | 'decline' | 'cancel' = 'accept') {
  const opened: UrlPromptRequest[] = [];
  const completed: string[] = [];
  const prompts: ClientPrompts = {
    url: async (req) => {
      opened.push(req);
      if (onOpen) setTimeout(() => onOpen(req), 5);
      return { action };
    },
    urlComplete: (id) => completed.push(id),
  };
  return { prompts, opened, completed };
}

/** A form-only client that says yes to everything it is shown, the self-approval the review found. */
function formClient() {
  const asked: FormPromptRequest[] = [];
  const prompts: ClientPrompts = {
    form: async (req) => {
      asked.push(req);
      return { action: 'accept' };
    },
  };
  return { prompts, asked };
}

/** A form client whose answer the test gives later, or never: the client that advertises forms but hides them. */
function heldFormClient() {
  const asked: {
    req: FormPromptRequest;
    signal: AbortSignal;
    answer: (res: FormPromptResponse) => void;
    fail: (err: Error) => void;
  }[] = [];
  const prompts: ClientPrompts = {
    form: (req, signal) => new Promise((answer, fail) => asked.push({ req, signal, answer, fail })),
  };
  return { prompts, asked };
}

const waitFor = async (pred: () => boolean, ms = 3000) => {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('execute → gate → plugin', () => {
  describe('level Ask: approvals', () => {
    it('never lets a form-only client approve its own call, whatever it answers', async () => {
      const t = await setup();
      t.setLevel('ask');
      const client = formClient();
      const r = await t.exec(`await echo.call('echo.set', { name: 'x' });`, client.prompts);
      expect(r).toMatchObject({
        ok: false,
        error: { code: 'PERMISSION_DENIED', message: expect.stringContaining('only supports form prompts') },
      });
      expect(client.asked).toEqual([]);
    });

    it('never approves in the session from a stored value it does not know, or for a typed confirmation', async () => {
      const both = () => {
        const url = urlClient();
        const form = formClient();
        return { prompts: { ...url.prompts, ...form.prompts }, opened: url.opened, asked: form.asked };
      };
      // A stored `writes` reads as off, as the instance manager reads it.
      const legacy = await setup(readInstanceSettings({ formElicitationApprovals: 'writes' }, 'test'));
      legacy.setLevel('ask');
      updateOperation(legacy.db, legacy.instanceId, legacy.opId('echo.query'), { level: 'ask' });
      const formOnly = formClient();
      await expect(legacy.exec(`await echo.call('echo.query', { q: 1 });`, formOnly.prompts)).resolves.toMatchObject({
        ok: false,
        error: { code: 'PERMISSION_DENIED', message: expect.stringContaining('only supports form') },
      });
      expect(formOnly.asked).toEqual([]);
      const dual = both();
      const run = legacy.exec(`await echo.call('echo.set', { name: 'x' });`, dual.prompts);
      await waitFor(() => dual.opened.length === 1);
      expect(dual.asked).toEqual([]);
      legacy.approvals.cancelAll();
      await run;

      // A typed confirmation, so locked (ADR-0004): the page, never the form.
      const t = await setup({ formElicitationApprovals: 'ask' });
      t.setLevel('ask');
      updateOperation(t.db, t.instanceId, t.opId('echo.confirm'), { level: 'ask' });
      const client = both();
      const typed = t.exec(`await echo.call('echo.confirm', { name: 'vol/c' });`, client.prompts);
      await waitFor(() => client.opened.length === 1);
      expect(client.asked).toEqual([]);
      t.approvals.cancelAll();
      await typed;
    });

    it('marks a parked approval for in-session decision only where the card may decide it', async () => {
      const parkedFor = async (settings: Partial<InstanceSettings>, key: string, params: unknown) => {
        const t = await setup(settings);
        t.setLevel('ask');
        updateOperation(t.db, t.instanceId, t.opId('echo.delete'), { level: 'ask' });
        updateOperation(t.db, t.instanceId, t.opId('echo.confirm'), { level: 'ask' });
        const deps = { ...t.deps, executions: new ExecutionRegistry() };
        const caller = { ...t.caller(), parkable: true };
        const parked = (await executeCode(
          deps,
          t.rt,
          caller,
          `await echo.call(${JSON.stringify(key)}, ${JSON.stringify(params)});`,
        )) as PendingResult;
        const offered = parked.approval!;
        const run = () => resumeExecution(deps, t.rt, caller, parked.executionId);
        return { t, offered, run };
      };
      const open = await parkedFor({ formElicitationApprovals: 'ask' }, 'echo.set', { name: 'x' });
      expect(open.offered.inSession).toBe(true);
      open.t.approvals.decideInSession(open.offered.approvalId, { approve: true, decidedBy: 'token:me' });
      expect(await open.run()).toMatchObject({ ok: true });
      expect(open.t.audits().find((a) => a.decision === 'human-approved')).toMatchObject({
        decision: 'human-approved',
        decidedVia: 'elicitation',
        decidedBy: 'token:me',
        detail: { approvalChannel: 'card' },
      });

      // A stored value the schema does not know (an older `writes`) turns the card off too.
      const old = await parkedFor({ formElicitationApprovals: 'ask' }, 'echo.set', { name: 'x' });
      old.t.db
        .update(pluginInstances)
        .set({ settings: { formElicitationApprovals: 'writes' } })
        .where(eq(pluginInstances.id, old.t.instanceId))
        .run();
      expect(() => old.t.approvals.decideInSession(old.offered.approvalId, { approve: true, decidedBy: 'x' })).toThrow(
        expect.objectContaining({ code: 'approval_not_in_session' }),
      );
      old.t.approvals.cancelAll();
      await old.run();

      // The admin turned the setting off while the approval waited.
      const later = await parkedFor({ formElicitationApprovals: 'ask' }, 'echo.set', { name: 'x' });
      later.t.db.update(pluginInstances).set({ settings: {} }).where(eq(pluginInstances.id, later.t.instanceId)).run();
      expect(() =>
        later.t.approvals.decideInSession(later.offered.approvalId, { approve: true, decidedBy: 'x' }),
      ).toThrow(expect.objectContaining({ code: 'approval_not_in_session' }));
      later.t.approvals.decide(later.offered.approvalId, { approve: false, decidedBy: 'admin' });
      expect(await later.run()).toMatchObject({ ok: false });
      expect(() =>
        later.t.approvals.decideInSession(later.offered.approvalId, { approve: true, decidedBy: 'x' }),
      ).toThrow(expect.objectContaining({ code: 'approval_closed' }));
      expect(() => later.t.approvals.decideInSession('nope', { approve: true, decidedBy: 'x' })).toThrow(
        expect.objectContaining({ code: 'approval_not_found' }),
      );

      for (const [settings, key, params] of [
        [{ formElicitationApprovals: 'ask' }, 'echo.delete', { name: 'vol/x' }],
        [{ formElicitationApprovals: 'ask' }, 'echo.confirm', { name: 'vol/c' }],
        [{}, 'echo.set', { name: 'x' }],
      ] as const) {
        const { t, offered, run } = await parkedFor(settings, key, params);
        expect(offered.inSession).toBe(false);
        expect(() => t.approvals.decideInSession(offered.approvalId, { approve: true, decidedBy: 'x' })).toThrow(
          expect.objectContaining({ code: 'approval_not_in_session' }),
        );
        t.approvals.cancelAll();
        expect(await run()).toMatchObject({ ok: false });
      }
    });

    it('hides secrets in a config diff from the approval, the stored row and a form prompt', async () => {
      const t = await setup({ formElicitationApprovals: 'ask' });
      t.setLevel('ask');
      // Make echo.set a config write whose prepareWrite returns a diff that touches secrets.
      t.db.update(operations).set({ kind: 'config' }).where(eq(operations.key, 'echo.set')).run();
      t.rt.manifest = { ...t.rt.manifest, capabilities: { ...t.rt.manifest.capabilities, configTransform: true } };
      const real = t.rt.plugin();
      t.rt.plugin = () =>
        ({
          call: (method: string, params: unknown, ...rest: unknown[]) =>
            method === 'prepareWrite'
              ? Promise.resolve({
                  params: (params as { params: unknown }).params,
                  diff: [
                    { path: '/smtp/password', before: 'old-smtp-secret', after: 'new-smtp-secret' },
                    { path: '/pin', after: '4711' },
                    { path: '/name', before: 'a', after: 'b' },
                  ],
                  expectedHash: 'h1',
                })
              : (real.call as (...a: unknown[]) => Promise<unknown>)(method, params, ...rest),
        }) as unknown as ReturnType<typeof t.rt.plugin>;
      const client = formClient();
      await t.exec(`await echo.call('echo.set', { name: 'x', pin: '4711' });`, client.prompts);
      const row = t.db.select().from(pendingApprovals).get()!;
      expect(row.diff).toEqual([
        { path: '/smtp/password', before: '[REDACTED]', after: '[REDACTED]' },
        { path: '/pin', after: '[REDACTED]' },
        { path: '/name', before: 'a', after: 'b' },
      ]);
      expect(client.asked).toHaveLength(1);
      expect(client.asked[0]?.message).toContain('/smtp/password');
      const shown = JSON.stringify(client.asked);
      for (const secret of ['old-smtp-secret', 'new-smtp-secret', '4711']) expect(shown).not.toContain(secret);
    });

    it('audits what the agent sent and, apart, the params that prepareWrite made (ADR-0003)', async () => {
      const t = await setup();
      t.setLevel('ask');
      t.db.update(operations).set({ kind: 'config' }).where(eq(operations.key, 'echo.set')).run();
      t.rt.manifest = { ...t.rt.manifest, capabilities: { ...t.rt.manifest.capabilities, configTransform: true } };
      const real = t.rt.plugin();
      t.rt.plugin = () =>
        ({
          call: (method: string, params: unknown, ...rest: unknown[]) =>
            method === 'prepareWrite'
              ? Promise.resolve({ params: { name: 'y', pin: '4711' }, diff: [], expectedHash: 'h1' })
              : (real.call as (...a: unknown[]) => Promise<unknown>)(method, params, ...rest),
        }) as unknown as ReturnType<typeof t.rt.plugin>;
      const run = t.exec(`await echo.call('echo.set', { name: 'x', pin: '4711' });`);
      await waitFor(() => t.db.select().from(pendingApprovals).all().length === 1);
      t.approvals.cancelAll();
      await run;
      const row = t.audits().find((a) => a.operationKey === 'echo.set');
      expect(row).toMatchObject({
        params: { name: 'x', pin: '[REDACTED]' },
        detail: { preparedParams: { name: 'y', pin: '[REDACTED]' } },
      });
    });
  });

  describe('locked operations', () => {
    it('are never pre-approved, even by a rule that slipped into the DB', async () => {
      const t = await setup();
      updateOperation(t.db, t.instanceId, t.opId('echo.delete'), { level: 'ask' });
      t.db
        .insert(preApprovalRules)
        .values({ id: randomUUID(), instanceId: t.instanceId, operationId: t.opId('echo.delete'), reason: 'x' })
        .run();
      const r = await t.exec(`await echo.call('echo.delete', { name: 'vol/x' });`);
      expect(r).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    });
  });

  it('requires a current best-practice key for attested operations', async () => {
    const t = await setup();
    t.setLevel('write');
    const opId = t.opId('echo.guided');
    const call = (key?: string) =>
      t.exec(`return (await echo.call('echo.guided', ${JSON.stringify(key ? { best_practice_key: key } : {})})).key;`);

    await expect(call()).resolves.toMatchObject({ ok: false, error: { code: 'ATTESTATION_REQUIRED' } });
    t.db
      .insert(guides)
      .values({
        id: randomUUID(),
        instanceId: t.instanceId,
        operationId: opId,
        version: 'v1',
        content: 'x',
        fetchedAt: new Date(1000),
      })
      .run();
    const v1 = issueAttestationKey(t.deps.attestationKey, t.instanceId, 'echo.guided', 'v1');
    await expect(call('forged')).resolves.toMatchObject({ ok: false, error: { code: 'ATTESTATION_REQUIRED' } });
    await expect(call(v1)).resolves.toMatchObject({ ok: true, value: 'echo.guided' });

    t.db
      .insert(guides)
      .values({
        id: randomUUID(),
        instanceId: t.instanceId,
        operationId: opId,
        version: 'v2',
        content: 'y',
        fetchedAt: new Date(2000),
      })
      .run();
    await expect(call(v1)).resolves.toMatchObject({ ok: false, error: { code: 'ATTESTATION_REQUIRED' } });

    // The key is bound to the MCP session that read the guide (review M17).
    const inSession = (sessionId: string, key: string) =>
      executeCode(
        t.deps,
        t.rt,
        { ...t.caller(), mcpSessionId: sessionId },
        `return (await echo.call('echo.guided', ${JSON.stringify({ best_practice_key: key })})).key;`,
      );
    const s1 = issueAttestationKey(t.deps.attestationKey, t.instanceId, 'echo.guided', 'v2', 'session-1');
    await expect(inSession('session-1', s1)).resolves.toMatchObject({ ok: true, value: 'echo.guided' });
    await expect(inSession('session-2', s1)).resolves.toMatchObject({
      ok: false,
      error: { code: 'ATTESTATION_REQUIRED' },
    });
    await expect(call(s1)).resolves.toMatchObject({ ok: false, error: { code: 'ATTESTATION_REQUIRED' } });
  });
});

describe('ApprovalService', () => {
  it('denies approvals left pending by a previous process', async () => {
    const t = await setup();
    t.setLevel('ask');
    const run = t.exec(`await echo.call('echo.set', { name: 'x' });`, urlClient().prompts);
    await waitFor(() => t.pending().length === 1);
    // Simulate a restart: a fresh process sees the row but has none of the in-memory state.
    expect(ApprovalService.denyOrphans(t.db)).toBe(1);
    expect(t.db.select().from(pendingApprovals).get()?.status).toBe('denied');
    const row = t.db.select().from(pendingApprovals).get()!;
    const fresh = new ApprovalService(t.db, new ApprovalLinkService(t.db));
    expect(() => fresh.decide(row.id, { approve: true, decidedBy: 'a' })).toThrow(/already denied/);
    t.approvals.cancelAll();
    await run;
  });
});

describe('in-session form', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const requestInput = (t: Awaited<ReturnType<typeof setup>>, extra: Partial<ApprovalRequestInput>) =>
    ({
      instanceId: t.instanceId,
      operationId: t.opId('echo.set'),
      operationKey: 'echo.set',
      classification: 'write',
      paramsDisplay: { name: 'x' },
      paramsHash: 'h',
      resolvedTargets: [],
      summary: 'Set x',
      client: { kind: 'mcp_client', id: 'claude-test' },
      timeoutMs: 60_000,
      formApprovals: true,
      ...extra,
    }) satisfies ApprovalRequestInput;

  it('closes the open form when the approval settles another way', async () => {
    const t = await setup();
    const client = heldFormClient();
    const { id, decision } = t.approvals.request(requestInput(t, { prompts: client.prompts }));
    expect(client.asked[0]?.signal.aborted).toBe(false);
    t.approvals.cancel(id, 'execution_ended');
    await expect(decision).resolves.toMatchObject({ outcome: 'cancelled' });
    expect(client.asked[0]?.signal.aborted).toBe(true);
    // The rejection of the closed form changes nothing.
    client.asked[0]!.fail(new Error('Request cancelled'));
    await sleep(10);
    expect(t.db.select().from(pendingApprovals).where(eq(pendingApprovals.id, id)).get()?.status).toBe('cancelled');
  });
});
