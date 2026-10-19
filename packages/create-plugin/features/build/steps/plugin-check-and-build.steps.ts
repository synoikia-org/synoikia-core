import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { Given, Then, When } from 'quickpickle';
import type { DataTable } from 'quickpickle';
import { expect } from 'vitest';
import type { PluginAuthorWorld } from '../../support/world.js';

/** YAML whose aliases expand ten levels deep: ten billion nodes from a few lines. */
const ALIAS_BOMB = [
  'a: &a [x,x,x,x,x,x,x,x,x,x]',
  ...Array.from({ length: 10 }, (_, i) => {
    const name = 'b'.repeat(i + 1);
    return `${name}: &${name} [${Array(10)
      .fill(i ? `*${'b'.repeat(i)}` : '*a')
      .join(',')}]`;
  }),
].join('\n');

Given(
  'plugin author 3 has the plugin repository {string} with the plugin {string} that signs in with a bearer token',
  (world: PluginAuthorWorld, name: string, id: string) => {
    world.create(name, '--repository', 'acme/plugins', '--no-plugin');
    world.plugin = id;
    world.newPlugin('--id', id, '--name', 'Acme Tasks', '--archetype', 'blank', '--auth', 'bearer');
    expect(world.last?.code, world.last?.stderr).toBe(0);
  },
);

Given(
  'the manifest of {string} has the version {string} and lists no sensitive keys',
  (world: PluginAuthorWorld, id: string, version: string) => {
    world.editJson(`plugins/${id}/manifest.json`, (m) => {
      m.version = version;
      m.sensitiveKeys = [];
    });
  },
);

Given('plugin.yaml gives a rule the match profile {string}', (world: PluginAuthorWorld, profile: string) => {
  world.write(`plugins/${world.plugin}/plugin.yaml`, `rules:\n  - match: lists.rename\n    matchProfile: ${profile}\n`);
});

Given('plugin.yaml has a rule with the unknown key {string}', (world: PluginAuthorWorld, key: string) => {
  world.write(`plugins/${world.plugin}/plugin.yaml`, `rules: [{ match: lists.delete, ${key}: true }]\n`);
});

Given(
  'the manifest of {string} names the instructions file {string}, which {}',
  (world: PluginAuthorWorld, id: string, file: string, state: string) => {
    const dir = `plugins/${id}`;
    world.editJson(`${dir}/manifest.json`, (m) => {
      m.instructions = file;
    });
    if (state === 'holds 4097 bytes') world.write(`${dir}/${file}`, 'x'.repeat(4097));
    else if (state === 'holds a short guide') world.write(`${dir}/${file}`, 'Keys are `lists.rename`.\n');
    else if (state === 'is a link to another file') {
      world.write(`${dir}/notes.md`, 'Keys are verbs.\n');
      symlinkSync(world.file(`${dir}/notes.md`), world.file(`${dir}/${file}`));
    } else if (state === 'is outside the plugin folder') world.write(`plugins/notes.md`, 'Keys are verbs.\n');
    else expect(state).toBe('is missing');
  },
);

When('plugin author 3 checks the plugin {string}', (world: PluginAuthorWorld, id: string) => {
  world.cli('check', `plugins/${id}`);
});

Then('the check fails and reports these problems:', (world: PluginAuthorWorld, table: DataTable) => {
  expect(world.last?.code).toBe(1);
  expect(world.problems()).toEqual(table.raw().map((row: string[]) => row[0]));
});

Then('the check fails and reports {string}', (world: PluginAuthorWorld, problem: string) => {
  expect(world.last?.code).toBe(1);
  expect(world.problems()).toEqual([problem]);
});

Then('the check fails and reports a problem that starts with {string}', (world: PluginAuthorWorld, start: string) => {
  expect(world.last?.code).toBe(1);
  expect(world.problems()[0]).toMatch(new RegExp(`^${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

Given(
  'plugin author 3 has a plugin {string} whose code prints its plugin.yaml, its guide {string} and its data file {string}',
  (world: PluginAuthorWorld, id: string, guide: string, data: string) => {
    world.repo = path.join(world.dir, 'acme-plugins');
    world.plugin = id;
    const dir = `plugins/${id}`;
    world.write(
      `${dir}/src/index.ts`,
      `import settings from '../plugin.yaml';\nimport guide from '../${guide}';\nimport data from '../${data}';\n` +
        'console.log(JSON.stringify({ settings, guide, data }));\n',
    );
    world.write(`${dir}/plugin.yaml`, 'plugin: { greeting: hi }\n');
    world.write(`${dir}/${guide}`, '# Guide\n');
    world.write(`${dir}/${data}`, 'lists: [Chores]\n');
  },
);

Given(
  'plugin.yaml says the greeting is {string}, the guide says {string} and the data file lists {string}',
  (world: PluginAuthorWorld, greeting: string, guide: string, list: string) => {
    const dir = `plugins/${world.plugin}`;
    world.write(`${dir}/plugin.yaml`, `plugin: { greeting: ${greeting} }\n`);
    world.write(`${dir}/guide.md`, `${guide}\n`);
    world.write(`${dir}/lists.yaml`, `lists: [${list}]\n`);
  },
);

Given('plugin.yaml has the unknown section {string}', (world: PluginAuthorWorld, section: string) => {
  world.write(`plugins/${world.plugin}/plugin.yaml`, `${section}: []\n`);
});

Given('the data file {string} has an unclosed list', (world: PluginAuthorWorld, file: string) => {
  world.write(`plugins/${world.plugin}/${file}`, 'lists: [Groceries\n');
});

Given('the data file {string} expands aliases 10 levels deep', (world: PluginAuthorWorld, file: string) => {
  world.write(`plugins/${world.plugin}/${file}`, `${ALIAS_BOMB}\n`);
});

When('plugin author 3 builds the plugin {string}', (world: PluginAuthorWorld, id: string) => {
  world.cli('build', `plugins/${id}`);
});

Then('the folder {string} holds only {string}', (world: PluginAuthorWorld, rel: string, file: string) => {
  expect(world.last?.code, world.last?.stderr).toBe(0);
  expect(readdirSync(world.file(rel))).toEqual([file]);
});

Then(
  'the bundle, run alone from another folder, prints {string}, {string} and {string}',
  (world: PluginAuthorWorld, greeting: string, guide: string, list: string) => {
    const elsewhere = path.join(world.dir, 'elsewhere');
    mkdirSync(elsewhere);
    copyFileSync(world.file(`plugins/${world.plugin}/dist/index.js`), path.join(elsewhere, 'index.mjs'));
    rmSync(world.repo, { recursive: true });
    const run = world.must(process.execPath, ['index.mjs'], elsewhere);
    expect(JSON.parse(run.stdout)).toEqual({
      settings: { plugin: { greeting } },
      guide: `${guide}\n`,
      data: { lists: [list] },
    });
  },
);

Then('the build fails with {string}', (world: PluginAuthorWorld, message: string) => {
  expect(world.last?.code).toBe(1);
  expect(world.last?.stderr).toContain(message);
});

Then('no bundle is written', (world: PluginAuthorWorld) => {
  expect(existsSync(world.file(`plugins/${world.plugin}/dist/index.js`))).toBe(false);
});
