import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { applyCatalogSync } from '../src/catalog/sync.js';
import { listGroups, mergeGroups, resolveAccess, setGroupLevel, updateOperation } from '../src/catalog/groups.js';
import { auditLog, operationGroups, operations, pluginInstances, preApprovalRules } from '../src/db/schema.js';
import { catalog, op, seedInstance } from './helpers.js';

const opRow = (db: ReturnType<typeof seedInstance>['db'], key: string) =>
  db.select().from(operations).where(eq(operations.key, key)).get()!;

describe('applyCatalogSync', () => {
  it('creates groups at ask, classifies, and quarantines new writes', () => {
    const { db, instanceId } = seedInstance();
    const summary = applyCatalogSync(
      db,
      instanceId,
      catalog(op('app.query'), op('app.upgrade'), op('app.delete', { locked: true }), op('store.query')),
    );

    expect(summary).toMatchObject({
      added: 4,
      newGroups: ['app', 'store'],
      pendingReview: ['app.upgrade', 'app.delete'],
    });
    expect(listGroups(db, instanceId).map((g) => [g.key, g.level])).toEqual([
      ['app', 'ask'],
      ['store', 'ask'],
    ]);
    // Operations in a brand-new group follow it.
    expect(opRow(db, 'app.upgrade').levelOverride).toBeNull();
    expect(opRow(db, 'app.delete')).toMatchObject({
      classification: 'write',
      classificationSource: 'locked',
      typedConfirmation: true,
    });
    expect(resolveAccess(db, instanceId, 'app.query')).toEqual({ reachable: true, mode: 'run', level: 'read' });
    expect(resolveAccess(db, instanceId, 'app.upgrade')).toEqual({ reachable: true, mode: 'approve', level: 'ask' });
    expect(resolveAccess(db, instanceId, 'app.delete')).toEqual({ reachable: false, reason: 'locked_not_opted_in' });

    const instance = db.select().from(pluginInstances).where(eq(pluginInstances.id, instanceId)).get();
    expect(instance).toMatchObject({ upstreamVersion: '25.10.7', lastSyncStatus: 'ok' });
    expect(
      db
        .select()
        .from(auditLog)
        .all()
        .map((a) => a.decision),
    ).toEqual(['catalog_synced']);
  });

  it('always takes read or write from the plugin, narrowing own levels that no longer fit', () => {
    const { db, instanceId } = seedInstance();
    applyCatalogSync(
      db,
      instanceId,
      catalog(op('app.status', { classification: 'read' }), op('app.info', { classification: 'read' })),
    );
    updateOperation(db, instanceId, opRow(db, 'app.status').id, { level: 'read' });
    updateOperation(db, instanceId, opRow(db, 'app.info').id, { level: 'ask' });

    applyCatalogSync(
      db,
      instanceId,
      catalog(op('app.status', { classification: 'write' }), op('app.info', { classification: 'write' })),
    );
    expect(opRow(db, 'app.status')).toMatchObject({
      classification: 'write',
      classificationSource: 'inferred',
      levelOverride: 'none',
    });
    expect(opRow(db, 'app.info')).toMatchObject({ classification: 'write', levelOverride: 'ask' });

    applyCatalogSync(
      db,
      instanceId,
      catalog(op('app.status', { locked: true }), op('app.info', { classification: 'write' })),
    );
    expect(opRow(db, 'app.status')).toMatchObject({ classification: 'write', classificationSource: 'locked' });
  });

  it('keeps an operation the plugin moves to another group at the access it had', () => {
    const { db, instanceId } = seedInstance();
    applyCatalogSync(db, instanceId, catalog(op('app.query'), op('app.upgrade'), op('app.stop')));
    setGroupLevel(db, instanceId, 'app', 'none');
    db.insert(preApprovalRules)
      .values({ id: randomUUID(), instanceId, operationId: opRow(db, 'app.upgrade').id, reason: 'old rule' })
      .run();

    // A plugin update moves app.upgrade into a brand-new group, which starts at Ask.
    applyCatalogSync(
      db,
      instanceId,
      catalog(op('app.query'), op('app.upgrade', { group: 'lifecycle' }), op('app.stop')),
    );
    expect(listGroups(db, instanceId).find((g) => g.key === 'lifecycle')?.level).toBe('ask');
    expect(opRow(db, 'app.upgrade').levelOverride).toBe('none');
    expect(resolveAccess(db, instanceId, 'app.upgrade')).toEqual({ reachable: false, reason: 'level_none' });

    // Moving into a group where it would have the same access needs no exception.
    setGroupLevel(db, instanceId, 'lifecycle', 'ask');
    setGroupLevel(db, instanceId, 'app', 'ask');
    applyCatalogSync(
      db,
      instanceId,
      catalog(op('app.query'), op('app.upgrade'), op('app.stop', { group: 'lifecycle' })),
    );
    expect(opRow(db, 'app.stop').levelOverride).toBeNull();
    expect(resolveAccess(db, instanceId, 'app.stop')).toMatchObject({ mode: 'approve', level: 'ask' });
  });

  it('applies admin group aliases on every sync', () => {
    const { db, instanceId } = seedInstance();
    applyCatalogSync(db, instanceId, catalog(op('app.query'), op('app.image.query')));
    mergeGroups(db, instanceId, { from: ['app.image'], into: 'app' });
    applyCatalogSync(db, instanceId, catalog(op('app.query'), op('app.image.query'), op('app.image.pull')));
    expect(listGroups(db, instanceId).map((g) => g.key)).toEqual(['app']);
    const appGroup = db.select().from(operationGroups).get()!;
    expect(opRow(db, 'app.image.pull').groupId).toBe(appGroup.id);
  });

  it("stores each operation's declared result secrets, and updates them on later syncs", () => {
    const { db, instanceId } = seedInstance();
    applyCatalogSync(
      db,
      instanceId,
      catalog(op('key.create', { sensitiveResult: { keys: ['key'] } }), op('token.make', { sensitiveResult: 'whole' })),
    );
    expect(opRow(db, 'key.create').sensitiveResult).toEqual({ keys: ['key'], deep: false });
    expect(opRow(db, 'token.make').sensitiveResult).toBe('whole');

    applyCatalogSync(db, instanceId, catalog(op('key.create'), op('token.make', { sensitiveResult: 'whole' })));
    expect(opRow(db, 'key.create').sensitiveResult).toBeNull();
  });
});
