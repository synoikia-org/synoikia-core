import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { opKey } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';
import { admin, auditRows } from './administration.js';

When('the admin reads the audit log', async (world: SynoikiaWorld) => {
  admin(world).found = await auditRows(world, {});
});

Then(
  'the new credential of agent {word} shows the actor {string}, while the read of agent {word} and the first account show no user name',
  (world: SynoikiaWorld, agent: string, name: string) => {
    const rows = admin(world).found;
    const made = rows.find((r) => r.decision === 'mcp_token_created' && r.detail?.name === `agent ${agent}`);
    expect(made).toMatchObject({ actorKind: 'user', actorName: name });
    const read = rows.find((r) => r.kind === 'call' && r.operationKey === opKey('show the open tasks'));
    expect(read).toMatchObject({ actorKind: 'mcp_client', actorId: `token:agent ${agent}`, actorName: null });
    const first = rows.find((r) => r.decision === 'user_created' && r.detail?.username === name);
    expect(first).toMatchObject({ actorKind: 'system', actorName: null });
  },
);

Then('both times the admin finds only what the admin did in the portal', (world: SynoikiaWorld) => {
  const { found, csv } = admin(world);
  const adminId = world.person('admin').id;
  expect(found.length).toBeGreaterThan(3);
  expect(found.map((r) => r.decision)).toEqual(expect.arrayContaining(['login', 'mcp_token_created']));
  for (const r of found) expect(r).toMatchObject({ actorKind: 'user', actorId: adminId, actorName: 'admin' });
  const lines = csv.trimEnd().split('\n').slice(1);
  expect(lines).toHaveLength(found.length);
  for (const line of lines) expect(line).toContain(`,user,${adminId},admin,false,`);
});

Given(
  'agent {word} tried {int} counts and {int} reads of {string} in quick runs, while the group {string} was off',
  async (world: SynoikiaWorld, agent: string, counts: number, reads: number, list: string, group: string) => {
    await world.setGroupLevel(world.lastInstance, group, 'none');
    for (const [key, times] of [
      [opKey('count the tasks'), counts],
      [opKey('show the open tasks'), reads],
    ] as const) {
      for (let left = times; left > 0; left -= 250) {
        const n = Math.min(250, left);
        await world.execute(
          agent,
          world.lastInstance,
          `const args = { list: ${JSON.stringify(list)} };\n` +
            `await Promise.allSettled(Array.from({ length: ${n} }, () => tasks.call(${JSON.stringify(key)}, args)));\n` +
            `return ${n};`,
        );
        expect(world.answer).toMatchObject({ result: n });
      }
    }
  },
);

const exportOf = async (world: SynoikiaWorld, query: Record<string, string>) => {
  const res = await world.admin.get(`/api/audit/export.csv?${new URLSearchParams(query).toString()}`);
  expect(res.headers.get('content-type')).toContain('text/csv');
  return (await res.text()).trimEnd().split('\n');
};

When('the admin exports the calls of the audit log', async (world: SynoikiaWorld) => {
  const s = admin(world);
  s.seen.calls = await exportOf(world, { kind: 'call' });
  s.seen.counts = await exportOf(world, { kind: 'call', operation: opKey('count the tasks') });
});

Then(
  'the export has {int} calls, each once and newest first, and the export of the counts alone has {int}',
  (world: SynoikiaWorld, total: number, counts: number) => {
    const s = admin(world);
    const lines = s.seen.calls as string[];
    expect(lines[0]).toMatch(/^id,at,kind,/);
    const rows = lines.slice(1).map((l) => {
      const [id, at] = l.split(',');
      return { id: Number(id), at: Date.parse(at!) };
    });
    expect(rows).toHaveLength(total);
    expect(new Set(rows.map((r) => r.id)).size).toBe(total);
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1]!, rows[i]!];
      expect(a.at > b.at || (a.at === b.at && a.id > b.id)).toBe(true);
    }
    expect((s.seen.counts as string[]).length - 1).toBe(counts);
  },
);

When('the admin sets the idle limit of the portal to {int} minutes', async (world: SynoikiaWorld, minutes: number) => {
  await world.expectOk(
    world.admin.put('/api/settings/security', { sessionIdleMinutes: minutes }),
    'set the idle limit',
  );
});

Then(
  'the audit log shows the idle limit {int} before and {int} after, under changes of configuration',
  async (world: SynoikiaWorld, before: number, after: number) => {
    const rows = await auditRows(world, { kind: 'config', decision: 'settings_updated' });
    expect(rows[0]).toMatchObject({
      actorName: 'admin',
      detail: {
        section: 'security',
        before: expect.objectContaining({ sessionIdleMinutes: before }) as unknown,
        after: expect.objectContaining({ sessionIdleMinutes: after }) as unknown,
      },
    });
  },
);

When(
  'the admin adds a notification channel with the token {string} and then gives it the token {string}',
  async (world: SynoikiaWorld, first: string, second: string) => {
    const channel = {
      kind: 'ntfy',
      name: 'Phone',
      config: { server: 'https://ntfy.example', topic: 'synoikia-admin' },
      events: ['sync.failed'],
    };
    const made = await world.expectOk(
      world.admin.post('/api/notifiers', { ...channel, secrets: { token: first } }),
      'add channel',
    );
    await world.expectOk(
      world.admin.patch(`/api/notifiers/${made.id as string}`, { ...channel, secrets: { token: second } }),
      'change channel',
    );
    admin(world).seen.tokens = [first, second];
  },
);

Then('the audit log shows both changes of the channel, but never a token', async (world: SynoikiaWorld) => {
  const rows = await auditRows(world, { kind: 'config', decision: 'notifier_' });
  expect(rows.map((r) => r.decision)).toEqual(['notifier_updated', 'notifier_created']);
  for (const r of rows) expect(r.detail).toMatchObject({ secretsChanged: ['token'] });
  const everything = JSON.stringify(await auditRows(world, {}));
  const csv = await (await world.admin.get('/api/audit/export.csv')).text();
  for (const token of admin(world).seen.tokens as string[]) {
    expect(everything).not.toContain(token);
    expect(csv).not.toContain(token);
  }
});
