import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { ErrorCodes, joinApiPath } from '@synoikia/plugin-sdk';
import type { BodyEncoding, HttpJsonClient } from '@synoikia/plugin-sdk';
import type { PluginAuthorWorld } from '../../support/world.js';

const tasksPath = (world: PluginAuthorWorld, list: string) => `/lists/${world.list(list).id}/tasks`;

const read = (world: PluginAuthorWorld, list: string, client: HttpJsonClient = world.session ?? world.client()) =>
  world.call(() => client.request('GET', tasksPath(world, list)));

const error = (world: PluginAuthorWorld) => {
  const last = world.last;
  expect(last.ok, last.ok ? JSON.stringify(last.value) : '').toBe(false);
  return (last as { error: Error & { code?: string; data?: unknown } }).error;
};

const ERROR_KINDS: Record<string, string> = {
  denied: ErrorCodes.UpstreamDenied,
  'invalid-parameters': ErrorCodes.InvalidParams,
  upstream: ErrorCodes.UpstreamError,
};

Given(
  'Acme Tasks has the list {string} with the open tasks {string}, {string} and {string}',
  async (world: PluginAuthorWorld, name: string, a: string, b: string, c: string) => {
    world.addList(name, [a, b, c]);
    await world.startAcme();
  },
);

Given('the plugin connects to Acme Tasks with the API token {string}', (world: PluginAuthorWorld, token: string) => {
  world.token = token;
});

Given('the plugin connects with the revoked API token {string}', (world: PluginAuthorWorld, token: string) => {
  world.token = token;
});

When('the plugin adds {string} to {string}', async (world: PluginAuthorWorld, title: string, list: string) => {
  await world.call(() => world.client().request('POST', tasksPath(world, list), { body: { title } }));
});

Then(
  'Acme Tasks receives the task {string} with the token {string}',
  (world: PluginAuthorWorld, title: string, token: string) => {
    const add = world.received.at(-1)!;
    expect(add.method).toBe('POST');
    expect(add.headers.authorization).toBe(`Bearer ${token}`);
    expect(add.headers['content-type']).toBe('application/json');
    expect(JSON.parse(add.body)).toEqual({ title });
  },
);

Then(
  'the list {string} holds the open tasks {string}, {string}, {string} and {string}',
  (world: PluginAuthorWorld, list: string, ...rest: unknown[]) => {
    expect(
      world
        .list(list)
        .tasks.filter((t) => !t.done)
        .map((t) => t.title),
    ).toEqual(rest.slice(0, 4));
  },
);

When(
  'the plugin reads the open tasks of {string} and gives the task {string} with the read',
  async (world: PluginAuthorWorld, list: string, title: string) => {
    await world.call(() => world.client().request('GET', tasksPath(world, list), { body: { title } }));
  },
);

Then('Acme Tasks receives the read with no body', (world: PluginAuthorWorld) => {
  const req = world.received.at(-1)!;
  expect(req.method).toBe('GET');
  expect(req.body).toBe('');
  expect(req.headers['content-type']).toBeUndefined();
});

Then('the plugin gets {string}, {string} and {string}', (world: PluginAuthorWorld, a: string, b: string, c: string) => {
  expect(world.last).toEqual({ ok: true, value: [a, b, c] });
});

When(
  'the plugin completes {string} in {string} and asks for the version of Acme Tasks',
  async (world: PluginAuthorWorld, title: string, list: string) => {
    const client = world.client();
    await world.call(() => client.request('PATCH', `${tasksPath(world, list)}/${encodeURIComponent(title)}`));
    await world.call(() => client.request('GET', '/version'));
  },
);

Then('the completion gives nothing', (world: PluginAuthorWorld) => {
  expect(world.outcomes.at(-2)).toEqual({ ok: true, value: null });
});

Then('the version reads {string}', (world: PluginAuthorWorld, version: string) => {
  expect(world.last).toEqual({ ok: true, value: version });
});

Given('Acme Tasks fails reads of {string} with {string}', (world: PluginAuthorWorld, list: string, message: string) => {
  world.addList(list);
  world.failures.set(list, message);
});

Given(
  'Acme Tasks fails reads of {string} with a message of {int} copies of {string}',
  (world: PluginAuthorWorld, list: string, n: number, text: string) => {
    world.addList(list);
    world.failures.set(list, text.repeat(n));
  },
);

When('the plugin reads the open tasks of {string}', async (world: PluginAuthorWorld, list: string) => {
  await read(world, list);
});

Then(
  'the plugin gets the denied error {string} and {string}',
  (world: PluginAuthorWorld, start: string, end: string) => {
    const err = error(world);
    expect(err.code).toBe(ErrorCodes.UpstreamDenied);
    expect(err.message.startsWith(start), err.message).toBe(true);
    expect(err.message.endsWith(end), err.message).toBe(true);
  },
);

Then(
  /^the plugin gets the (denied|invalid-parameters|upstream) error "([^"]+)"$/,
  (world: PluginAuthorWorld, kind: string, text: string) => {
    const err = error(world);
    expect(err.code).toBe(ERROR_KINDS[kind]);
    expect(err.message).toContain(text);
  },
);

Then('no error holds the token {string}', (world: PluginAuthorWorld, token: string) => {
  for (const o of world.outcomes.filter((x) => !x.ok)) {
    const err = (o as { error: Error }).error;
    expect(`${err.message} ${JSON.stringify(err)} ${err.stack ?? ''}`).not.toContain(token);
  }
});

Then(
  'the plugin gets an error whose text from Acme Tasks stops after {int} characters with {string}',
  (world: PluginAuthorWorld, max: number, end: string) => {
    const err = error(world);
    const text = err.message.slice(err.message.indexOf(': ') + 2);
    expect(text).toHaveLength(max + end.length);
    expect(text.endsWith(end), err.message).toBe(true);
  },
);

When('the plugin reads a page of Acme Tasks that moved to another host', async (world: PluginAuthorWorld) => {
  await world.call(() => world.client().request('GET', '/moved'));
});

Then('the other host gets no request', (world: PluginAuthorWorld) => {
  expect(world.otherHostReceived).toEqual([]);
});

Given(
  'the plugin accepts answers of at most {int} bytes, and Acme Tasks answers with {int}',
  (world: PluginAuthorWorld, max: number, size: number) => {
    expect(size).toBe(2048);
    world.maxBytes = max;
    world.bigAnswer = true;
  },
);

Given(
  'the plugin waits {int} milliseconds, and Acme Tasks answers after {int}',
  (world: PluginAuthorWorld, wait: number, after: number) => {
    world.timeoutMs = wait;
    world.slowMs = after;
  },
);

Given('Acme Tasks is down', async (world: PluginAuthorWorld) => {
  await world.stopAcme();
});

When('the plugin reads the path {string}', async (world: PluginAuthorWorld, p: string) => {
  world.received.length = 0;
  await world.call(() => world.client().request('GET', p));
});

Given('Acme Tasks takes a session sign-in instead of the token', (world: PluginAuthorWorld) => {
  world.sessionMode = true;
});

When('the plugin reads the open tasks of {string} twice', async (world: PluginAuthorWorld, list: string) => {
  const client = world.sessionClient();
  await read(world, list, client);
  await read(world, list, client);
});

Then('the plugin signed in to Acme Tasks once', (world: PluginAuthorWorld) => {
  expect(world.signIns).toBe(1);
});

Given('the plugin read the open tasks of {string} once', async (world: PluginAuthorWorld, list: string) => {
  world.session = world.sessionClient();
  await read(world, list, world.session);
  expect(world.last.ok).toBe(true);
});

Given('Acme Tasks ends every session', (world: PluginAuthorWorld) => {
  world.sessions.clear();
});

Then(
  'the plugin signed in to Acme Tasks twice, and gets {string}, {string} and {string}',
  (world: PluginAuthorWorld, a: string, b: string, c: string) => {
    expect(world.signIns).toBe(2);
    expect(world.last).toEqual({ ok: true, value: [a, b, c] });
  },
);

When(
  'the plugin signs in with the user {string} and the phrase {string}',
  async (world: PluginAuthorWorld, username: string, password: string) => {
    await world.call(() =>
      world.client().raw('POST', '/login', { body: { username, password }, bodyEncoding: 'form' }),
    );
  },
);

Then('Acme Tasks receives the form {string}', (world: PluginAuthorWorld, form: string) => {
  const req = world.received.at(-1)!;
  expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
  expect(req.body).toBe(form);
  expect(req.headers['content-length']).toBe(String(Buffer.byteLength(form)));
});

Then(
  'the plugin reads the cookie {string}, marked {string}',
  (world: PluginAuthorWorld, cookie: string, flag: string) => {
    const last = world.last as { ok: true; value: { headers: Record<string, unknown> } };
    expect(last.value.headers['set-cookie']).toEqual([`${cookie}; ${flag}`]);
  },
);

When(
  'the plugin sends the task {string} with the tags {string} and {string}, not done, as form fields',
  async (world: PluginAuthorWorld, title: string, a: string, b: string) => {
    const body = { title, tags: [a, b], done: false, note: null, due: undefined };
    await world.call(() => world.client().request('POST', '/echo', { body, bodyEncoding: 'form' }));
  },
);

When(
  'the plugin sends the field {string} with {string} and the field {string} with two lines, twice as multipart fields',
  async (world: PluginAuthorWorld, odd: string, value: string, notes: string) => {
    world.multipart = { [odd]: value, [notes]: 'line one\nline two' };
    for (let i = 0; i < 2; i++)
      await world.call(() =>
        world.client().request('POST', '/echo', { body: world.multipart, bodyEncoding: 'multipart' }),
      );
  },
);

const boundaryOf = (contentType: string | undefined) =>
  /^multipart\/form-data; boundary=(synoikia-[0-9a-f]{32})$/.exec(contentType ?? '')?.[1];

Then(
  'Acme Tasks receives the parts {string} and {string} with their values unchanged',
  (world: PluginAuthorWorld, a: string, b: string) => {
    const req = world.received.at(-1)!;
    const boundary = boundaryOf(req.headers['content-type']);
    expect(boundary).toBeDefined();
    const values = Object.values(world.multipart!);
    expect(req.body).toBe(
      [
        `--${boundary}`,
        `content-disposition: form-data; name="${a}"`,
        '',
        values[0],
        `--${boundary}`,
        `content-disposition: form-data; name="${b}"`,
        '',
        values[1],
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    );
  },
);

Then('the two sends use different random boundaries', (world: PluginAuthorWorld) => {
  const [one, two] = world.received.slice(-2).map((r) => boundaryOf(r.headers['content-type']));
  expect(one).toBeDefined();
  expect(one).not.toBe(two);
});

const BODIES: Record<string, unknown> = {
  'the text "milk"': 'milk',
  'a list of tasks': ['milk', 'bread'],
  'a task': { title: 'milk' },
};
const ENCODINGS: Record<string, string> = {
  'form fields': 'form',
  'multipart fields': 'multipart',
  '"xml"': 'xml',
};

When(
  /^the plugin sends (the text "milk"|a list of tasks|a task) as (form fields|multipart fields|"xml")$/,
  async (world: PluginAuthorWorld, body: string, encoding: string) => {
    world.received.length = 0;
    await world.call(() =>
      world.client().request('POST', '/echo', {
        body: BODIES[body],
        bodyEncoding: ENCODINGS[encoding] as BodyEncoding,
      }),
    );
  },
);

When(
  /^the plugin joins "([^"]+)" to the base address "([^"]+)" for (plain calls|a live channel)$/,
  (world: PluginAuthorWorld, suffix: string, base: string, use: string) => {
    try {
      world.address = { value: joinApiPath(base, suffix, { websocket: use === 'a live channel' }) };
    } catch (err) {
      world.address = { error: (err as Error).message };
    }
  },
);

Then('the base address is refused with {string}', (world: PluginAuthorWorld, reason: string) => {
  expect(world.address?.value).toBeUndefined();
  expect(world.address!.error).toContain(reason);
});

Then('the plugin gets the address {string}', (world: PluginAuthorWorld, address: string) => {
  expect(world.address).toEqual({ value: address });
});
