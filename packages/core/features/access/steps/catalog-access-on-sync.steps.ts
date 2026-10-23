import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { opKey } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

type Groups = Awaited<ReturnType<SynoikiaWorld['groups']>>;
const seen = new WeakMap<SynoikiaWorld, { groups?: Groups; dropped?: string[] }>();
const of = (world: SynoikiaWorld) => {
  let s = seen.get(world);
  if (!s) seen.set(world, (s = {}));
  return s;
};

type Operation = Awaited<ReturnType<SynoikiaWorld['operation']>> & {
  group: string | null;
  classification: string;
  classificationSource: string;
  stale: boolean;
  reachable: boolean;
  reason: string | null;
};
const operation = async (world: SynoikiaWorld, name: string) =>
  (await world.operations(world.lastInstance)).find((o) => o.key === opKey(name)) as Operation | undefined;

/** The plugin changes its catalog, and the admin syncs the instance. */
const changeAndSync = async (
  world: SynoikiaWorld,
  slug: string,
  change: Parameters<SynoikiaWorld['changeCatalog']>[0],
) => {
  world.changeCatalog(change);
  await world.sync(slug);
};

// ── the plugin changes its catalog ──

When(
  /^the plugin of "([^"]+)" adds the (read|write) "([^"]+)" to the group "([^"]+)", and the admin syncs "([^"]+)"$/,
  async (world: SynoikiaWorld, _plugin: string, kind: 'read' | 'write', name: string, group: string, slug: string) => {
    await changeAndSync(world, slug, { add: [{ name, group, classification: kind }] });
  },
);

When(
  'the plugin of {string} makes {string} a write, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, name: string, slug: string) => {
    await changeAndSync(world, slug, { change: { [name]: { classification: 'write' } } });
  },
);

When(
  'the plugin of {string} changes the parameters of {string}, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, name: string, slug: string) => {
    const paramsSchema = {
      type: 'object',
      properties: { list: { type: 'string' }, title: { type: 'string' }, due: { type: 'string' } },
      required: ['list', 'title', 'due'],
    };
    await changeAndSync(world, slug, { change: { [name]: { paramsSchema } } });
  },
);

When(
  'the plugin of {string} locks {string}, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, name: string, slug: string) => {
    await changeAndSync(world, slug, { change: { [name]: { locked: true } } });
  },
);

When(
  'the plugin of {string} moves {string} to the new group {string}, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, name: string, group: string, slug: string) => {
    await changeAndSync(world, slug, { change: { [name]: { group } } });
  },
);

When(
  'the plugin of {string} moves {string} to the group {string}, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, name: string, group: string, slug: string) => {
    await changeAndSync(world, slug, { change: { [name]: { group } } });
  },
);

When(
  'the plugin of {string} unlocks {string} and moves it to the group {string}, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, name: string, group: string, slug: string) => {
    await changeAndSync(world, slug, { change: { [name]: { locked: false, group } } });
  },
);

Given(
  'the plugin of {string} drops {string}, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, name: string, slug: string) => {
    await changeAndSync(world, slug, { remove: [name] });
  },
);

Given(
  'the plugin of {string} drops {string}, {string} and {string}, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, a: string, b: string, c: string, slug: string) => {
    await changeAndSync(world, slug, { remove: [a, b, c] });
    of(world).dropped = [a, b, c];
    of(world).groups = await world.groups(slug);
  },
);

When(
  'the plugin of {string} brings them back, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, slug: string) => {
    await changeAndSync(world, slug, { restore: of(world).dropped });
  },
);

When(
  'the plugin of {string} brings {string} back, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, name: string, slug: string) => {
    await changeAndSync(world, slug, { restore: [name] });
  },
);

Given(
  'the plugin of {string} no longer declares it, and the admin syncs {string}',
  async (world: SynoikiaWorld, _plugin: string, slug: string) => {
    world.pluginFlag('secret-result', 'null');
    await world.sync(slug);
  },
);

// ── the admin ──

Given('the admin acknowledges {string}', async (world: SynoikiaWorld, name: string) => {
  await world.acknowledge(world.lastInstance, name, true);
});

When('the admin sets every group of {string} to {word}', async (world: SynoikiaWorld, slug: string, level: string) => {
  const id = await world.tasksInstance(slug);
  await world.expectOk(world.admin.post(`/api/instances/${id}/groups/bulk-level`, { level }), 'set every group');
});

When(
  'the admin merges the group {string} into {string}, and syncs {string}',
  async (world: SynoikiaWorld, from: string, into: string, slug: string) => {
    const id = await world.tasksInstance(slug);
    await world.expectOk(world.admin.post(`/api/instances/${id}/groups/merge`, { from: [from], into }), 'merge');
    await world.sync(slug);
  },
);

// ── what the admin and the agent see ──

Then(
  'the admin sees that {string} has its own level {word}, and is not acknowledged',
  async (world: SynoikiaWorld, name: string, level: string) => {
    expect(await operation(world, name)).toMatchObject({ levelOverride: level, writeAcknowledged: false });
  },
);

Then(
  'the admin sees that {string} has its own level {word}',
  async (world: SynoikiaWorld, name: string, level: string) => {
    expect(await operation(world, name)).toMatchObject({ levelOverride: level, level });
  },
);

Then(
  'the admin sees that {string} is locked and off, with no own level',
  async (world: SynoikiaWorld, name: string) => {
    expect(await operation(world, name)).toMatchObject({
      classificationSource: 'locked',
      levelOverride: null,
      reachable: false,
      reason: 'locked_not_opted_in',
    });
  },
);

Then(
  'the admin sees that the rule on {string} is off, and the audit log says that the lock turned it off',
  async (world: SynoikiaWorld, name: string) => {
    const id = await world.tasksInstance(world.lastInstance);
    const rules = (await world.expectOk(world.admin.get(`/api/instances/${id}/rules`), 'list rules')) as unknown as {
      enabled: boolean;
    }[];
    expect(rules.map((r) => r.enabled)).toEqual([false]);
    const rows = await world.audit({ decision: 'rules_disabled_operation_locked' });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).toContain(opKey(name));
  },
);

Then('the admin sees that {string} is a locked write, and is off', async (world: SynoikiaWorld, name: string) => {
  expect(await operation(world, name)).toMatchObject({
    classification: 'write',
    classificationSource: 'locked',
    reachable: false,
    reason: 'locked_not_opted_in',
  });
});

Then(
  'the admin sees that {string} has its own level {word}, in the group {string} at level {word}',
  async (world: SynoikiaWorld, name: string, level: string, group: string, groupLevel: string) => {
    expect(await operation(world, name)).toMatchObject({ levelOverride: level, level, group });
    expect((await world.groups(world.lastInstance)).find((g) => g.key === group)).toMatchObject({ level: groupLevel });
  },
);

Then('the admin sees that {string} is at level {word}', async (world: SynoikiaWorld, name: string, level: string) => {
  expect(await operation(world, name)).toMatchObject({ level, reachable: false, reason: 'level_none' });
});

Then(
  'the admin sees {string} as stale, and agent {word} is told that it is not in the catalog',
  async (world: SynoikiaWorld, name: string) => {
    const id = await world.tasksInstance(world.lastInstance);
    const stale = (await world.expectOk(
      world.admin.get(`/api/instances/${id}/operations?stale=1`),
      'list operations',
    )) as unknown as Operation[];
    expect(stale.find((o) => o.key === opKey(name))).toMatchObject({ stale: true });
    expect(await operation(world, name)).toBeUndefined();
    expect(world.answer).toMatchObject({ message: expect.stringContaining('is not in the current catalog') as string });
  },
);

Then(
  'the admin saw the group {string} as stale, and now sees it at level {word} again',
  async (world: SynoikiaWorld, group: string, level: string) => {
    expect(of(world).groups!.find((g) => g.key === group)).toMatchObject({ stale: true, level });
    expect((await world.groups(world.lastInstance)).find((g) => g.key === group)).toMatchObject({
      stale: false,
      level,
    });
  },
);

Then(
  'the admin sees the {int} writes that are not locked as acknowledged, and {string} and {string} as off',
  async (world: SynoikiaWorld, count: number, first: string, second: string) => {
    const ops = (await world.operations(world.lastInstance)) as Operation[];
    const writes = ops.filter((o) => o.classification === 'write' && o.classificationSource !== 'locked');
    expect(writes).toHaveLength(count);
    for (const w of writes) expect(w).toMatchObject({ writeAcknowledged: true, mode: 'auto' });
    for (const name of [first, second])
      expect(ops.find((o) => o.key === opKey(name))).toMatchObject({ reachable: false });
  },
);

Then(
  'the admin sees only the group {string}, at level {word}, with {string} in it',
  async (world: SynoikiaWorld, group: string, level: string, name: string) => {
    const groups = await world.groups(world.lastInstance);
    expect(groups.map((g) => [g.key, g.level])).toEqual([[group, level]]);
    expect(await operation(world, name)).toMatchObject({ group });
  },
);
