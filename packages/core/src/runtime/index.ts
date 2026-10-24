import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { writeAudit } from '../audit.js';
import { accessInput, catalogOf, listGroups } from '../catalog/groups.js';
import { loadCaps } from '../catalog/role-levels.js';
import { findRegistryEntries } from '../catalog/registry.js';
import type { Db } from '../db/index.js';
import { guides, operationGroups, operations } from '../db/schema.js';
import { getSettings } from '../settings.js';
import { effectiveAccess } from '../gate/access.js';
import type { AccessPrincipal } from '../gate/access.js';
import { currentGuide, issueAttestationKey } from '../gate/attestation.js';
import { createGateBindings, principalKey } from '../gate/pipeline.js';
import type { CallerContext, GateDeps, GatePark, InstanceRuntime } from '../gate/pipeline.js';
import type { ParkedApproval } from '../approvals/service.js';
import { pendingResult } from './executions.js';
import type { ExecuteResult } from './executions.js';
import { BindingError, runInSandbox } from '../sandbox/index.js';
import type { Binding, SandboxResult } from '../sandbox/index.js';

/** The engines behind the `search` and `execute` tools (ADR-0003). */

/** Sandbox caps (ADR-0003): runs per minute per principal and instance, and concurrent isolates per
 * instance (an instance setting) and in total. Over a cap a run waits for a place, first come first served. */
export const RUNS_PER_CPU = 16;
/** How long a run waits for a place before core answers `BUSY`; the wait is not sandbox time. */
export const ADMISSION_WAIT_MS = 2_000;
const running = new Map<string, number>();
let runningTotal = 0;
/** Runs of the instance that hold or wait for a place. */
export const runsOf = (instanceId: string) =>
  (running.get(instanceId) ?? 0) + waiting.filter((w) => w.instanceId === instanceId).length;
const waiting: { instanceId: string; cap: number; total: number; admit: () => void }[] = [];

/** Parked scripts still running, across all registries (they gave back their concurrency slot). */
let parkedRunning = 0;

/** Scripts running now, across all instances (shutdown waits for cancelled ones to return). */
export const sandboxesRunning = () => runningTotal + parkedRunning;

const BUSY: SandboxResult = {
  ok: false,
  error: { code: 'BUSY', message: 'Too many scripts are running; try again shortly' },
  logs: [],
};

const fits = (instanceId: string, cap: number, total: number) =>
  (running.get(instanceId) ?? 0) < cap && runningTotal < total;

/** The total of runs at once: the admin's, or 16 for each CPU, from 2 to 256. */
export function sandboxTotal(db: Db, cpus: number): number {
  return getSettings(db, 'runtime').runsAtOnce ?? Math.min(256, Math.max(2, RUNS_PER_CPU * cpus));
}

/** Takes a place; the returned release hands it to the oldest waiting run that fits. */
function take(instanceId: string): () => void {
  running.set(instanceId, (running.get(instanceId) ?? 0) + 1);
  runningTotal++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    running.set(instanceId, (running.get(instanceId) ?? 1) - 1);
    runningTotal--;
    const next = waiting.findIndex((w) => fits(w.instanceId, w.cap, w.total));
    if (next >= 0) waiting.splice(next, 1)[0]!.admit();
  };
}

async function admit(
  deps: GateDeps,
  rt: InstanceRuntime,
  caller: CallerContext,
  signal?: AbortSignal,
): Promise<SandboxResult | (() => void)> {
  // A request that already ended neither queues nor uses its run budget.
  if (signal?.aborted) return BUSY;
  const who = principalKey(caller);
  if (!deps.limiter.take(`run:${rt.instanceId}:${who}`, rt.settings.executePerMinute, 60_000)) {
    return {
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'Too many search/execute calls; slow down' },
      logs: [],
    };
  }
  // Also capped here, in case the total is lowered below a stored limit (ADR-0003).
  const total = deps.runTotal?.() ?? RUNS_PER_CPU;
  const cap = Math.min(rt.settings.runsAtOnce, total - 1);
  // A free place never waits beside a run that fits it: a release hands it over at once.
  if (fits(rt.instanceId, cap, total)) return take(rt.instanceId);
  return new Promise((resolve) => {
    const leave = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', giveUp);
      const at = waiting.indexOf(entry);
      if (at >= 0) waiting.splice(at, 1);
    };
    const giveUp = () => {
      leave();
      resolve(BUSY);
    };
    const entry = {
      instanceId: rt.instanceId,
      cap,
      total,
      admit: () => {
        leave();
        resolve(take(rt.instanceId));
      },
    };
    const timer = setTimeout(giveUp, ADMISSION_WAIT_MS);
    signal?.addEventListener('abort', giveUp);
    waiting.push(entry);
  });
}

export async function executeCode(
  deps: GateDeps,
  rt: InstanceRuntime,
  caller: CallerContext,
  code: string,
  signal?: AbortSignal,
): Promise<ExecuteResult> {
  const release = await admit(deps, rt, caller, signal);
  if (typeof release !== 'function') return release;
  // Ends with the sandbox (return, error or timeout) or earlier, when the request or session goes away;
  // once parked, only the registry ends it (ADR-0006).
  const run = new AbortController();
  const stop = () => run.abort();
  signal?.addEventListener('abort', stop);
  if (signal?.aborted) stop();

  const executionId = randomUUID();
  const registry = caller.parkable ? deps.executions : undefined;
  const owner = principalKey(caller);
  let adopted = false;
  let firstPark!: (a: ParkedApproval) => void;
  const parkedFirst = new Promise<ParkedApproval>((resolve) => (firstPark = resolve));
  const park: GatePark | undefined = registry && {
    reserve: () =>
      adopted
        ? registry.mayParkAgain(executionId)
          ? null
          : 'park_refused'
        : registry.hasRoom(owner, rt.instanceId)
          ? null
          : 'too_many_parked',
    offer: (a) => (adopted ? registry.awaiting(executionId, a) : firstPark(a)),
    settled: (approvalId, decision) => registry.settled(executionId, approvalId, decision),
  };

  const sandbox = runInSandbox({
    code,
    bindings: createGateBindings(deps, rt, caller, run.signal, { executionId, park }),
    limits: rt.settings.sandbox,
    // Each gated call's result was already redacted; this covers anything the script derived or logged.
    redact: rt.redact,
  });
  let first: { result: SandboxResult } | { approval: ParkedApproval };
  try {
    first = await Promise.race([
      sandbox.then((result) => ({ result })),
      parkedFirst.then((approval) => ({ approval })),
    ]);
  } catch (err) {
    stop();
    throw err;
  } finally {
    signal?.removeEventListener('abort', stop);
    release();
  }
  if ('result' in first) {
    stop();
    return first.result;
  }

  // Parked: the run outlives this tool call, under the registry's caps instead of a concurrency slot.
  registry!.adopt({ id: executionId, owner, instanceId: rt.instanceId, approval: first.approval, abort: stop });
  adopted = true;
  parkedRunning++;
  void sandbox.then(
    (result) => {
      parkedRunning--;
      stop();
      registry!.finish(executionId, result);
    },
    () => {
      parkedRunning--;
      stop();
      registry!.finish(executionId, { ok: false, error: { code: 'INTERNAL', message: 'Internal error' }, logs: [] });
    },
  );
  return pendingResult(executionId, first.approval);
}

/** `resume(executionId)` (ADR-0006): the parked run's result, or that it still waits. */
export async function resumeExecution(
  deps: GateDeps,
  rt: InstanceRuntime,
  caller: CallerContext,
  executionId: string,
  signal?: AbortSignal,
): Promise<ExecuteResult> {
  const outcome = deps.executions
    ? await deps.executions.wait(executionId, principalKey(caller), rt.instanceId, deps.executions.resumeWaitMs, signal)
    : 'not_found';
  const result: ExecuteResult =
    outcome === 'not_found'
      ? {
          ok: false,
          error: {
            code: 'EXECUTION_NOT_FOUND',
            message:
              'No parked execution with this id: it finished and was collected, expired, or the server restarted',
          },
          logs: [],
        }
      : outcome === 'busy'
        ? {
            ok: false,
            error: { code: 'BUSY', message: 'Another resume is already waiting on this execution' },
            logs: [],
          }
        : outcome;
  writeAudit(
    deps.db,
    {
      kind: 'call',
      instanceId: rt.instanceId,
      decision: 'resumed',
      actorKind: 'mcp_client',
      actorId: caller.client.id,
      resultStatus: result.ok ? 'ok' : 'status' in result ? 'pending' : 'error',
      detail: { executionId, ...(result.ok ? {} : { error: result.error.code }) },
    },
    deps.now?.() ?? new Date(),
  );
  return result;
}

type OperationRow = typeof operations.$inferSelect;

export interface CatalogFindQuery {
  text?: string;
  group?: string;
  tag?: string;
  kind?: string;
  classification?: 'read' | 'write' | 'locked';
  includeDisabled?: boolean;
  limit?: number;
}

function describeOp(
  op: OperationRow,
  groupKey: string | undefined,
  access: ReturnType<typeof effectiveAccess>,
  granted = false,
) {
  // A session grant (ADR-0006) turns Ask into auto-approval, except for locked and typed-confirmation ops.
  const mode =
    access.reachable &&
    access.mode === 'approve' &&
    granted &&
    !op.locked &&
    !op.typedConfirmation &&
    access.level === 'ask'
      ? 'auto'
      : access.reachable
        ? access.mode
        : undefined;
  return {
    key: op.key,
    displayName: op.displayName ?? undefined,
    group: groupKey,
    classification: op.locked ? 'locked' : op.classification,
    // Whether a call runs straight away, waits for a human, or is auto-approved at level `write`.
    approval: mode
      ? ({ run: 'none', approve: 'required', auto: 'auto' } as const)[mode]
      : op.locked || op.classification === 'write'
        ? 'required'
        : 'none',
    typedConfirmation: op.typedConfirmation,
    attestationRequired: op.attestationRequired,
    summary: (op.docs as { summary?: string } | null)?.summary,
    ...(access.reachable ? {} : { disabled: true, reason: access.reason }),
  };
}

function catalogBindings(
  db: Db,
  instanceId: string,
  principal: AccessPrincipal,
  granted: () => boolean,
): Record<string, Binding> {
  const load = () => {
    const { groups, live: ops } = catalogOf(db, instanceId)!;
    return { groups, ops, caps: loadCaps(db, instanceId, principal) };
  };
  const accessOf = (
    op: OperationRow,
    groups: Map<string, typeof operationGroups.$inferSelect>,
    caps: ReturnType<typeof loadCaps>,
  ) => effectiveAccess(accessInput(op), groups.get(op.groupId), principal, caps?.(op));

  return {
    find: async ([rawQuery]) => {
      const q = (rawQuery ?? {}) as CatalogFindQuery;
      const text = q.text?.toLowerCase();
      const limit = Math.min(Math.max(1, Number(q.limit) || 50), 200);
      const { groups, ops, caps } = load();
      const out = [];
      for (const op of ops) {
        const group = groups.get(op.groupId);
        const access = accessOf(op, groups, caps);
        // A non-admin never sees what their role keeps from them, not even as disabled (ADR-0010).
        if (!access.reachable && (!q.includeDisabled || caps)) continue;
        if (q.group && group?.key !== q.group) continue;
        if (q.tag && op.tag !== q.tag) continue;
        if (q.kind && op.kind !== q.kind) continue;
        const cls = op.locked ? 'locked' : op.classification;
        if (q.classification && cls !== q.classification) continue;
        if (text) {
          const hay = [op.key, op.displayName, (op.docs as { summary?: string } | null)?.summary]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(text)) continue;
        }
        out.push(describeOp(op, group?.key, access, granted()));
        if (out.length >= limit) break;
      }
      return out;
    },
    get: async ([key]) => {
      const { groups, ops, caps } = load();
      const op = ops.find((o) => o.key === key);
      if (!op) return null;
      const access = accessOf(op, groups, caps);
      if (!access.reachable && caps) return null;
      return {
        ...describeOp(op, groups.get(op.groupId)?.key, access, granted()),
        paramsSchema: op.paramsSchema,
        docs: op.docs,
      };
    },
    groups: async () => {
      // A non-admin sees only the groups that hold something they can call.
      const { groups, ops, caps } = load();
      if (!caps) return listGroups(db, instanceId).filter((g) => !g.stale);
      const open = new Set(ops.filter((op) => accessOf(op, groups, caps).reachable).map((op) => op.groupId));
      const keys = new Set([...open].map((id) => groups.get(id)?.key));
      return listGroups(db, instanceId).filter((g) => !g.stale && keys.has(g.key));
    },
  };
}

/** `guides.get(key)`: returns the current guide and the session-bound attestation key `execute` must
 * present (ADR-0003); every read is audited. */
function guideBindings(deps: GateDeps, rt: InstanceRuntime, caller: CallerContext): Record<string, Binding> {
  return {
    get: async ([key]) => {
      const op = deps.db
        .select()
        .from(operations)
        .where(
          and(eq(operations.instanceId, rt.instanceId), eq(operations.key, String(key)), eq(operations.stale, false)),
        )
        .get();
      const caps = op && loadCaps(deps.db, rt.instanceId, caller.principal);
      const group = op && deps.db.select().from(operationGroups).where(eq(operationGroups.id, op.groupId)).get();
      // A role never learns of an operation it keeps from the caller, nor gets its key (ADR-0003, ADR-0010).
      if (!op || (caps && !effectiveAccess(accessInput(op), group, caller.principal, caps(op)).reachable))
        throw new BindingError('UNKNOWN_OPERATION', `${String(key)} is not in the catalog`);
      if (!op.attestationRequired) return { key: op.key, required: false };
      let guide;
      try {
        await rt.start?.();
        guide = await rt.plugin().call('getGuide', { key: op.key });
      } catch {
        throw new BindingError('PLUGIN_ERROR', `Could not load the guide for ${op.key}`);
      }
      const current = currentGuide(deps.db, rt.instanceId, op.id);
      if (!current || current.version !== guide.version || current.content !== guide.content) {
        deps.db
          .insert(guides)
          .values({
            id: randomUUID(),
            instanceId: rt.instanceId,
            operationId: op.id,
            version: guide.version,
            content: guide.content,
            fetchedAt: deps.now?.() ?? new Date(),
          })
          .run();
      }
      writeAudit(
        deps.db,
        {
          kind: 'search',
          instanceId: rt.instanceId,
          operationKey: op.key,
          decision: 'guide_read',
          actorKind: 'mcp_client',
          actorId: caller.client.id ?? null,
          detail: { guideVersion: guide.version, mcpSessionId: caller.mcpSessionId ?? null },
        },
        deps.now?.() ?? new Date(),
      );
      return {
        key: op.key,
        required: true,
        version: guide.version,
        content: guide.content,
        best_practice_key: issueAttestationKey(
          deps.attestationKey,
          rt.instanceId,
          op.key,
          guide.version,
          caller.mcpSessionId,
        ),
      };
    },
  };
}

function searchBindings(
  deps: GateDeps,
  rt: InstanceRuntime,
  caller: CallerContext,
): Record<string, Record<string, Binding>> {
  const bindings: Record<string, Record<string, Binding>> = {
    catalog: catalogBindings(
      deps.db,
      rt.instanceId,
      caller.principal,
      () => !!deps.grants?.active(rt.instanceId, principalKey(caller)),
    ),
  };
  if (rt.manifest.capabilities.registry) {
    bindings.registry = {
      find: async ([q]) =>
        // Mirrored upstream attributes can hold tokens (an `access_token`, say): redact at the source.
        rt.redact(findRegistryEntries(deps.db, rt.instanceId, (q ?? {}) as Parameters<typeof findRegistryEntries>[2])),
    };
  }
  if (rt.manifest.capabilities.attestation) bindings.guides = guideBindings(deps, rt, caller);
  return bindings;
}

export async function searchCode(
  deps: GateDeps,
  rt: InstanceRuntime,
  caller: CallerContext,
  code: string,
  signal?: AbortSignal,
): Promise<SandboxResult> {
  const release = await admit(deps, rt, caller, signal);
  if (typeof release !== 'function') return release;
  let result: SandboxResult;
  try {
    result = await runInSandbox({
      code,
      bindings: searchBindings(deps, rt, caller),
      limits: rt.settings.sandbox,
      redact: rt.redact,
    });
  } finally {
    release();
  }
  writeAudit(
    deps.db,
    {
      kind: 'search',
      instanceId: rt.instanceId,
      actorKind: 'mcp_client',
      actorId: caller.client.id,
      resultStatus: result.ok ? 'ok' : 'error',
      detail: result.ok ? { truncated: result.truncated } : { error: result.error.code },
    },
    deps.now?.() ?? new Date(),
  );
  return result;
}
