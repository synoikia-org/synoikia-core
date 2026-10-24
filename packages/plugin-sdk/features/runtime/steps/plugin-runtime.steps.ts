import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { ErrorCodes, PendingRequests, PluginError } from '@synoikia/plugin-sdk';
import type { RpcResponse } from '@synoikia/plugin-sdk';
import { operationOf } from '../../support/acme-description.js';
import type { PluginAuthorWorld } from '../../support/world.js';

const ERRORS: Record<string, string> = {
  'method-not-found': ErrorCodes.MethodNotFound,
  'unknown-operation': ErrorCodes.UnknownOperation,
  'invalid-parameters': ErrorCodes.InvalidParams,
  upstream: ErrorCodes.UpstreamError,
  internal: ErrorCodes.Internal,
};

const result = (res: RpcResponse | undefined): unknown => {
  expect(res && 'result' in res, JSON.stringify(res)).toBe(true);
  return (res as { result: unknown }).result;
};

const failure = (res: RpcResponse | undefined) => {
  expect(res && 'error' in res, JSON.stringify(res)).toBe(true);
  return (res as { error: { code: string; message: string } }).error;
};

/** One call as core makes it: resolve the agent's request, then invoke the operation it resolved to. */
const callOperation = async (world: PluginAuthorWorld, request: unknown, deadlineMs = 5000) => {
  const resolved = await world.send('resolveOperation', { fn: 'request', args: [request] });
  if ('error' in resolved) return resolved;
  const { key, params } = resolved.result as { key: string; params: unknown };
  world.kept.resolvedKey = key;
  return world.send('invoke', { key, params, context: { callId: `c-${world.replies.length}`, deadlineMs } });
};

const readRequest = (world: PluginAuthorWorld, list: string) => ({ path: `/lists/${world.list(list).id}/tasks` });
const TOKEN_REQUEST = { method: 'post', path: '/tokens' };

const connect = async (world: PluginAuthorWorld, over: Parameters<PluginAuthorWorld['initParams']>[0] = {}) => {
  await world.startPlugin();
  expect(result(await world.send('init', world.initParams(over)))).toBeNull();
};

Given(
  'plugin.yaml of the plugin keeps the result of {string} secret and locks {string} with a twin for other users',
  (world: PluginAuthorWorld, secret: string, locked: string) => {
    world.setYaml({ defaults: { confirm: { param: '/path/listId' } } });
    world.addRule({ match: world.keyOf(secret), sensitiveResult: 'whole' });
    world.addRule({ match: world.keyOf(locked), locked: true, split: 'other-user' });
  },
);

Given('core started the plugin', async (world: PluginAuthorWorld) => {
  await world.startPlugin();
});

Given('core connected the plugin to Acme Tasks', async (world: PluginAuthorWorld) => {
  await connect(world);
});

Given(
  'core connected the plugin to Acme Tasks with the contract {string}',
  async (world: PluginAuthorWorld, sdkVersion: string) => {
    await connect(world, { sdkVersion });
  },
);

Given(
  'core connected the plugin to Acme Tasks with the revoked API token {string}',
  async (world: PluginAuthorWorld, token: string) => {
    await connect(world, { secrets: { token } });
  },
);

Given('core connected the plugin to Acme Tasks with a session sign-in', async (world: PluginAuthorWorld) => {
  await connect(world, { config: { baseUrl: world.baseUrl, signIn: 'session' } });
});

When('core sends the plugin the method {string}', async (world: PluginAuthorWorld, method: string) => {
  await world.send(method, {});
});

Then(
  /^core gets an? (method-not-found|unknown-operation|invalid-parameters|upstream|internal) error(?: "(.+)")?$/,
  (world: PluginAuthorWorld, kind: string, message?: string) => {
    const err = failure(world.lastReply);
    expect(err.code).toBe(ERRORS[kind]);
    if (message) expect(err.message).toContain(message);
  },
);

When(/^core asks the plugin to resolve the request (.+)$/, async (world: PluginAuthorWorld, request: string) => {
  await world.send('resolveOperation', { fn: 'request', args: [parseYaml(request)] });
});

When('core syncs the catalog', async (world: PluginAuthorWorld) => {
  await world.send('syncCatalog');
});

When(
  'core syncs the catalog, then calls {string} and {string} of {string}',
  async (world: PluginAuthorWorld, token: string, read: string, list: string) => {
    expect([token, read]).toEqual(['Create an API token', 'Show the open tasks']);
    world.kept.sync = await world.send('syncCatalog');
    world.kept.token = await callOperation(world, TOKEN_REQUEST);
    world.kept.read = await callOperation(world, readRequest(world, list));
  },
);

When(
  'core calls {string}, then {string} of {string}',
  async (world: PluginAuthorWorld, token: string, read: string, list: string) => {
    expect([token, read]).toEqual(['Create an API token', 'Show the open tasks']);
    world.kept.token = await callOperation(world, TOKEN_REQUEST);
    world.kept.read = await callOperation(world, readRequest(world, list));
  },
);

When('core syncs the catalog, then calls {string}', async (world: PluginAuthorWorld, token: string) => {
  expect(token).toBe('Create an API token');
  world.kept.sync = await world.send('syncCatalog');
  world.kept.token = await callOperation(world, TOKEN_REQUEST);
});

Then(
  'the sync and the token call are refused with {string} and {string}',
  (world: PluginAuthorWorld, a: string, b: string) => {
    for (const res of [world.kept.sync, world.kept.token] as RpcResponse[]) {
      const err = failure(res);
      expect(err.code).toBe(ErrorCodes.Internal);
      expect(err.message).toContain(a);
      expect(err.message).toContain(b);
    }
  },
);

Then('the token call is refused with {string}', (world: PluginAuthorWorld, reason: string) => {
  expect(failure(world.kept.token as RpcResponse).message).toContain(reason);
});

Then('Acme Tasks makes no token', (world: PluginAuthorWorld) => {
  expect(world.received.filter((r) => r.path === '/api/tokens')).toEqual([]);
});

Then('Acme Tasks served its description once', (world: PluginAuthorWorld) => {
  expect(world.descriptionReads).toBe(1);
});

Then('the read gives {string}, {string} and {string}', (world: PluginAuthorWorld, ...tasks: unknown[]) => {
  expect(result((world.kept.read as RpcResponse | undefined) ?? world.lastReply)).toEqual(tasks.slice(0, 3));
});

Then(
  'the catalog keeps the whole result of {string} secret, and the call gives the token {string}',
  (world: PluginAuthorWorld, summary: string, token: string) => {
    const catalog = result(world.kept.sync as RpcResponse) as {
      operations: { key: string; sensitiveResult?: unknown }[];
    };
    expect(catalog.operations.find((o) => o.key === world.keyOf(summary))?.sensitiveResult).toBe('whole');
    expect(result(world.kept.token as RpcResponse)).toEqual({ token });
  },
);

Given('core connected the plugin to Acme Tasks and synced the catalog twice', async (world: PluginAuthorWorld) => {
  await connect(world);
  result(await world.send('syncCatalog'));
  result(await world.send('syncCatalog'));
});

When('core connects the plugin again and syncs the catalog', async (world: PluginAuthorWorld) => {
  result(await world.send('init', world.initParams()));
  await world.send('syncCatalog');
});

Then(
  'the plugin closed its first connection, and Acme Tasks served its description twice',
  (world: PluginAuthorWorld) => {
    result(world.lastReply);
    expect(world.pluginLog).toEqual([`closed the connection to ${world.baseUrl}`]);
    expect(world.descriptionReads).toBe(2);
  },
);

When('core connects the plugin again with no base address', async (world: PluginAuthorWorld) => {
  await world.send('init', world.initParams({ config: {} }));
});

Then(
  'the plugin closed no connection, and still reads {string}, {string} and {string} of {string}',
  async (world: PluginAuthorWorld, a: string, b: string, c: string, list: string) => {
    expect(world.pluginLog).toEqual([]);
    expect(result(await callOperation(world, readRequest(world, list)))).toEqual([a, b, c]);
  },
);

When('core tests the connection', async (world: PluginAuthorWorld) => {
  await world.send('testConnection');
});

Then('the test passes with the version {string}', (world: PluginAuthorWorld, version: string) => {
  expect(result(world.lastReply)).toEqual({ ok: true, upstreamVersion: version });
});

Then('the test fails with {string}', (world: PluginAuthorWorld, reason: string) => {
  const res = result(world.lastReply) as { ok: boolean; message: string };
  expect(res.ok).toBe(false);
  expect(res.message).toContain(reason);
  expect(res.message).not.toContain(world.token);
});

When(
  'core calls {string} of {string} with {int} milliseconds left',
  async (world: PluginAuthorWorld, read: string, list: string, left: number) => {
    expect(read).toBe('Show the open tasks');
    world.kept.read = await callOperation(world, readRequest(world, list), left);
  },
);

When(
  'core calls {string} of {string} twice at the same time',
  async (world: PluginAuthorWorld, read: string, list: string) => {
    expect(read).toBe('Show the open tasks');
    const [a, b] = await Promise.all([
      callOperation(world, readRequest(world, list)),
      callOperation(world, readRequest(world, list)),
    ]);
    expect([result(a), result(b)]).toEqual([
      ['milk', 'bread', 'eggs'],
      ['milk', 'bread', 'eggs'],
    ]);
  },
);

Given(
  'the first catalog sync failed because Acme Tasks did not serve its description',
  async (world: PluginAuthorWorld) => {
    world.descriptionFailures.add('v4.2');
    expect(failure(await world.send('syncCatalog')).message).toContain('Fetching the Acme Tasks API spec failed');
    world.descriptionFailures.clear();
  },
);

Then('core gets the catalog with {string}', (world: PluginAuthorWorld, summary: string) => {
  const catalog = result(world.lastReply) as { operations: { docs?: { summary?: string } }[] };
  expect(catalog.operations.map((o) => o.docs?.summary)).toContain(summary);
});

Given('a slow catalog sync is still loading when core connects the plugin again', async (world: PluginAuthorWorld) => {
  world.descriptionSlowMs = 300;
  const slow = world.send('syncCatalog');
  await expect.poll(() => world.descriptionReads).toBe(1);
  result(await world.send('init', world.initParams()));
  world.kept.slow = slow;
});

Given('Acme Tasks then renames {string} to {string}', async (world: PluginAuthorWorld, from: string, to: string) => {
  operationOf(world.description, from).summary = to;
  world.descriptionSlowMs = 0;
  const stale = result(await (world.kept.slow as Promise<RpcResponse>)) as {
    operations: { docs?: { summary?: string } }[];
  };
  expect(stale.operations.map((o) => o.docs?.summary)).toContain(from);
});

Given(
  'the plugin waits on a live channel of Acme Tasks for {string} and {string}',
  (world: PluginAuthorWorld, a: string, b: string) => {
    const pending = new PendingRequests();
    world.kept.pending = pending;
    world.kept.waits = [a, b].map((label) =>
      pending.start(label, 10_000).promise.then(
        () => 'answered',
        (err: Error) => err.message,
      ),
    );
  },
);

When('the live channel closes with {string}', (world: PluginAuthorWorld, reason: string) => {
  (world.kept.pending as PendingRequests).failAll(new PluginError(ErrorCodes.UpstreamError, reason));
});

Then('both requests fail with {string}', async (world: PluginAuthorWorld, reason: string) => {
  expect(await Promise.all(world.kept.waits as Promise<string>[])).toEqual([reason, reason]);
  expect((world.kept.pending as PendingRequests).size).toBe(0);
});

When(
  'the plugin waits {int} milliseconds for {string} on a live channel that does not answer',
  async (world: PluginAuthorWorld, ms: number, label: string) => {
    await world.call(() => new PendingRequests().start(label, ms).promise);
  },
);

Given('Acme Tasks tags {string} with {string}', (world: PluginAuthorWorld, summary: string, tag: string) => {
  operationOf(world.description, summary).tags = [tag];
});

Then('{string} is in the group {string}', (world: PluginAuthorWorld, summary: string, group: string) => {
  expect(world.operation(world.keyOf(summary)).group).toBe(group);
});

Given('Acme Tasks has the list {string} of another user', (world: PluginAuthorWorld, name: string) => {
  world.addList(name).owner = 'another user';
});

When(/^core resolves and runs the request (.+)$/, async (world: PluginAuthorWorld, request: string) => {
  await callOperation(world, parseYaml(request));
});

Then(
  'the plugin resolved {string} for {string}, and Acme Tasks no longer has the list {string}',
  (world: PluginAuthorWorld, summary: string, suffix: string, list: string) => {
    expect(world.kept.resolvedKey).toBe(`${world.keyOf(summary)}#${suffix}`);
    expect(result(world.lastReply)).toBeNull();
    expect(world.lists.map((l) => l.name)).not.toContain(list);
  },
);

When(
  'core starts Acme Tasks and asks for a heartbeat every {int} milliseconds',
  async (world: PluginAuthorWorld, heartbeatMs: number) => {
    await connect(world, { heartbeatMs });
  },
);

When('core {word} starts Acme Tasks', async (world: PluginAuthorWorld, sdkVersion: string) => {
  await connect(world, { sdkVersion });
});

Then(
  'core gets at least {int} heartbeats from Acme Tasks within a second',
  async (world: PluginAuthorWorld, count: number) => {
    await new Promise((r) => setTimeout(r, 1000));
    expect(world.heartbeats).toBeGreaterThanOrEqual(count);
  },
);

Then('core gets no heartbeat from Acme Tasks within a second', async (world: PluginAuthorWorld) => {
  await new Promise((r) => setTimeout(r, 1000));
  expect(world.heartbeats).toBe(0);
});
