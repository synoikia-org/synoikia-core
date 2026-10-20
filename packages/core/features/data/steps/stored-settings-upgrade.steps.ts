import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';

/** Stops core and stores `value` in its agent settings, as an earlier release could have. */
const earlierAgentSettings = async (world: SynoikiaWorld, value: Record<string, unknown>) => {
  await world.stopCore();
  world.editDataFile((db) =>
    db
      .prepare(
        "INSERT INTO settings (key, value) VALUES ('mcp', ?) ON CONFLICT(key) DO UPDATE SET value = json_patch(value, excluded.value)",
      )
      .run(JSON.stringify(value)),
  );
};

const agentSettings = async (world: SynoikiaWorld) =>
  (await world.expectOk(world.admin.get('/api/settings'), 'read settings')).mcp as Record<string, unknown>;

Given(
  'the data file of an earlier release stores an agent access token lifetime of 1 minute',
  async (world: SynoikiaWorld) => {
    await earlierAgentSettings(world, {
      accessTokenTtlMinutes: 1,
      refreshTokenTtlDays: 7,
      allowDynamicRegistration: false,
    });
  },
);

Given(
  'the data file of an earlier release stores the agent sign-in methods as {string}',
  async (world: SynoikiaWorld, methods: string) => {
    await earlierAgentSettings(world, { clientAuth: methods });
  },
);

Given(
  'the data file of an earlier release stores a run limit of {int} for {string}',
  async (world: SynoikiaWorld, limit: number, slug: string) => {
    const id = await world.tasksInstance(slug);
    await world.stopCore();
    const { changes } = world.editDataFile((db) =>
      db
        .prepare("UPDATE plugin_instances SET settings = json_set(settings, '$.executePerMinute', ?) WHERE id = ?")
        .run(limit, id),
    );
    expect(changes).toBe(1);
  },
);

When('core starts on that data file', async (world: SynoikiaWorld) => {
  // Core writes the warnings of a stored value it ignores to stderr, which is part of its server log.
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void world.serverLog.push(args.map(String).join(' '));
  try {
    await world.startAgain();
  } finally {
    console.warn = warn;
  }
  expect(world.startError).toBeUndefined();
});

Then(
  'the agent access tokens last one hour, and the other agent settings stay as stored',
  async (world: SynoikiaWorld) => {
    await world.oauthAgent('7', 'admin', 'tasks');
    const renewed = await world.renewOAuth('7');
    expect(renewed).toMatchObject({ status: 200, body: { expires_in: 3600 } });
    expect(await agentSettings(world)).toMatchObject({ refreshTokenTtlDays: 7, allowDynamicRegistration: false });
  },
);

Then('the server log warns that it ignores the stored lifetime', (world: SynoikiaWorld) => {
  expect(
    world.serverLog.filter((l) => l.startsWith('WARN settings.mcp: ignoring stored accessTokenTtlMinutes ')),
  ).toHaveLength(1);
});

Then('credentials, OAuth and the access gateway are all off for agents', async (world: SynoikiaWorld) => {
  expect((await agentSettings(world)).clientAuth).toEqual({ bearer: false, oauth: false, external: false });
  await world.tasksInstance('tasks');
  await world.credential('7', 'admin', 'write');
  await world.execute('7', 'tasks', 'return 1;');
  expect(world.answer.refused).toMatch(/accepts no client auth method/);
});

Then(
  '{string} serves with the default run limit, and the data file holds no run limit for it',
  async (world: SynoikiaWorld, slug: string) => {
    const id = await world.tasksInstance(slug);
    const instance = await world.expectOk(world.admin.get(`/api/instances/${id}`), 'read instance');
    expect(instance).toMatchObject({ status: 'ready', settings: { executePerMinute: 30 } });
    await world.credential('7', 'admin', 'read');
    await world.search('7', slug, 'return (await catalog.find()).length;');
    expect(world.answer).toMatchObject({ result: expect.any(Number) as number });
    const stored = world.editDataFile(
      (db) =>
        db
          .prepare("SELECT json_type(settings, '$.executePerMinute') AS type FROM plugin_instances WHERE id = ?")
          .get(id) as {
          type: string | null;
        },
    );
    expect(stored.type).toBeNull();
  },
);
