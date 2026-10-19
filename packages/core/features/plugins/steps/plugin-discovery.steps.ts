import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { TASKS_SOURCE } from '../../support/plugin-archives.js';
import type { SynoikiaWorld } from '../../support/world.js';

const baseline = new WeakMap<SynoikiaWorld, number>();

const pluginsFolder = (world: SynoikiaWorld) => path.join(world.dataDir, 'plugins');
const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex');

/** A copy of "Acme Tasks" in the plugins folder, with these changes to its manifest. */
function copyOfTasks(world: SynoikiaWorld, folder: string, change: (m: Record<string, unknown>) => void = () => {}) {
  const dir = path.join(pluginsFolder(world), folder);
  cpSync(TASKS_SOURCE, dir, { recursive: true });
  const file = path.join(dir, 'manifest.json');
  const m = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  change(m);
  writeFileSync(file, JSON.stringify(m, null, 2));
}

/** Acme Tasks names `docs/agent.md` as its agent instructions; `write` puts the file there. */
async function instructions(world: SynoikiaWorld, write: (file: string) => void, rescan = false) {
  mkdirSync(path.dirname(world.pluginFile('docs/agent.md')), { recursive: true });
  write(world.pluginFile('docs/agent.md'));
  await world.editManifest((m) => {
    m.instructions = 'docs/agent.md';
  }, rescan);
}

const changes = async (world: SynoikiaWorld) =>
  (await world.audit({ decision: 'plugin_instructions_changed' })) as unknown as {
    detail: Record<string, unknown>;
  }[];

/** The changes of the instructions since the World's last rescan, oldest first. */
const newChanges = async (world: SynoikiaWorld) => {
  const rows = await changes(world);
  return rows.slice(0, rows.length - baseline.get(world)!).reverse();
};

const notValid = async (world: SynoikiaWorld, error: RegExp | string) => {
  const plugin = await world.plugin();
  expect(plugin?.status).toBe('invalid');
  if (typeof error === 'string') expect(plugin?.statusError).toBe(error);
  else expect(plugin?.statusError).toMatch(error);
};

Given('the plugins folder holds a folder {string} with a broken manifest', (world: SynoikiaWorld, folder: string) => {
  mkdirSync(path.join(pluginsFolder(world), folder));
  writeFileSync(path.join(pluginsFolder(world), folder, 'manifest.json'), '{"id": "Broken"}');
});

Given(
  'the plugins folder holds {string}, which needs the plugin SDK {word}',
  (world: SynoikiaWorld, name: string, sdk: string) => {
    copyOfTasks(world, 'tasks-next', (m) => {
      m.id = 'tasks-next';
      m.name = name;
      m.sdk = sdk;
    });
  },
);

Given(
  'the plugins folder holds {string}, a copy of Acme Tasks with its own id',
  (world: SynoikiaWorld, name: string) => {
    copyOfTasks(world, 'notes', (m) => {
      m.id = 'notes';
      m.name = name;
    });
  },
);

Given('the plugins folder holds a second folder with Acme Tasks', (world: SynoikiaWorld) => {
  copyOfTasks(world, 'tasks-copy');
});

When('the admin rescans the plugins folder', async (world: SynoikiaWorld) => {
  await world.expectOk(world.admin.post('/api/plugins/rescan'), 'rescan plugins');
});

Then(
  'the admin sees {string} as not valid, Acme Tasks as ready to run, and {string} as not compatible',
  async (world: SynoikiaWorld, broken: string, next: string) => {
    const plugins = await world.plugins();
    const byId = (id: string) => plugins.find((p) => p.pluginId === id);
    expect(byId(broken)).toMatchObject({ status: 'invalid', statusError: expect.stringMatching(/^manifest\.json:/) });
    expect(byId('tasks')).toMatchObject({ status: 'ok' });
    expect(byId('tasks-next')).toMatchObject({
      status: 'incompatible',
      manifest: { name: next },
      statusError: expect.stringMatching(/requires plugin SDK \^2\.0\.0/),
    });
  },
);

Given('the entry file of Acme Tasks is missing', (world: SynoikiaWorld) => {
  rmSync(world.pluginFile('index.mjs'));
});

Given('the entry file of Acme Tasks is a link to a file outside its folder', (world: SynoikiaWorld) => {
  rmSync(world.pluginFile('index.mjs'));
  symlinkSync(path.join(TASKS_SOURCE, 'index.mjs'), world.pluginFile('index.mjs'));
});

Then('the admin sees Acme Tasks as not valid, because its entry file is not found', async (world: SynoikiaWorld) => {
  await notValid(world, /^entry index\.mjs not found/);
});

Then(
  'the admin sees Acme Tasks as not valid, because its entry file is outside its folder',
  async (world: SynoikiaWorld) => {
    await notValid(world, 'entry resolves outside the plugin directory');
  },
);

Given(
  'Acme Tasks ships the agent instructions {string} with blank lines around {string}',
  async (world: SynoikiaWorld, _file: string, text: string) => {
    await instructions(world, (file) => writeFileSync(file, `\n\n${text}\n\n`));
  },
);

Then('the admin sees the agent instructions {string} for Acme Tasks', async (world: SynoikiaWorld, text: string) => {
  expect(await world.plugin()).toMatchObject({ status: 'ok', instructions: text });
});

Given(
  'Acme Tasks names the agent instructions {string}, but has no such file',
  async (world: SynoikiaWorld, file: string) => {
    await world.editManifest((m) => {
      m.instructions = file;
    }, false);
  },
);

Then(
  'the admin sees Acme Tasks as not valid, because {string} is not found',
  async (world: SynoikiaWorld, file: string) => {
    await notValid(world, `instructions ${file}: not found`);
  },
);

Given('Acme Tasks ships agent instructions of {int} bytes', async (world: SynoikiaWorld, size: number) => {
  await instructions(world, (file) => writeFileSync(file, 'x'.repeat(size)));
});

Given('Acme Tasks ships agent instructions that are not UTF-8 text', async (world: SynoikiaWorld) => {
  await instructions(world, (file) => writeFileSync(file, Buffer.from([0x23, 0xc3, 0x28])));
});

Then(
  'the admin sees Acme Tasks as not valid, because its instructions are over 4096 bytes',
  async (world: SynoikiaWorld) => {
    await notValid(world, /over 4096 bytes/);
  },
);

Then(
  'the admin sees Acme Tasks as not valid, because its instructions are not UTF-8 text',
  async (world: SynoikiaWorld) => {
    await notValid(world, /UTF-8/);
  },
);

Given('the agent instructions of Acme Tasks are a link to another file of Acme Tasks', async (world: SynoikiaWorld) => {
  writeFileSync(world.pluginFile('real.md'), 'Keys are verbs.');
  await instructions(world, (file) => symlinkSync(world.pluginFile('real.md'), file));
});

Given('the agent instructions of Acme Tasks are a link to a file outside its folder', async (world: SynoikiaWorld) => {
  const outside = path.join(world.dataDir, 'outside.md');
  writeFileSync(outside, 'Keys are verbs.');
  await instructions(world, (file) => symlinkSync(outside, file));
});

Given(
  'the folder of the agent instructions of Acme Tasks is a link to a folder outside the package',
  async (world: SynoikiaWorld) => {
    const elsewhere = path.join(world.dataDir, 'elsewhere');
    mkdirSync(elsewhere);
    writeFileSync(path.join(elsewhere, 'agent.md'), 'Keys are verbs.');
    symlinkSync(elsewhere, world.pluginFile('docs'));
    await world.editManifest((m) => {
      m.instructions = 'docs/agent.md';
    }, false);
  },
);

Then('the admin sees Acme Tasks as not valid, because its instructions are a link', async (world: SynoikiaWorld) => {
  await notValid(world, /symbolic link/);
});

Then(
  'the admin sees Acme Tasks as not valid, because its instructions are outside its folder',
  async (world: SynoikiaWorld) => {
    await notValid(world, /outside/);
  },
);

Given('Acme Tasks ships the agent instructions {string}', async (world: SynoikiaWorld, text: string) => {
  await instructions(world, (file) => writeFileSync(file, text), true);
  baseline.set(world, (await changes(world)).length);
});

Given('Acme Tasks now ships the agent instructions {string}', (world: SynoikiaWorld, text: string) => {
  writeFileSync(world.pluginFile('docs/agent.md'), text);
});

Given('Acme Tasks now ships empty agent instructions', (world: SynoikiaWorld) => {
  writeFileSync(world.pluginFile('docs/agent.md'), '');
});

Then(
  'the audit log shows one change of the instructions of Acme Tasks, with the fingerprints before and after and no text',
  async (world: SynoikiaWorld) => {
    const rows = await newChanges(world);
    expect(rows.map((r) => r.detail)).toEqual([
      {
        pluginId: 'tasks',
        version: '1.0.0',
        before: fingerprint('Keys are verbs.'),
        after: fingerprint('Keys are nouns.'),
      },
    ]);
    expect(JSON.stringify(await changes(world))).not.toContain('Keys are');
  },
);

Then('the audit log shows no change of the instructions of Acme Tasks', async (world: SynoikiaWorld) => {
  expect(await newChanges(world)).toEqual([]);
});

Then(
  'the audit log shows one change of the instructions of Acme Tasks, with no fingerprint after',
  async (world: SynoikiaWorld) => {
    const rows = await newChanges(world);
    expect(rows.map((r) => r.detail)).toEqual([
      { pluginId: 'tasks', version: '1.0.0', before: fingerprint('Keys are verbs.'), after: null },
    ]);
    expect(await world.plugin()).toMatchObject({ status: 'ok', instructions: null });
  },
);

Then('the admin sees {string} as ready to run, and disabled', async (world: SynoikiaWorld, name: string) => {
  const plugin = (await world.plugins()).find((p) => p.pluginId === 'notes');
  expect(plugin).toMatchObject({ status: 'ok', enabled: false, manifest: { name } });
});

Then('the admin sees one Acme Tasks, from its first folder', async (world: SynoikiaWorld) => {
  const tasks = (await world.plugins()).filter((p) => p.pluginId === 'tasks');
  expect(tasks.map((p) => p.path)).toEqual([path.join(pluginsFolder(world), 'tasks')]);
});

Then('the admin sees the warning that a second Acme Tasks was ignored', async (world: SynoikiaWorld) => {
  const overview = await world.expectOk(world.admin.get('/api/overview'), 'read overview');
  expect(overview.warnings).toContain('Plugin tasks was ignored: its id is already taken');
});

Given('the folder of Acme Tasks is gone from the plugins folder', (world: SynoikiaWorld) => {
  rmSync(path.join(pluginsFolder(world), 'tasks'), { recursive: true, force: true });
});

Then(
  'the admin sees Acme Tasks as not valid and still enabled, with the instance {string}',
  async (world: SynoikiaWorld, slug: string) => {
    expect(await world.plugin()).toMatchObject({
      status: 'invalid',
      statusError: 'plugin directory not found',
      enabled: true,
      instances: 1,
    });
    const listed = (await world.expectOk(world.admin.get('/api/instances'), 'list instances')) as unknown as {
      slug: string;
    }[];
    expect(listed.map((i) => i.slug)).toEqual([slug]);
  },
);
