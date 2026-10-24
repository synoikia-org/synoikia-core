import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator } from 'playwright';
import { defineParameterType, Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { API_TOKEN } from '../../support/acme.js';
import type { PortalWorld } from '../../support/world.js';

defineParameterType({ name: 'instance', regexp: /\/[a-z0-9-]+/, transformer: (s: string) => s.slice(1) });
defineParameterType({ name: 'level', regexp: /None|Read|Ask|Write/, transformer: (s: string) => s.toLowerCase() });
defineParameterType({
  name: 'client',
  regexp: /Claude Code|Claude Desktop|Cloudflare MCP portal/,
  transformer: (s: string) => s,
});

/** The World's operations by the names the feature files use. */
const OPERATIONS: Record<string, string> = {
  'show the open tasks': 'lists.tasks',
  'add a task': 'tasks.add',
  'complete a task': 'tasks.complete',
  'delete a list': 'lists.delete',
};
const opKey = (name: string) => {
  const key = OPERATIONS[name];
  if (!key) throw new Error(`The World has no operation "${name}"`);
  return key;
};
const LEVEL_LABELS: Record<string, string> = { none: 'None', read: 'Read', ask: 'Ask', write: 'Write' };
/** The paths of the World's instances; any other path names no instance. */
const WORLD_INSTANCES = ['groceries', 'errands'];
/** The sign-in methods by the names the feature files use. */
const METHODS: Record<string, string[]> = {
  'only OAuth': ['oauth'],
  'only bearer tokens': ['bearer'],
  'bearer tokens and OAuth': ['bearer', 'oauth'],
  'only External, which is turned off': ['external'],
  'bearer tokens and External, which is turned off': ['bearer', 'external'],
};

const seen = (locator: Locator) => locator.waitFor({ state: 'visible', timeout: 10_000 });
const dialog = (world: PortalWorld) => world.page.getByRole('dialog');
const group = (world: PortalWorld, key: string) => world.page.locator(`[data-group="${key}"]`);
const groupLevels = (world: PortalWorld, label: string) =>
  world.page.getByRole('radiogroup', { name: `Access for ${label}` });
const opRow = (world: PortalWorld, name: string) => world.page.locator(`[data-op="${opKey(name)}"]`);
const opLevels = (world: PortalWorld, name: string) =>
  world.page.getByRole('radiogroup', { name: `Level of ${opKey(name)}` });
const opReset = (world: PortalWorld, name: string) =>
  world.page.getByRole('button', { name: `Put ${opKey(name)} back on its group's level` });
const connectCard = (world: PortalWorld) =>
  world.page.locator('.card').filter({ has: world.page.getByRole('heading', { name: 'Connect a client' }) });
const command = (world: PortalWorld) => connectCard(world).locator('pre').filter({ hasText: 'claude mcp add' });
const tokenField = (world: PortalWorld) => world.page.getByRole('group', { name: 'token' });
const inSession = (world: PortalWorld) => world.page.getByRole('checkbox', { name: /in the agent session/ });
const methodBox = (world: PortalWorld, name: string) =>
  world.page.getByRole('group', { name: 'Accepted client auth' }).getByRole('checkbox', { name });

async function instanceId(world: PortalWorld, slug: string) {
  return world.tasksInstance(slug);
}

/** The admin opens a page of an instance; one of the World's instances is made first. */
async function instancePage(world: PortalWorld, slug: string, section: string) {
  if (WORLD_INSTANCES.includes(slug)) await world.tasksInstance(slug);
  await world.openAsAdmin(`/endpoints/${slug}/${section}`);
  if (WORLD_INSTANCES.includes(slug)) await seen(world.page.getByRole('heading', { name: `/${slug}` }));
}

async function expandGroups(world: PortalWorld) {
  await seen(world.page.getByRole('radiogroup').first());
  const expand = world.page.getByRole('button', { name: /^Expand / });
  while ((await expand.count()) > 0) await expand.first().click();
}

async function operations(world: PortalWorld, slug: string) {
  const id = await instanceId(world, slug);
  return (await world.expectOk(
    (await world.adminApi()).get(`/api/instances/${id}/operations`),
    'operations',
  )) as unknown as {
    id: string;
    key: string;
    level: string;
    levelOverride: string | null;
  }[];
}

async function groups(world: PortalWorld, slug: string) {
  const id = await instanceId(world, slug);
  return (await world.expectOk((await world.adminApi()).get(`/api/instances/${id}/groups`), 'groups')) as unknown as {
    key: string;
    label: string;
    level: string;
  }[];
}

async function setOwnLevel(world: PortalWorld, slug: string, name: string, level: string) {
  const id = await instanceId(world, slug);
  const op = (await operations(world, slug)).find((o) => o.key === opKey(name))!;
  await world.expectOk(
    (await world.adminApi()).patch(`/api/instances/${id}/operations/${op.id}`, { level }),
    'set own level',
  );
}

async function acceptMethods(world: PortalWorld, slug: string, methods: string[]) {
  const id = await instanceId(world, slug);
  await world.expectOk((await world.adminApi()).patch(`/api/instances/${id}`, { authMethods: methods }), 'methods');
}

/** The new instance page with its plugin chosen, as the admin finds it. */
async function newInstancePage(world: PortalWorld) {
  await world.openAsAdmin('/endpoints/new');
  const plugin = world.page.getByLabel('Plugin', { exact: true });
  await expect.poll(() => plugin.inputValue()).not.toBe('');
  world.noted.plugin = (await plugin.locator('option:checked').textContent()) ?? '';
}

async function createInstance(world: PortalWorld, slug: string) {
  await world.page.getByLabel('Path', { exact: true }).fill(slug);
  await world.page.getByLabel(/^url/).fill(world.upstream!.url);
  await world.page.getByLabel('token', { exact: true }).fill(API_TOKEN);
  await world.page.getByRole('button', { name: 'Create endpoint' }).click();
  await seen(world.page.getByRole('heading', { name: `/${slug}` }));
}

/** The admin turns on approval in the agent session; the state before and the warning after are kept. */
async function turnOnInSession(world: PortalWorld) {
  world.noted.wasOn = String(await inSession(world).isChecked());
  await inSession(world).check();
  world.noted.warning = (await world.page.getByRole('note').textContent()) ?? '';
}

/** The browser drops its connection and gets it back a minute later; the portal loads stale data again. */
async function offlineForAMinute(world: PortalWorld, path: string) {
  await world.page.clock.install();
  await world.page.clock.fastForward(60_000);
  const reloaded = world.page.waitForResponse((r) => new URL(r.url()).pathname === path, { timeout: 10_000 });
  await world.context.setOffline(true);
  await world.context.setOffline(false);
  await reloaded;
}

// ── a new instance ──

Given('Acme Tasks is enabled', async (world: PortalWorld) => {
  await world.enableTasks();
});

When('the admin makes the instance {string} in the portal', async (world: PortalWorld, slug: string) => {
  await newInstancePage(world);
  await createInstance(world, slug);
});

Then('Acme Tasks was chosen as the plugin before the admin picked one', (world: PortalWorld) => {
  expect(world.noted.plugin).toContain('Acme Tasks');
});

Then('the portal shows the connection page of {instance}', async (world: PortalWorld, slug: string) => {
  await seen(world.page.getByRole('link', { name: 'Connection' }));
  expect(new URL(world.page.url()).pathname).toBe(`/endpoints/${slug}/connection`);
});

Given('the admin typed the path {string} for a new instance', async (world: PortalWorld, slug: string) => {
  await newInstancePage(world);
  await world.page.getByLabel('Path', { exact: true }).fill(slug);
});

When('the browser is offline for a minute and comes back', async (world: PortalWorld) => {
  await offlineForAMinute(world, world.noted.reloads ?? '/api/plugins');
});

Then('the path still says {string}, with Acme Tasks as the plugin', async (world: PortalWorld, slug: string) => {
  expect(await world.page.getByLabel('Path', { exact: true }).inputValue()).toBe(slug);
  const plugin = world.page.getByLabel('Plugin', { exact: true });
  expect(await plugin.locator('option:checked').textContent()).toContain('Acme Tasks');
});

When(
  'the admin makes the instance {string} with approval in the agent session turned on',
  async (world: PortalWorld, slug: string) => {
    await newInstancePage(world);
    await turnOnInSession(world);
    await createInstance(world, slug);
    world.instances.set(slug, ((await world.instance(slug))?.id as string | undefined) ?? '');
  },
);

Then(
  'the option was off at first, and the portal warned that a client {string}',
  (world: PortalWorld, text: string) => {
    expect(world.noted.wasOn).toBe('false');
    expect(world.noted.warning).toContain(text);
  },
);

Then('{instance} approves Ask operations in the agent session', async (world: PortalWorld, slug: string) => {
  await expect
    .poll(async () => ((await world.instance(slug))?.settings as Record<string, unknown>).formElicitationApprovals)
    .toBe('ask');
});

// ── group levels ──

Given(
  'the group {string} of {instance} is at {level}',
  async (world: PortalWorld, key: string, slug: string, level: string) => {
    const id = await instanceId(world, slug);
    await world.expectOk(
      (await world.adminApi()).patch(`/api/instances/${id}/groups/${key}`, { level }),
      'group level',
    );
  },
);

When(
  'the admin sets the group {string} to {level} on the access page of {instance}',
  async (world: PortalWorld, key: string, level: string, slug: string) => {
    await instancePage(world, slug, 'access');
    const saved = world.page.waitForResponse((r) => r.request().method() === 'PATCH');
    await groupLevels(world, key).getByRole('radio', { name: LEVEL_LABELS[level] }).click();
    await saved;
  },
);

Then(
  'the group {string} of {instance} is at {level}, and the portal asked nothing',
  async (world: PortalWorld, key: string, slug: string, level: string) => {
    await expect
      .poll(() =>
        groupLevels(world, key).getByRole('radio', { name: LEVEL_LABELS[level] }).getAttribute('aria-checked'),
      )
      .toBe('true');
    expect((await groups(world, slug)).find((g) => g.key === key)?.level).toBe(level);
    expect(await dialog(world).count()).toBe(0);
  },
);

Given(
  '{string} on {instance} has its own level {level}',
  async (world: PortalWorld, name: string, slug: string, level: string) => {
    await setOwnLevel(world, slug, name, level);
  },
);

Given(
  '{string} and {string} on {instance} have their own level {level}',
  async (world: PortalWorld, first: string, second: string, slug: string, level: string) => {
    await setOwnLevel(world, slug, first, level);
    await setOwnLevel(world, slug, second, level);
  },
);

When('the admin opens the access page of {instance}', async (world: PortalWorld, slug: string) => {
  await instancePage(world, slug, 'access');
});

Then('the group {string} shows {string}', async (world: PortalWorld, key: string, text: string) => {
  await seen(group(world, key).getByText(text));
});

When(
  'the admin sets all groups of {instance} to {level} and cancels the question',
  async (world: PortalWorld, slug: string, level: string) => {
    await instancePage(world, slug, 'access');
    await world.page.getByRole('combobox', { name: 'Set every group to one level' }).selectOption(level);
    await world.answerQuestion('Cancel');
  },
);

Then('every group of {instance} is still at Ask', async (world: PortalWorld, slug: string) => {
  await expect.poll(() => dialog(world).count()).toBe(0);
  expect((await groups(world, slug)).map((g) => g.level)).toEqual(['ask', 'ask']);
});

// ── operation levels ──

Given('Acme Tasks says that {string} needs the scope {string}', (world: PortalWorld, name: string, scope: string) => {
  world.pluginFlag(
    'catalog-changes',
    JSON.stringify({ change: { [opKey(name)]: { classificationReason: `roles:read(${scope})` } } }),
  );
});

When('the admin opens every group on the access page of {instance}', async (world: PortalWorld, slug: string) => {
  await instancePage(world, slug, 'access');
  await expandGroups(world);
});

const offered = async (world: PortalWorld, name: string) =>
  (await opLevels(world, name).getByRole('radio').allTextContents()).map((t) => t.trim());

Then(
  '{string} offers None, Read and Ask, and its kind says {string}',
  async (world: PortalWorld, name: string, kind: string) => {
    expect(await offered(world, name)).toEqual(['None', 'Read', 'Ask']);
    await seen(opRow(world, name).getByTitle(kind));
  },
);

Then('{string} offers None, Ask and Write', async (world: PortalWorld, name: string) => {
  expect(await offered(world, name)).toEqual(['None', 'Ask', 'Write']);
});

When(
  'the admin picks {level} for {string} on {instance} and cancels the question',
  async (world: PortalWorld, level: string, name: string, slug: string) => {
    await instancePage(world, slug, 'access');
    await expandGroups(world);
    await opLevels(world, name).getByRole('radio', { name: LEVEL_LABELS[level], exact: true }).click();
    await world.answerQuestion('Cancel');
  },
);

Then('{string} cannot be set to Write, and stays at None', async (world: PortalWorld, name: string) => {
  expect(
    await opLevels(world, name)
      .getByRole('radio', { name: /^Write/ })
      .isDisabled(),
  ).toBe(true);
  expect(
    await opLevels(world, name).getByRole('radio', { name: 'None', exact: true }).getAttribute('aria-checked'),
  ).toBe('true');
  expect((await operations(world, 'groceries')).find((o) => o.key === opKey(name))?.level).toBe('none');
});

When(
  'the admin picks {level} for {string} on {instance}, which its group {string} gives',
  async (world: PortalWorld, level: string, name: string, slug: string, _group: string) => {
    await instancePage(world, slug, 'access');
    await expandGroups(world);
    const saved = world.page.waitForResponse((r) => r.request().method() === 'PATCH');
    await opLevels(world, name).getByRole('radio', { name: LEVEL_LABELS[level], exact: true }).click();
    await saved;
  },
);

Then('{string} follows its group again, and it cannot be reset', async (world: PortalWorld, name: string) => {
  await expect.poll(() => opReset(world, name).count()).toBe(0);
  expect((await operations(world, 'groceries')).find((o) => o.key === opKey(name))?.levelOverride).toBeNull();
});

Then(
  '{string} keeps its own level {level}, and it can be reset',
  async (world: PortalWorld, name: string, level: string) => {
    await seen(opReset(world, name));
    expect((await operations(world, 'groceries')).find((o) => o.key === opKey(name))?.levelOverride).toBe(level);
  },
);

Then(
  '{string} says {string}, {string} says {string}, and {string} says {string}',
  async (world: PortalWorld, a: string, aSays: string, b: string, bSays: string, c: string, cSays: string) => {
    for (const [name, says] of [
      [a, aSays],
      [b, bSays],
      [c, cSays],
    ] as const)
      await seen(opRow(world, name).getByText(says, { exact: true }));
  },
);

// ── group labels ──

async function startRename(world: PortalWorld, key: string, slug: string) {
  await instancePage(world, slug, 'access');
  await group(world, key).getByRole('button', { name: 'Rename' }).click();
  await seen(dialog(world).getByRole('textbox'));
}

When(
  'the admin renames the group {string} of {instance} to {string}',
  async (world: PortalWorld, key: string, slug: string, label: string) => {
    await startRename(world, key, slug);
    await dialog(world).getByRole('textbox').fill(label);
    await world.answerQuestion('Rename');
  },
);

When(
  'the admin renames the group {string} of {instance} and cancels the question',
  async (world: PortalWorld, key: string, slug: string) => {
    await startRename(world, key, slug);
    await world.answerQuestion('Cancel');
  },
);

When(
  'the admin renames the group {string} of {instance} and keeps the label as it is',
  async (world: PortalWorld, key: string, slug: string) => {
    await startRename(world, key, slug);
    await world.answerQuestion('Rename');
  },
);

Then(
  'the group {string} of {instance} is labelled {string}',
  async (world: PortalWorld, key: string, slug: string, label: string) => {
    await expect.poll(() => dialog(world).count()).toBe(0);
    await seen(groupLevels(world, label));
    expect((await groups(world, slug)).find((g) => g.key === key)?.label).toBe(label);
  },
);

// ── an unknown instance ──

Then('the portal says that there is no instance at {instance}', async (world: PortalWorld, slug: string) => {
  // The portal still says "endpoint" where the spec says "instance" (D10).
  await seen(world.page.getByText(`No endpoint at /${slug}.`));
});

Given('the admin has the overview open, and the live updates of the portal are down', async (world: PortalWorld) => {
  await world.page.route('**/api/events', (route) => route.abort());
  await world.overviewOpen();
});

Given('another admin made the instance {instance} meanwhile', async (world: PortalWorld, slug: string) => {
  await world.tasksInstance(slug);
});

When('the admin goes to the access page of {instance} without a reload', async (world: PortalWorld, slug: string) => {
  // A history change, as the back and forward buttons make: the portal's router follows it in the same page.
  await world.page.evaluate((to) => {
    history.pushState(null, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/endpoints/${slug}/access`);
});

Then('the portal shows the access page of {instance}', async (world: PortalWorld, slug: string) => {
  await seen(world.page.getByRole('heading', { name: `/${slug}` }));
  await seen(world.page.getByRole('radiogroup').first());
  expect(world.page.url()).toBe(`${world.base}/endpoints/${slug}/access`);
  expect(await world.sameLoad()).toBe(true);
});

// ── the connection ──

When('the admin opens the connection page of {instance}', async (world: PortalWorld, slug: string) => {
  await instancePage(world, slug, 'connection');
  await seen(world.page.getByRole('heading', { name: 'Catalog' }));
});

Then('the token shows {string}, and its value is nowhere on the page', async (world: PortalWorld, text: string) => {
  await seen(tokenField(world).getByText(text));
  expect(await world.page.content()).not.toContain(API_TOKEN);
  const values = await Promise.all((await world.page.locator('input').all()).map((input) => input.inputValue()));
  expect(values).not.toContain(API_TOKEN);
});

Then('the admin can mark the token to be cleared, undo that, or type a replacement', async (world: PortalWorld) => {
  await tokenField(world).getByRole('button', { name: 'Clear' }).click();
  await seen(world.page.getByText('Will be cleared'));
  await world.page.getByRole('button', { name: 'Undo' }).click();
  await tokenField(world).getByRole('button', { name: 'Replace' }).click();
  await seen(world.page.getByLabel('token', { exact: true }));
});

When(
  'the admin replaces the token of {instance} with {string} and saves the connection',
  async (world: PortalWorld, slug: string, token: string) => {
    await instancePage(world, slug, 'connection');
    await tokenField(world).getByRole('button', { name: 'Replace' }).click();
    await world.page.getByLabel('token', { exact: true }).fill(token);
    await world.page.getByRole('button', { name: 'Save', exact: true }).click();
  },
);

Then('the portal says that the instance restarted with the new connection', async (world: PortalWorld) => {
  // The portal still says "endpoint" where the spec says "instance" (D10).
  await seen(
    world.page.getByRole('status').filter({ hasText: 'Saved. The endpoint restarted with the new connection.' }),
  );
});

Then('the token shows {string}', async (world: PortalWorld, text: string) => {
  await seen(tokenField(world).getByText(text));
});

Given('the admin changed the url on the connection page of {instance}', async (world: PortalWorld, slug: string) => {
  await instancePage(world, slug, 'connection');
  world.noted.url = `${world.upstream!.url}/edited`;
  await world.page.getByLabel(/^url/).fill(world.noted.url);
});

When('the admin syncs {instance} from its connection page', async (world: PortalWorld, _slug: string) => {
  await world.page.getByRole('button', { name: 'Sync now' }).click();
});

Given('the manifest of Acme Tasks for {instance} is broken on the server', async (world: PortalWorld, slug: string) => {
  await world.tasksInstance(slug);
  writeFileSync(path.join(world.dataDir, 'plugins', 'tasks', 'manifest.json'), '{');
  await world.expectOk((await world.adminApi()).post('/api/plugins/rescan'), 'rescan plugins');
});

Then('the connection form shows the alert {string}', async (world: PortalWorld, text: string) => {
  await seen(world.page.locator('form').getByRole('alert').filter({ hasText: text }));
});

Then("the url still has the admin's edit", async (world: PortalWorld) => {
  expect(await world.page.getByLabel(/^url/).inputValue()).toBe(world.noted.url);
});

// ── connecting a client ──

Given(
  "{instance} accepts only OAuth, and the server's public address is {string}",
  async (world: PortalWorld, slug: string, address: string) => {
    await world.restartCore({ PUBLIC_MCP_URL: address });
    await world.tasksInstance(slug);
    await acceptMethods(world, slug, ['oauth']);
  },
);

Given(
  /^\/([a-z0-9-]+) accepts (only OAuth|only bearer tokens|bearer tokens and OAuth|only External, which is turned off|bearer tokens and External, which is turned off)$/,
  async (world: PortalWorld, slug: string, methods: string) => {
    await world.tasksInstance(slug);
    await acceptMethods(world, slug, METHODS[methods]!);
  },
);

Then('the setup for Claude Code shows the command {string}', async (world: PortalWorld, expected: string) => {
  const text = (await command(world).textContent()) ?? '';
  expect(text.replace(/\s*\\\n/g, ' ')).toBe(expected);
});

Then('the setup says to choose {string}', async (world: PortalWorld, choice: string) => {
  await seen(connectCard(world).getByText(choice, { exact: true }));
});

When(
  'the admin picks {client} to set up on the connection page of {instance}',
  async (world: PortalWorld, client: string, slug: string) => {
    await instancePage(world, slug, 'connection');
    await world.page.getByRole('combobox', { name: 'Client to set up' }).selectOption({ label: client });
  },
);

Then(
  'the setup shows a config with the header {string} and {string}',
  async (world: PortalWorld, header: string, auth: string) => {
    const text = (await connectCard(world).locator('pre').filter({ hasText: 'mcpServers' }).textContent()) ?? '';
    const server = (JSON.parse(text) as { mcpServers: Record<string, { args: string[]; env: { AUTH: string } }> })
      .mcpServers.groceries!;
    expect(server.args).toContain(header);
    expect(server.env.AUTH).toBe(auth);
  },
);

Then('the portal offers Claude Desktop again on the next visit', async (world: PortalWorld) => {
  await world.page.reload();
  const client = world.page.getByRole('combobox', { name: 'Client to set up' });
  await seen(client);
  expect(await client.locator('option:checked').textContent()).toBe('Claude Desktop');
});

When(
  'the admin picks bearer tokens to sign in with on the connection page of {instance}',
  async (world: PortalWorld, slug: string) => {
    await instancePage(world, slug, 'connection');
    const method = world.page.getByLabel('Sign in with', { exact: true });
    world.noted.methods = (await method.locator('option').allTextContents()).map((t) => t.trim()).join(', ');
    await method.selectOption({ label: 'Bearer tokens' });
  },
);

Then('the methods were offered as {string} then {string}', (world: PortalWorld, first: string, second: string) => {
  expect(world.noted.methods).toBe(`${first}, ${second}`);
});

Then('the command for Claude Code now has the header {string}', async (world: PortalWorld, header: string) => {
  await seen(command(world).filter({ hasText: `--header "${header}"` }));
});

Then('the setup says the instance {string}, and shows no command', async (world: PortalWorld, text: string) => {
  await seen(connectCard(world).getByText(text, { exact: false }));
  expect(await command(world).count()).toBe(0);
});

Given('MCP clients may not register themselves', async (world: PortalWorld) => {
  await world.expectOk(
    (await world.adminApi()).put('/api/settings/mcp', { allowDynamicRegistration: false }),
    'turn off client registration',
  );
});

Then('the setup warns {string}', async (world: PortalWorld, text: string) => {
  await seen(connectCard(world).locator('.alert').filter({ hasText: text }));
});

When('the admin copies the address on the connection page of {instance}', async (world: PortalWorld, slug: string) => {
  await world.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: world.base });
  await instancePage(world, slug, 'connection');
  await connectCard(world).getByRole('button', { name: 'Copy', exact: true }).first().click();
});

Then(
  'the copy of {string} is confirmed with {string}',
  async (world: PortalWorld, address: string, confirmation: string) => {
    await seen(connectCard(world).getByRole('button', { name: confirmation }));
    expect(await world.page.evaluate<string>('navigator.clipboard.readText()')).toBe(address);
  },
);

Then('the setup for the Cloudflare MCP portal has no warnings', async (world: PortalWorld) => {
  await world.page.getByRole('combobox', { name: 'Client to set up' }).selectOption({ label: 'Cloudflare MCP portal' });
  await seen(connectCard(world).getByText('Add MCP server'));
  expect(await connectCard(world).locator('.alert').count()).toBe(0);
});

// ── instance settings ──

async function settingsPage(world: PortalWorld, slug: string) {
  await instancePage(world, slug, 'settings');
  await seen(world.page.getByLabel('Display name'));
}

When(
  'the admin turns on approval in the agent session in the settings of {instance} and saves',
  async (world: PortalWorld, slug: string) => {
    await settingsPage(world, slug);
    await turnOnInSession(world);
    await world.page.getByRole('button', { name: 'Save settings' }).click();
    await seen(world.page.getByRole('status').filter({ hasText: 'Saved.' }));
  },
);

Given('the plugin of {instance} may stop when idle', async (world: PortalWorld, slug: string) => {
  await world.editTasksManifest((m) => (m.lifecycle = 'on-demand'));
  await world.tasksInstance(slug);
});

/** Picks an idle time, keeps the memory warning the portal shows, and saves. */
async function pickIdleTime(world: PortalWorld, label: string, note: string) {
  await world.page.getByLabel('Stop the plugin when idle').selectOption({ label });
  world.noted[note] = (await world.page.getByRole('note').filter({ hasText: 'memory' }).textContent()) ?? '';
  await world.page.getByRole('button', { name: 'Save settings' }).click();
  await seen(world.page.getByRole('status').filter({ hasText: 'Saved.' }));
}

When(
  'the admin picks always on for {instance} in the settings, saves, and then picks 2 hours and saves',
  async (world: PortalWorld, slug: string) => {
    await settingsPage(world, slug);
    await pickIdleTime(world, 'Always on', 'alwaysOn');
    await pickIdleTime(world, 'After 2 hours', 'twoHours');
  },
);

Then(
  'the portal warned both times that the server may use more memory, and {instance} stops after 2 hours',
  async (world: PortalWorld, slug: string) => {
    expect(world.noted.alwaysOn).toContain('The server may use more memory');
    expect(world.noted.twoHours).toContain('The server may use more memory');
    expect((await world.instance(slug))?.settings).toMatchObject({ idleStopMs: 2 * 60 * 60_000 });
  },
);

When(
  'the admin types {string} in the delete question of {instance} and confirms with Enter',
  async (world: PortalWorld, typed: string, slug: string) => {
    await settingsPage(world, slug);
    world.noted.settings = JSON.stringify((await world.instance(slug))?.settings);
    await world.page.getByRole('button', { name: 'Delete endpoint…' }).click();
    const confirm = dialog(world).getByRole('textbox');
    await confirm.fill(typed);
    await confirm.press('Enter');
  },
);

Then('{instance} still exists, with its settings unchanged', async (world: PortalWorld, slug: string) => {
  await seen(dialog(world));
  expect(JSON.stringify((await world.instance(slug))?.settings)).toBe(world.noted.settings);
});

Then('after Delete, {instance} is gone and the portal shows the overview', async (world: PortalWorld, slug: string) => {
  await dialog(world).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => new URL(world.page.url()).pathname).toBe('/');
  expect(await world.instance(slug)).toBeUndefined();
});

Given(
  'the admin typed the display name {string} in the settings of {instance}',
  async (world: PortalWorld, name: string, slug: string) => {
    await settingsPage(world, slug);
    await world.page.getByLabel('Display name').fill(name);
  },
);

When('{instance} syncs in the background', async (world: PortalWorld, slug: string) => {
  const reloaded = world.page.waitForResponse((r) => new URL(r.url()).pathname === '/api/overview');
  const id = await instanceId(world, slug);
  await world.expectOk((await world.adminApi()).post(`/api/instances/${id}/sync`), 'sync');
  await reloaded;
});

Then('the display name still says {string}', async (world: PortalWorld, name: string) => {
  expect(await world.page.getByLabel('Display name').inputValue()).toBe(name);
});

// ── accepted sign-in methods ──

When('the admin opens the settings of {instance}', async (world: PortalWorld, slug: string) => {
  await settingsPage(world, slug);
});

Then('{instance} accepts {string}', async (world: PortalWorld, _slug: string, choice: string) => {
  expect(await world.page.getByRole('radio', { name: choice }).isChecked()).toBe(true);
});

Then(
  'the settings say approvers can use their Cloudflare Access identity, never an authenticator code',
  async (world: PortalWorld) => {
    await seen(world.page.getByText('Cloudflare Access identity', { exact: false }));
    expect(await world.page.locator('main, #app').first().textContent()).not.toContain('authenticator');
  },
);

When(
  'the admin picks {string} in the settings of {instance}',
  async (world: PortalWorld, choice: string, slug: string) => {
    await settingsPage(world, slug);
    const radio = world.page.getByRole('radio', { name: choice });
    await expect.poll(() => radio.isEnabled()).toBe(true);
    await radio.check();
  },
);

Then('{string} and {string} are ticked', async (world: PortalWorld, first: string, second: string) => {
  expect(await methodBox(world, first).isChecked()).toBe(true);
  expect(await methodBox(world, second).isChecked()).toBe(true);
});

Then('{string} cannot be ticked, as it is {string}', async (world: PortalWorld, method: string, why: string) => {
  expect(await methodBox(world, method).isDisabled()).toBe(true);
  await seen(world.page.getByRole('group', { name: 'Accepted client auth' }).getByText(why));
});

When(
  'the admin clears {string} in the settings of {instance} and saves',
  async (world: PortalWorld, method: string, slug: string) => {
    await settingsPage(world, slug);
    await methodBox(world, method).uncheck();
    await world.page.getByRole('button', { name: 'Save settings' }).click();
    await seen(world.page.getByRole('status').filter({ hasText: 'Saved.' }));
  },
);

Then('{string} cannot be ticked again', async (world: PortalWorld, method: string) => {
  expect(await methodBox(world, method).isDisabled()).toBe(true);
});

Then('{instance} now accepts only bearer tokens', async (world: PortalWorld, slug: string) => {
  expect((await world.instance(slug))?.authMethods).toEqual(['bearer']);
});

Then('the settings warn that {instance} {string}', async (world: PortalWorld, _slug: string, text: string) => {
  await seen(world.page.getByRole('group', { name: 'Accepted client auth' }).getByText(text, { exact: false }));
});

When('the admin opens the overview', async (world: PortalWorld) => {
  await world.openAsAdmin('/');
});

Then('{instance} is flagged {string}, as it refuses calls', async (world: PortalWorld, slug: string, flag: string) => {
  const row = world.page.getByRole('row').filter({ hasText: `/${slug}` });
  await seen(row.getByText(`${flag} — refuses calls`));
});

// ── pre-approval rules ──

async function startRule(world: PortalWorld, slug: string, name: string) {
  await instancePage(world, slug, 'rules');
  await world.page.getByRole('button', { name: 'New rule' }).click();
  await dialog(world)
    .getByRole('listbox', { name: /^Operation/ })
    .selectOption(opKey(name));
  await seen(dialog(world).getByRole('heading', { name: /^Only when/ }));
}

async function saveRule(world: PortalWorld, reason: string) {
  await dialog(world)
    .getByLabel(/^Reason/)
    .fill(reason);
  await dialog(world).getByRole('button', { name: 'Save rule' }).click();
  await expect.poll(() => dialog(world).count()).toBe(0);
}

const rulesTable = (world: PortalWorld) => world.page.getByRole('table', { name: 'Pre-approval rules' });

When(
  'the admin makes a rule for {string} on {instance} with the list {string}',
  async (world: PortalWorld, name: string, slug: string, list: string) => {
    await startRule(world, slug, name);
    const picker = dialog(world).getByRole('group').filter({ hasText: 'Every resolved target' });
    world.noted.scopes = (await picker.locator('label').allTextContents()).map((t) => t.trim()).join(', ');
    const scope = picker.getByLabel('List', { exact: true }).first();
    await scope.fill(list);
    await scope.press('Enter');
    await saveRule(world, 'the weekly shop');
  },
);

Then(
  'the rule editor offered only the field {string} and the field for each task',
  (world: PortalWorld, scope: string) => {
    expect(world.noted.scopes).toBe(`${scope}, List`);
  },
);

Then('the rules of {instance} show {string}', async (world: PortalWorld, _slug: string, text: string) => {
  await seen(rulesTable(world).getByText(text));
});

When(
  'the admin makes a rule for {string} on {instance} for lists that start with {string} and any tags',
  async (world: PortalWorld, name: string, slug: string, prefix: string) => {
    await startRule(world, slug, name);
    await dialog(world).getByRole('textbox', { name: /^List/ }).fill(prefix);
    await dialog(world)
      .locator('.field')
      .filter({ hasText: /^Tags/ })
      .getByRole('checkbox', { name: /any value/ })
      .check();
    await saveRule(world, 'the weekly shop');
  },
);

Then(
  'the rules of {instance} show that the list starts with {string} and that any tags are accepted',
  async (world: PortalWorld, _slug: string, prefix: string) => {
    await seen(rulesTable(world).getByText(`List starts with "${prefix}"`));
    await seen(rulesTable(world).getByText('Tags: any value'));
  },
);

When('the admin starts a rule for {string} on {instance}', async (world: PortalWorld, name: string, slug: string) => {
  await startRule(world, slug, name);
});

Then(
  'the help of the rules explains every setting of the rule editor, and its part on the operation mentions {string}',
  async (world: PortalWorld, text: string) => {
    await dialog(world).getByRole('button', { name: 'Help on Only when' }).click();
    const help = world.page
      .getByRole('complementary')
      .filter({ has: world.page.getByRole('button', { name: 'Close help' }) });
    await seen(help.getByRole('heading', { name: 'Pre-Approval Rules' }));
    const headings = await help.getByRole('heading', { level: 3 }).allTextContents();
    for (const setting of [
      'Operation',
      'Only when',
      'Other parameters',
      'Any other parameters',
      'Rate limit',
      'Expires',
      'Reason',
      'Enabled',
    ])
      expect(headings).toContain(setting);
    await seen(
      help
        .locator('section')
        .filter({ has: world.page.getByRole('heading', { name: 'Operation', exact: true }) })
        .filter({ hasText: text }),
    );
  },
);

Given(
  '{instance} has a rule for {string} with the reason {string}',
  async (world: PortalWorld, slug: string, name: string, reason: string) => {
    const id = await instanceId(world, slug);
    const op = (await operations(world, slug)).find((o) => o.key === opKey(name))!;
    await world.expectOk(
      (await world.adminApi()).post(`/api/instances/${id}/rules`, { operationId: op.id, match: [], reason }),
      'make a rule',
    );
  },
);

When('the admin deletes that rule and confirms the question', async (world: PortalWorld) => {
  await instancePage(world, 'groceries', 'rules');
  await rulesTable(world).getByRole('button', { name: 'Delete' }).click();
  await world.answerQuestion('Delete');
});

Then('{instance} has no rules', async (world: PortalWorld, slug: string) => {
  await seen(world.page.getByText('No pre-approval rules.', { exact: false }));
  const id = await instanceId(world, slug);
  expect(await world.expectOk((await world.adminApi()).get(`/api/instances/${id}/rules`), 'rules')).toEqual([]);
});

Given(
  'the admin changed the reason of that rule to {string} without saving',
  async (world: PortalWorld, reason: string) => {
    await instancePage(world, 'groceries', 'rules');
    await rulesTable(world).getByRole('button', { name: 'Edit' }).click();
    await dialog(world)
      .getByLabel(/^Reason/)
      .fill(reason);
    world.noted.reloads = '/api/instances/' + (await instanceId(world, 'groceries')) + '/rules';
  },
);

Then('the reason still says {string}', async (world: PortalWorld, reason: string) => {
  expect(
    await dialog(world)
      .getByLabel(/^Reason/)
      .inputValue(),
  ).toBe(reason);
});
