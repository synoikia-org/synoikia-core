import { sql } from 'drizzle-orm';
import type { DbLike } from './db/index.js';
import { auditLog } from './db/schema.js';

export type AuditEvent = Omit<typeof auditLog.$inferInsert, 'id' | 'at'>;

/** Append-only (ADR-0017): this module only ever inserts. */
export function writeAudit(db: DbLike, event: AuditEvent, at: Date = new Date()): void {
  let insert = inserts.get(db);
  if (!insert) inserts.set(db, (insert = prepareInsert(db)));
  insert.run({ ...EMPTY, ...event, at });
}

// ADR-0021: an audit row is written on each call, so its insert is prepared once for each handle.
const EMPTY = {
  instanceId: null,
  operationKey: null,
  classification: null,
  decision: null,
  actorId: null,
  decidedBy: null,
  decidedVia: null,
  params: null,
  resolvedTargets: null,
  resultStatus: null,
  durationMs: null,
  detail: null,
};
const prepareInsert = (db: DbLike) =>
  db
    .insert(auditLog)
    .values({
      at: sql.placeholder('at'),
      kind: sql.placeholder('kind'),
      instanceId: sql.placeholder('instanceId'),
      operationKey: sql.placeholder('operationKey'),
      classification: sql.placeholder('classification'),
      decision: sql.placeholder('decision'),
      actorKind: sql.placeholder('actorKind'),
      actorId: sql.placeholder('actorId'),
      decidedBy: sql.placeholder('decidedBy'),
      decidedVia: sql.placeholder('decidedVia'),
      params: sql.placeholder('params'),
      resolvedTargets: sql.placeholder('resolvedTargets'),
      resultStatus: sql.placeholder('resultStatus'),
      durationMs: sql.placeholder('durationMs'),
      detail: sql.placeholder('detail'),
    })
    .prepare();
const inserts = new WeakMap<DbLike, ReturnType<typeof prepareInsert>>();
