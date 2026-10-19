import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { rotateMasterKeyCommand } from '../src/cli.js';
import { auditLog, preApprovalHits, sessions, settings } from '../src/db/schema.js';
import { runHousekeeping } from '../src/maintenance.js';
import { getSettings, updateSettings } from '../src/settings.js';
import { createTestApp } from './helpers.js';

const PASSWORD = 'correct horse battery';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function env(dataDir: string, extra: Record<string, string> = {}) {
  return { DATA_DIR: dataDir, ...extra };
}

async function open(dataDir: string, extra: Record<string, string> = {}, now?: () => Date) {
  const ctx = await createTestApp(env(dataDir, extra), { now });
  return ctx;
}

describe('housekeeping', () => {
  it('purges expired state and audit rows past the retention, which defaults to 90 days', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-maint-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    let now = new Date(); // audit rows are stamped with the real clock
    const ctx = await open(dataDir, {}, () => now);
    cleanup.push(() => ctx.stop());
    const user = await ctx.users.create({ username: 'admin', password: PASSWORD });
    ctx.sessions.create(user.id, 'admin', { idleMs: 60_000, absoluteMs: 60_000 }, {});
    const rule = { id: 'r1' };
    ctx.db.$client.exec(`PRAGMA foreign_keys = OFF`);
    ctx.db.insert(preApprovalHits).values({ ruleId: rule.id, occurredAt: now }).run();
    ctx.db.$client.exec(`PRAGMA foreign_keys = ON`);
    expect(getSettings(ctx.db, 'audit').retentionDays).toBe(90);

    now = new Date(now.getTime() + 30 * 86_400_000);
    expect(runHousekeeping(ctx)).toMatchObject({ sessions: 1, preApprovalHits: 1, audit: 0 });
    expect(ctx.db.select().from(sessions).all()).toHaveLength(0);

    // An explicit null keeps every row.
    updateSettings(ctx.db, 'audit', { retentionDays: null }, {});
    const auditBefore = ctx.db.select().from(auditLog).all().length;
    now = new Date(now.getTime() + 70 * 86_400_000);
    expect(runHousekeeping(ctx).audit).toBe(0);
    expect(ctx.db.select().from(auditLog).all().length).toBe(auditBefore);

    // A stored section without the key (never saved) takes the 90-day default.
    ctx.db.update(settings).set({ value: {} }).where(eq(settings.key, 'audit')).run();
    expect(runHousekeeping(ctx).audit).toBeGreaterThanOrEqual(auditBefore);
    const left = ctx.db.select().from(auditLog).all();
    expect(left.map((a) => a.decision)).toContain('audit_purged');
    expect(left.every((a) => a.at.getTime() > now.getTime() - 90 * 86_400_000)).toBe(true);
  });
});

describe('rotate-master-key', () => {
  async function seeded(extra: Record<string, string> = {}) {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-rotate-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const ctx = await open(dataDir, extra);
    const user = await ctx.users.create({ username: 'admin', password: PASSWORD });
    const { secret } = ctx.users.beginTotp(user.id);
    const inst = await ctx.instances.create({ pluginId: 'echo', slug: 'echo', connection: { token: 'tok-123' } });
    const ch = ctx.notifier.save({
      kind: 'ntfy',
      name: 'n',
      config: { topic: 't' },
      secrets: { token: 'nt' },
      events: ['auth.lockout'],
    });
    ctx.sessions.create(user.id, 'admin', { idleMs: 60_000, absoluteMs: 60_000 }, {});
    await ctx.stop();
    return { dataDir, userId: user.id, secret, instanceId: inst.id, channelId: ch.id };
  }

  it('with MASTER_KEY in the environment, requires NEW_MASTER_KEY and changes nothing on a wrong key', async () => {
    const oldKey = randomBytes(32).toString('base64');
    const s = await seeded({ MASTER_KEY: oldKey });
    expect(() => rotateMasterKeyCommand(env(s.dataDir, { MASTER_KEY: oldKey }), () => undefined)).toThrow(
      /NEW_MASTER_KEY/,
    );

    const newKey = randomBytes(32).toString('base64');
    const wrong = randomBytes(32).toString('base64');
    expect(() =>
      rotateMasterKeyCommand(env(s.dataDir, { MASTER_KEY: wrong, NEW_MASTER_KEY: newKey }), () => undefined),
    ).toThrow(/decrypt/);
    // Still readable with the old key: the failed run changed nothing.
    const still = await open(s.dataDir, { MASTER_KEY: oldKey });
    expect(still.instances.getConnection(s.instanceId).secrets).toMatchObject({ token: { set: true } });
    await still.stop();

    rotateMasterKeyCommand(env(s.dataDir, { MASTER_KEY: oldKey, NEW_MASTER_KEY: newKey }), () => undefined);
    expect(existsSync(path.join(s.dataDir, 'master.key'))).toBe(false);
    const ctx = await open(s.dataDir, { MASTER_KEY: newKey });
    cleanup.push(() => ctx.stop());
    expect(ctx.notifier.list()[0]!.secrets).toEqual({ token: { set: true } });
    const row = ctx.db.select().from(auditLog).where(eq(auditLog.kind, 'config')).all();
    expect(row.length).toBeGreaterThan(0);
  });
});
