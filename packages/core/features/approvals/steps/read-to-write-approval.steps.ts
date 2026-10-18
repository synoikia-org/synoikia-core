import { Given, Then } from 'quickpickle';
import { expect } from 'vitest';
import { opKey } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

Given(
  'agent {word} waits for the admin to approve the count of {string}, which has its own level ask',
  async (world: SynoikiaWorld, agent: string, list: string) => {
    await world.setOperationLevel(world.lastInstance, 'count the tasks', 'ask');
    await world.call(agent, 'count the tasks', { list });
    expect(world.answer).toMatchObject({ status: 'awaiting_approval' });
  },
);

Given(
  'the plugin of {string} now calls {string} a write, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, _name: string, slug: string) => {
    world.pluginFlag('count-is-write');
    await world.sync(slug);
  },
);

Given(
  'the plugin of {string} now asks to type a confirmation for {string}, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, name: string, slug: string) => {
    world.changeCatalog({ change: { [name]: { typedConfirmation: true } } });
    await world.sync(slug);
    const op = (await world.operation(world.lastInstance, name)) as unknown as { typedConfirmation: boolean };
    expect(op.typedConfirmation).toBe(true);
  },
);

Then(
  'agent {word} is told that {string} changed while it waited for approval',
  (world: SynoikiaWorld, _agent: string, name: string) => {
    expect(world.answer).toEqual({
      error: 'OPERATION_CHANGED',
      message: `${opKey(name)} changed while it waited for approval; call it again`,
    });
  },
);

Then(
  'the audit log records the approved count as refused, while the admin sees {string} as a write',
  async (world: SynoikiaWorld, name: string) => {
    const rows = (await world.audit({ kind: 'call', operation: opKey(name) })) as {
      decision: string;
      classification?: string | null;
    }[];
    expect(rows.map((r) => [r.decision, r.classification])).toEqual([
      ['rejected:operation_changed', 'read'],
      ['awaiting_approval', 'read'],
    ]);
    const op = (await world.operation(world.lastInstance, name)) as unknown as { classification: string };
    expect(op.classification).toBe('write');
  },
);
