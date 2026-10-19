import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { auditLog, notifierChannels } from '../src/db/schema.js';
import { createTestApp } from './helpers.js';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function setup() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-notify-'));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const sent: Sent[] = [];
  const ctx = await createTestApp(
    {
      DATA_DIR: dataDir,
      PUBLIC_MCP_URL: 'https://mcp.example.com/',
    },
    {
      memoryDb: true,
      notifyRetryDelaysMs: [1, 1],
      notifyFetch: async (url, init) => {
        sent.push({ url, headers: init.headers, body: init.body });
        return { ok: true, status: 200 };
      },
    },
  );
  cleanup.push(() => ctx.stop());
  return { ctx, sent };
}

/** Waits for async fan-out (dispatch is fire-and-forget from event handlers). */
async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}

describe('notification channels', () => {
  it('stores secrets encrypted, reports only whether they are set, and merges updates', async () => {
    const { ctx } = await setup();
    const ch = ctx.notifier.save({
      kind: 'ntfy',
      name: 'Phone',
      config: { topic: 'homelab' },
      secrets: { token: 'tk_secret' },
      events: ['instance.error'],
    });
    expect(ch.secrets).toEqual({ token: { set: true } });
    expect(JSON.stringify(ctx.notifier.list())).not.toContain('tk_secret');
    const raw = ctx.db.select().from(notifierChannels).get()!;
    expect(raw.secretsEnc!.toString('utf8')).not.toContain('tk_secret');

    // Omitted secrets are kept; null clears.
    expect(ctx.notifier.save({ name: 'Phone 2' }, { id: ch.id }).secrets).toEqual({ token: { set: true } });
    expect(ctx.notifier.save({ secrets: { token: null } }, { id: ch.id }).secrets).toEqual({ token: { set: false } });
    expect(() => ctx.notifier.save({ kind: 'webhook', config: { url: 'https://x' } }, { id: ch.id })).toThrow(/kind/);
    expect(() =>
      ctx.notifier.save({ kind: 'ntfy', name: 'x', config: { topic: 'bad topic!' }, events: ['instance.error'] }),
    ).toThrow(/Invalid channel/);
    const audit = ctx.db.select().from(auditLog).where(eq(auditLog.kind, 'config')).all();
    expect(audit.map((a) => a.decision)).toEqual(['notifier_created', 'notifier_updated', 'notifier_updated']);
    expect(JSON.stringify(audit)).not.toContain('tk_secret');
  });

  it('publishes ntfy JSON, and has no approval events or links', async () => {
    const { ctx, sent } = await setup();
    ctx.notifier.save({
      kind: 'ntfy',
      name: 'Phone',
      config: { server: 'https://ntfy.example.com/', topic: 'homelab' },
      secrets: { token: 'tk' },
      events: ['sync.pending_review'],
    });
    ctx.events.emit('sync.completed', { instanceId: 'i', slug: 'nas', added: 0, pendingReview: [], newGroups: [] });
    ctx.events.emit('sync.completed', {
      instanceId: 'i',
      slug: 'nas',
      added: 1,
      pendingReview: ['store.create'],
      newGroups: [],
    });
    await until(() => sent.length === 1);
    expect(JSON.parse(sent[0]!.body)).toMatchObject({
      topic: 'homelab',
      title: '1 write operation(s) to review on /nas',
    });
    expect(sent[0]!.url).toBe('https://ntfy.example.com');
    expect(sent[0]!.headers.authorization).toBe('Bearer tk');

    expect(JSON.parse(sent[0]!.body)).not.toHaveProperty('actions');

    // Rules a sync disabled are reported even when no write needs review.
    ctx.events.emit('sync.completed', {
      instanceId: 'i',
      slug: 'nas',
      added: 0,
      pendingReview: [],
      newGroups: [],
      rulesDisabled: 2,
    });
    await until(() => sent.length === 2);
    expect(JSON.parse(sent[1]!.body)).toMatchObject({ title: 'Pre-approval rules disabled on /nas' });
    expect(JSON.parse(sent[1]!.body).message).toMatch(/2 pre-approval rule\(s\) no longer fit/);

    // Approvals happen in the MCP client (design §5.3); channels can't subscribe to them.
    expect(() =>
      ctx.notifier.save({ kind: 'ntfy', name: 'x', config: { topic: 't' }, events: ['approval.pending'] }),
    ).toThrow(/Invalid channel/);
    // A channel saved before that change keeps working; the stale event is dropped.
    const old = ctx.notifier.save({ kind: 'ntfy', name: 'Old', config: { topic: 't' }, events: ['auth.lockout'] });
    ctx.db
      .update(notifierChannels)
      .set({ events: ['approval.pending', 'auth.lockout'] })
      .where(eq(notifierChannels.id, old.id))
      .run();
    expect(ctx.notifier.list().find((c) => c.id === old.id)?.events).toEqual(['auth.lockout']);
    expect(ctx.notifier.save({ name: 'Old 2' }, { id: old.id }).events).toEqual(['auth.lockout']);
  });
});
