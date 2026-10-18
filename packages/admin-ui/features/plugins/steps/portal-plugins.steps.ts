import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator } from 'playwright';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { sha256, tasksArchive } from '../../support/acme.js';
import type { PortalWorld } from '../../support/world.js';

const seen = (locator: Locator) => locator.waitFor({ state: 'visible', timeout: 10_000 });
const tasksRow = (world: PortalWorld) =>
  world.page.getByRole('tabpanel').getByRole('row').filter({ hasText: 'Acme Tasks' });
const dialog = (world: PortalWorld) => world.page.getByRole('dialog');

async function pluginsPage(world: PortalWorld) {
  await world.openAsAdmin('/plugins');
  await seen(world.page.getByRole('tab', { name: /^Installed \(\d+\)$/, selected: true }));
  await seen(world.page.getByRole('tabpanel').getByRole('table'));
}

/** The admin picks a plugin file in the upload dialog and sends it. */
async function upload(world: PortalWorld, name: string, file: Buffer) {
  world.lastFile = file;
  // The browser takes a file this large only from the disk.
  const big =
    file.length > 40 * 1024 * 1024 ? path.join(mkdtempSync(path.join(tmpdir(), 'synoikia-upload-')), name) : '';
  if (big) {
    writeFileSync(big, file);
    world.cleanups.push(async () => rmSync(path.dirname(big), { recursive: true, force: true }));
  }
  await pluginsPage(world);
  await world.page.getByRole('button', { name: 'Install from file' }).click();
  await dialog(world)
    .getByLabel('Plugin file (.tgz)')
    .setInputFiles(big || { name, mimeType: 'application/gzip', buffer: file });
  await dialog(world).getByRole('button', { name: 'Upload' }).click();
  await seen(dialog(world).getByRole('button', { name: /^(Install|Upload)$/ }));
  await seen(
    dialog(world)
      .getByText(/^Replaces|./)
      .first(),
  );
}

const uploadDone = (world: PortalWorld) =>
  seen(dialog(world).getByRole('button', { name: 'Install' }).or(dialog(world).getByRole('alert')).first());

// ── disabling and uninstalling ──

Given(
  'the instances {string} and {string} use Acme Tasks',
  async (world: PortalWorld, first: string, second: string) => {
    await world.tasksInstance(first);
    await world.tasksInstance(second);
  },
);

When('the admin disables Acme Tasks in the portal and cancels the question', async (world: PortalWorld) => {
  await pluginsPage(world);
  await tasksRow(world).getByRole('button', { name: 'Disable' }).click();
  await world.answerQuestion('Cancel');
});

Then(
  'the question said that this stops the {int} instances of {string}',
  (world: PortalWorld, count: number, pluginId: string) => {
    expect(world.question.text).toContain(`Disabling ${pluginId} stops its ${count} endpoint(s).`);
  },
);

Then('Acme Tasks is still enabled', async (world: PortalWorld) => {
  await seen(tasksRow(world).getByRole('button', { name: 'Disable' }));
  expect((await world.tasksPlugin())?.enabled).toBe(true);
});

Given('Acme Tasks has no instances', async (world: PortalWorld) => {
  expect(world.instances.size).toBe(0);
});

When('the admin uninstalls Acme Tasks in the portal and confirms the question', async (world: PortalWorld) => {
  await pluginsPage(world);
  await tasksRow(world).getByRole('button', { name: 'Uninstall' }).click();
  await world.answerQuestion('Uninstall');
});

Then('the question said {string}', (world: PortalWorld, text: string) => {
  expect(world.question.text).toContain(text);
});

Then('Acme Tasks is no longer installed', async (world: PortalWorld) => {
  await expect.poll(() => tasksRow(world).count()).toBe(0);
  expect(await world.tasksPlugin()).toBeUndefined();
});

Given('the server can no longer read its plugin folder', (world: PortalWorld) => {
  const folder = path.join(world.dataDir, 'plugins');
  rmSync(folder, { recursive: true, force: true });
  writeFileSync(folder, '');
});

When('the admin rescans the plugins in the portal', async (world: PortalWorld) => {
  await pluginsPage(world);
  await world.page.getByRole('button', { name: 'Rescan' }).click();
});

Then('the portal shows the alert {string}', async (world: PortalWorld, text: string) => {
  await seen(world.page.getByRole('alert').filter({ hasText: text }));
});

// ── network hosts ──

Given(
  'Acme Tasks contacts the host of its {string} field and {string}',
  async (world: PortalWorld, title: string, host: string) => {
    await world.editTasksManifest((m) => {
      m.network = { hosts: ['{{connection.url}}', host] };
      const connection = m.connection as { schema: { properties: Record<string, Record<string, unknown>> } };
      connection.schema.properties.url!.title = title;
    });
  },
);

When('the admin opens the plugins in the portal', async (world: PortalWorld) => {
  await pluginsPage(world);
});

// The portal still says "endpoint" where the spec says "instance" (D10).
Then('Acme Tasks contacts {string}, written as {string}', async (world: PortalWorld, text: string, raw: string) => {
  await seen(tasksRow(world).getByText(`${text.replace("instance's", "endpoint's")} (${raw})`));
});

Then('Acme Tasks contacts {string}', async (world: PortalWorld, host: string) => {
  await seen(tasksRow(world).getByText(new RegExp(`Declares network access to: .*, ${host.replace(/\./g, '\\.')}$`)));
});

// ── uploads ──

Given(
  'Acme Tasks {word} from {string} is installed and enabled',
  async (world: PortalWorld, version: string, repo: string) => {
    await world.installedFrom(repo, version);
  },
);

When('the admin uploads Acme Tasks {word} as {string}', async (world: PortalWorld, version: string, name: string) => {
  await upload(world, name, tasksArchive(version));
  await uploadDone(world);
});

When(
  'the admin uploads Acme Tasks {word}, which also contacts {string}',
  async (world: PortalWorld, version: string, host: string) => {
    await upload(
      world,
      `acme ${version}.tgz`,
      tasksArchive(version, (m) => (m.network = { hosts: ['127.0.0.1', host] })),
    );
    await uploadDone(world);
  },
);

When(
  'the admin uploads the new plugin {string} {word}',
  async (world: PortalWorld, pluginId: string, version: string) => {
    await upload(
      world,
      `${pluginId} ${version}.tgz`,
      tasksArchive(version, (m) => {
        m.id = pluginId;
        m.name = 'Acme Notes';
      }),
    );
    await uploadDone(world);
  },
);

Then(
  'the upload shows the version {string}, its checksum and that it replaces {string}',
  async (world: PortalWorld, version: string, replaces: string) => {
    const text = (await dialog(world).textContent()) ?? '';
    expect(text).toContain(version);
    expect(text).toContain(sha256(world.lastFile!).slice(0, 12));
    expect(text).toContain(replaces);
  },
);

Then('the upload says {string} and that Acme Tasks stays enabled', async (world: PortalWorld, text: string) => {
  await seen(dialog(world).getByText(text));
  await seen(dialog(world).getByText('tasks stays enabled', { exact: false }));
});

Then('after the install, the portal says {string}', async (world: PortalWorld, text: string) => {
  await dialog(world).getByRole('button', { name: 'Install' }).click();
  await seen(world.page.getByRole('status').filter({ hasText: text }));
  await expect.poll(() => dialog(world).count()).toBe(0);
});

Then('the upload lists the change {string}', async (world: PortalWorld, change: string) => {
  await seen(dialog(world).getByRole('listitem').filter({ hasText: change }));
});

Then('the upload says {string}', async (world: PortalWorld, text: string) => {
  await seen(dialog(world).getByText(text, { exact: false }));
});

When('the admin uploads a file of {int} MB', async (world: PortalWorld, mb: number) => {
  await upload(world, 'big.tgz', Buffer.alloc(mb * 1024 * 1024));
  await uploadDone(world);
});

Then('the admin can upload a file again', async (world: PortalWorld) => {
  expect(await dialog(world).getByRole('button', { name: 'Upload' }).isEnabled()).toBe(true);
});

Given('the admin uploaded Acme Tasks {word}', async (world: PortalWorld, version: string) => {
  await upload(world, `acme ${version}.tgz`, tasksArchive(version));
  await seen(dialog(world).getByRole('button', { name: 'Install' }));
});

When('the admin installs the upload {int} minutes later', async (world: PortalWorld, minutes: number) => {
  world.clockMs += minutes * 60_000;
  await dialog(world).getByRole('button', { name: 'Install' }).click();
});

Then('the upload says that it expired and asks for the file again', async (world: PortalWorld) => {
  await seen(dialog(world).getByRole('alert').filter({ hasText: 'This upload expired; upload the file again' }));
  await seen(dialog(world).getByRole('button', { name: 'Upload' }));
});

When(
  'the admin uploads Acme Tasks {word} built for the plugin SDK {string}',
  async (world: PortalWorld, version: string, sdk: string) => {
    await upload(
      world,
      `acme ${version}.tgz`,
      tasksArchive(version, (m) => (m.sdk = sdk)),
    );
    await uploadDone(world);
  },
);

Then('the upload says that it needs plugin SDK {string}', async (world: PortalWorld, sdk: string) => {
  await seen(
    dialog(world)
      .getByRole('alert')
      .filter({ hasText: `needs plugin SDK ${sdk}` }),
  );
});

Then('the admin cannot install it', async (world: PortalWorld) => {
  expect(await dialog(world).getByRole('button', { name: 'Install' }).isDisabled()).toBe(true);
});

// ── manual plugins ──

Given(
  'the admin installed the file {string} over Acme Tasks {word} from {string}',
  async (world: PortalWorld, name: string, version: string, repo: string) => {
    await world.installedFrom(repo, version);
    world.lastFile = tasksArchive('1.1.0');
    await world.installedFile(name, world.lastFile);
  },
);

Given(
  'the admin installed the file {string} over the hand-copied Acme Tasks',
  async (world: PortalWorld, name: string) => {
    world.lastFile = tasksArchive('1.1.0');
    await world.installedFile(name, world.lastFile);
  },
);

Then('Acme Tasks is marked {string}, with the checksum of the file', async (world: PortalWorld, mark: string) => {
  const sum = sha256(world.lastFile!);
  await seen(tasksRow(world).getByTitle(`sha256 ${sum}`, { exact: false }).filter({ hasText: mark }));
  await seen(tasksRow(world).getByText(sum.slice(0, 12), { exact: true }));
});

Then('Acme Tasks is marked {string}', async (world: PortalWorld, mark: string) => {
  await seen(tasksRow(world).getByText(mark, { exact: true }));
});

Then('the file name shows as the text {string}', async (world: PortalWorld, name: string) => {
  await seen(tasksRow(world).getByText(name, { exact: true }));
  expect(await tasksRow(world).locator('b').count()).toBe(0);
});

Then('Acme Tasks offers no way back to a released version', async (world: PortalWorld) => {
  expect(
    await tasksRow(world)
      .getByRole('button', { name: /^Revert/ })
      .count(),
  ).toBe(0);
});

Given('{string} no longer offers Acme Tasks {word}', async (world: PortalWorld, repo: string, _version: string) => {
  const offered = world.offer(repo, []);
  await world.expectOk((await world.adminApi()).post(`/api/plugin-repos/${offered.id!}/refresh`), 'refresh');
});

When('the admin reverts Acme Tasks to its released version {word}', async (world: PortalWorld, version: string) => {
  await pluginsPage(world);
  await tasksRow(world)
    .getByRole('button', { name: `Revert to released ${version}…` })
    .click();
  await world.answerQuestion('Revert');
});

Then(
  'the question named {string} as the source, without asking to type anything',
  (world: PortalWorld, repo: string) => {
    expect(world.question.text).toContain(repo);
    expect(world.question.fields).toBe(0);
  },
);

Then('the question warned {string}, without asking to type anything', (world: PortalWorld, warning: string) => {
  expect(world.question.text).toContain(warning);
  expect(world.question.fields).toBe(0);
});

Then('the question shows the alert {string}', async (world: PortalWorld, text: string) => {
  await seen(dialog(world).getByRole('alert').filter({ hasText: text }));
});
