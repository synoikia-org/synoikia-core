import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { API_TOKEN } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

const REDACTED = '[REDACTED]';
type Fields = Record<string, unknown>;

/** The approval page each scenario opened, kept for its Then steps. */
const pages = new WeakMap<SynoikiaWorld, string>();

const valueOf = (key: string) => `value of ${key}`;

/** The task as Acme keeps it, to add fields to. */
const task = (world: SynoikiaWorld, title: string) => {
  for (const tasks of world.lists.values()) {
    const found = tasks.find((t) => t.title === title);
    if (found) return found;
  }
  throw new Error(`Acme has no task "${title}"`);
};

/** A value nested `levels` objects down under `more`. */
const nested = (levels: number, leaf: Fields): Fields => {
  let value = leaf;
  for (let i = 0; i < levels; i++) value = { more: value };
  return value;
};

/** The task as the agent got it from its last read in full. */
const seenTask = (world: SynoikiaWorld, title: string) => {
  const tasks = world.answer.result as Fields[];
  const found = tasks.find((t) => t.title === title);
  if (!found) throw new Error(`Agent got no task "${title}": ${JSON.stringify(world.answer)}`);
  return found;
};

/** Every value under `key`, at any depth. */
const valuesAt = (value: unknown, key: string): unknown[] => {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [...(k === key ? [v] : []), ...valuesAt(v, key)]);
};

const expectHidden = (world: SynoikiaWorld, title: string, keys: string[]) => {
  const seen = seenTask(world, title);
  for (const key of keys) {
    const values = valuesAt(seen, key);
    expect(values, key).not.toEqual([]);
    expect(values, key).toEqual(values.map(() => REDACTED));
  }
};

const expectAsKept = (world: SynoikiaWorld, title: string, keys: string[]) => {
  const seen = seenTask(world, title);
  for (const key of keys) expect(seen[key], key).toEqual(task(world, title)[key]);
};

const parameters = (html: string) => {
  const block = /<label>Parameters \(secrets redacted\)<\/label>\s*<pre>([\s\S]*?)<\/pre>/.exec(html)?.[1];
  if (!block) throw new Error('The approval page shows no parameters');
  return JSON.parse(
    block
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&'),
  ) as Fields;
};

const openPage = async (world: SynoikiaWorld) => {
  const html = pages.get(world) ?? (await world.approvalPage('admin')).html;
  pages.set(world, html);
  return html;
};

const charCodes = (text: string) => `String.fromCharCode(${[...text].map((c) => c.charCodeAt(0)).join(', ')})`;

const secretResult = async (world: SynoikiaWorld, spec: unknown) => {
  world.pluginFlag('secret-result', JSON.stringify(spec));
  await world.sync(world.lastInstance);
};

const setWebhookSecret = async (world: SynoikiaWorld, slug: string, secret: string) => {
  const id = await world.tasksInstance(slug);
  await world.expectOk(
    world.admin.put(`/api/instances/${id}/connection`, {
      config: { url: world.upstream!.url },
      secrets: { webhookSecret: secret },
    }),
    'set the webhook secret',
  );
};

Given(
  'Acme keeps {string}, {string} and {string} on the task {string}, each one deeper than the last',
  (world: SynoikiaWorld, a: string, b: string, c: string, title: string) => {
    Object.assign(task(world, title), {
      [a]: valueOf(a),
      inner: { [b]: valueOf(b), inner: [{ [c]: valueOf(c) }] },
    });
  },
);

Given(
  'Acme keeps {string}, {string}, {string} and {string} on the task {string}',
  (world: SynoikiaWorld, a: string, b: string, c: string, d: string, title: string) => {
    for (const key of [a, b, c, d]) task(world, title)[key] = valueOf(key);
  },
);

Given(
  'Acme keeps {string} as true, {string} as {int} and {string} as empty on the task {string}',
  (world: SynoikiaWorld, flag: string, count: string, n: number, empty: string, title: string) => {
    Object.assign(task(world, title), { [flag]: true, [count]: n, [empty]: '' });
  },
);

Given('Acme keeps {string} on the task {string}', (world: SynoikiaWorld, key: string, title: string) => {
  task(world, title)[key] = valueOf(key);
});

Given('Acme keeps {string} on the task {string} one level down', (world: SynoikiaWorld, key: string, title: string) => {
  task(world, title).details = { [key]: valueOf(key) };
});

Given(
  'Acme keeps {string} on the task {string} three levels down',
  (world: SynoikiaWorld, key: string, title: string) => {
    task(world, title).details = nested(2, { [key]: valueOf(key) });
  },
);

Given(
  'Acme keeps the note {string} on the task {string} twenty levels down',
  (world: SynoikiaWorld, note: string, title: string) => {
    task(world, title).details = nested(19, { note });
  },
);

Given('Acme keeps a field named after the API token on the task {string}', (world: SynoikiaWorld, title: string) => {
  task(world, title)[API_TOKEN] = 'yes';
});

Given(
  'Acme has a task in {string} whose title holds the webhook secret in encoded form',
  (world: SynoikiaWorld, list: string) => {
    world.lists.get(list)!.push({ title: `login with ${encodeURIComponent('p@ss word!')} failed`, done: false });
  },
);

Given('Acme has the task {string} in {string}', (world: SynoikiaWorld, title: string, list: string) => {
  world.lists.get(list)!.push({ title, done: false });
});

Given(
  'the plugin of {string} lists {string} as a sensitive key',
  async (world: SynoikiaWorld, _slug: string, key: string) => {
    await world.editManifest((m) => {
      m.sensitiveKeys = [key];
    });
  },
);

Given(
  'the admin lists {string} as a sensitive key of {string}',
  async (world: SynoikiaWorld, key: string, slug: string) => {
    await world.instanceSettings(slug, { extraRedactKeys: [key] });
  },
);

Given(
  'agent {word} waits for the admin to approve the add of {string} to {string} with the PIN {string}',
  async (world: SynoikiaWorld, agent: string, title: string, list: string, pin: string) => {
    await world.call(agent, 'add a task', { list, title, pin });
    expect(world.answer).toMatchObject({ status: 'awaiting_approval' });
  },
);

Given(
  'the plugin of {string} declares the field {string} of the open tasks secret',
  async (world: SynoikiaWorld, _slug: string, key: string) => {
    await secretResult(world, { keys: [key] });
  },
);

Given(
  'the plugin of {string} declares the field {string} of the open tasks secret at any depth',
  async (world: SynoikiaWorld, _slug: string, key: string) => {
    await secretResult(world, { keys: [key], deep: true });
  },
);

Given('the plugin of {string} declares the whole result of the open tasks secret', async (world: SynoikiaWorld) => {
  await secretResult(world, 'whole');
});

Given(
  'the instance {string} has the webhook secret {string}',
  async (world: SynoikiaWorld, slug: string, secret: string) => {
    await setWebhookSecret(world, slug, secret);
  },
);

Given(
  'the plugin of {string} names the share password in its changes by {string}',
  (world: SynoikiaWorld, _slug: string, form: string) => {
    const forms: Record<string, string | undefined> = {
      'a pointer': undefined,
      'a dot path': 'dot',
      'a bare name': 'bare',
    };
    if (!(form in forms)) throw new Error(`No path form "${form}"`);
    const value = forms[form];
    if (value) world.pluginFlag('diff-path', value);
  },
);

When(
  'agent {word} reads the open tasks of {string} in full',
  async (world: SynoikiaWorld, agent: string, list: string) => {
    await world.call(agent, 'show the open tasks', { list });
  },
);

When('the admin opens the approval page', async (world: SynoikiaWorld) => {
  await openPage(world);
});

When(
  'the code of agent {word} builds the API token from its characters and returns it',
  async (world: SynoikiaWorld, agent: string) => {
    await world.execute(agent, world.lastInstance, `return ${charCodes(API_TOKEN)};`);
  },
);

When(
  'the code of agent {word} builds the API token from its characters and logs it',
  async (world: SynoikiaWorld, agent: string) => {
    await world.execute(agent, world.lastInstance, `console.log('the token is', ${charCodes(API_TOKEN)}); return 1;`);
  },
);

When(
  'the code of agent {word} builds the API token from its characters and throws it in an error',
  async (world: SynoikiaWorld, agent: string) => {
    await world.execute(agent, world.lastInstance, `throw new Error('bad token ' + ${charCodes(API_TOKEN)});`);
  },
);

When(
  'agent {word} renames {string} to {string} with the lock code {string}',
  async (world: SynoikiaWorld, agent: string, list: string, name: string, lockCode: string) => {
    await world.call(agent, 'rename a list', { list, name, lockCode });
    expect(world.answer).toMatchObject({ status: 'awaiting_approval' });
  },
);

When(
  'the code of agent {word} adds {string} to {string} with a parameter named {string}',
  async (world: SynoikiaWorld, agent: string, title: string, list: string, name: string) => {
    const params = `{"list":${JSON.stringify(list)},"title":${JSON.stringify(title)},${JSON.stringify(name)}:{"force":true}}`;
    await world.execute(
      agent,
      world.lastInstance,
      `return await tasks.call('tasks.add', JSON.parse(${JSON.stringify(params)}));`,
    );
    expect(world.answer).toMatchObject({ status: 'awaiting_approval' });
  },
);

Then(
  'agent {word} sees {string}, {string} and {string} of {string} as [REDACTED]',
  (world: SynoikiaWorld, _agent: string, a: string, b: string, c: string, title: string) => {
    expectHidden(world, title, [a, b, c]);
  },
);

Then(
  'agent {word} sees {string}, {string} and {string} of {string} as Acme keeps them, but {string} as [REDACTED]',
  (world: SynoikiaWorld, _agent: string, a: string, b: string, c: string, title: string, hidden: string) => {
    expectAsKept(world, title, [a, b, c]);
    expectHidden(world, title, [hidden]);
  },
);

Then(
  'agent {word} sees {string}, {string} and {string} of {string} as Acme keeps them',
  (world: SynoikiaWorld, _agent: string, a: string, b: string, c: string, title: string) => {
    expectAsKept(world, title, [a, b, c]);
  },
);

Then(
  'agent {word} sees {string} of {string} as [REDACTED]',
  (world: SynoikiaWorld, _agent: string, key: string, title: string) => {
    expectHidden(world, title, [key]);
  },
);

Then(
  'agent {word} sees {string} of {string} one level down as Acme keeps it',
  (world: SynoikiaWorld, _agent: string, key: string, title: string) => {
    expect(seenTask(world, title).details).toEqual({ [key]: valueOf(key) });
  },
);

Then('the approval page shows the PIN as [REDACTED]', async (world: SynoikiaWorld) => {
  expect(parameters(await openPage(world)).pin).toBe(REDACTED);
});

Then(
  'the audit log shows the PIN of the add of {string} as [REDACTED]',
  async (world: SynoikiaWorld, title: string) => {
    const rows = (await world.audit({ kind: 'call', operation: 'tasks.add' })) as {
      params?: Fields | null;
    }[];
    const adds = rows.filter((r) => r.params?.title === title);
    expect(adds).not.toEqual([]);
    for (const row of adds) expect(row.params?.pin).toBe(REDACTED);
  },
);

Then('Acme receives the add of {string} with the PIN {string}', (world: SynoikiaWorld, title: string, pin: string) => {
  expect(world.upstreamRequests('POST', '/lists/Groceries/tasks').map((r) => r.body)).toEqual([{ title, pin }]);
});

Then('agent {word} gets [REDACTED] in place of the tasks', (world: SynoikiaWorld) => {
  expect(world.answer).toEqual({ result: REDACTED });
});

Then('agent {word} gets [REDACTED]', (world: SynoikiaWorld) => {
  expect(world.answer).toEqual({ result: REDACTED });
});

Then(
  'agent {word} sees [REDACTED] in place of the note {string}',
  (world: SynoikiaWorld, _agent: string, note: string) => {
    const seen = JSON.stringify(seenTask(world, 'milk'));
    expect(seen).not.toContain(note);
    expect(seen).toContain(REDACTED);
  },
);

Then(
  'agent {word} sees [REDACTED] in place of the API token, in the title and in the field name',
  (world: SynoikiaWorld) => {
    expect(JSON.stringify(world.answer)).not.toContain(API_TOKEN);
    seenTask(world, 'token [REDACTED] for the shop');
    expect(seenTask(world, 'milk')[REDACTED]).toBe('yes');
  },
);

Then('agent {word} sees [REDACTED] in place of the webhook secret', (world: SynoikiaWorld) => {
  seenTask(world, 'login with [REDACTED] failed');
});

Then(
  'agent {word} gets {string}, {string}, {string} and {string}',
  (world: SynoikiaWorld, _agent: string, a: string, b: string, c: string, d: string) => {
    expect(world.answer).toEqual({ result: [a, b, c, d] });
  },
);

Then('the approval page shows the lock code as [REDACTED]', async (world: SynoikiaWorld) => {
  const html = await openPage(world);
  expect(parameters(html).lockCode).toBe(REDACTED);
  const block = /<label>Changes<\/label>\s*<pre>([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? '';
  const changes = JSON.parse(block.replace(/&quot;/g, '"')) as { path: string; after?: unknown }[];
  expect(changes.find((c) => c.path === '/lockCode')?.after).toBe(REDACTED);
});

Then('the approval page never shows {string}', async (world: SynoikiaWorld, text: string) => {
  expect(await openPage(world)).not.toContain(text);
});

Then('the approval page shows the parameter {string} with its value', async (world: SynoikiaWorld, name: string) => {
  const params = parameters(await openPage(world));
  expect(Object.hasOwn(params, name)).toBe(true);
  expect(params[name]).toEqual({ force: true });
  expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
  expect(({} as Fields).force).toBeUndefined();
});
