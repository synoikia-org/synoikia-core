import { createHmac } from 'node:crypto';
import { rmSync } from 'node:fs';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { eventually } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';
import type { FakeRequest } from '../../../src/testing/index.js';
import { identity } from '../../identity/steps/identity.js';

const HMAC_SECRET = 'whsec-acme-7f3e';
const PHONE_TOKEN = 'tk_phone_secret';

interface Receiver {
  url: string;
  requests: FakeRequest[];
  /** The status of each answer in turn; 200 after the list ends. */
  answers: number[];
}

const state = new WeakMap<
  SynoikiaWorld,
  {
    receivers: Map<string, Receiver>;
    seen: Record<string, unknown>[];
    answer: { status: number; body: Record<string, unknown> }[];
    channelId?: string;
  }
>();
const of = (world: SynoikiaWorld) => {
  let s = state.get(world);
  if (!s) state.set(world, (s = { receivers: new Map(), seen: [], answer: [] }));
  return s;
};

async function receiver(world: SynoikiaWorld, name: string, answers: number[] = []) {
  const r: Receiver = { url: '', requests: [], answers };
  const fake = await world.fakeService({
    'POST /in': (req) => {
      r.requests.push(req);
      return { status: r.answers.shift() ?? 200, body: {} };
    },
  });
  r.url = `${fake.url}/in`;
  of(world).receivers.set(name, r);
  return r;
}

const channels = async (world: SynoikiaWorld) =>
  (await world.expectOk(world.admin.get('/api/notifiers'), 'list channels')) as unknown as Record<string, unknown>[];

async function addChannel(world: SynoikiaWorld, channel: Record<string, unknown>) {
  const made = await world.expectOk(world.admin.post('/api/notifiers', channel), 'add channel');
  of(world).channelId = made.id as string;
  return made;
}

async function answerOf(res: Promise<Response>) {
  const r = await res;
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

const phoneId = async (world: SynoikiaWorld) => (await channels(world)).find((c) => c.name === 'Phone')!.id as string;

// ── the secrets of a channel ──

When(
  'the admin renames the phone channel without its token, and then clears its token',
  async (world: SynoikiaWorld) => {
    const id = await phoneId(world);
    of(world).seen = [
      await world.expectOk(world.admin.patch(`/api/notifiers/${id}`, { name: 'Phone 2' }), 'rename channel'),
      await world.expectOk(world.admin.patch(`/api/notifiers/${id}`, { secrets: { token: null } }), 'clear token'),
    ];
  },
);

Then('the admin saw the token as set after the rename, and as not set after the clear', (world: SynoikiaWorld) => {
  const [renamed, cleared] = of(world).seen;
  expect(renamed).toMatchObject({ name: 'Phone 2', secrets: { token: { set: true } } });
  expect(cleared).toMatchObject({ name: 'Phone 2', secrets: { token: { set: false } } });
});

Then('the channels never showed the token', async (world: SynoikiaWorld) => {
  expect(JSON.stringify([...of(world).seen, ...(await channels(world))])).not.toContain(PHONE_TOKEN);
});

When(
  'the admin tries to make the phone channel a webhook, then a channel with the topic {string}, then a {string} channel',
  async (world: SynoikiaWorld, topic: string, kind: string) => {
    const id = await phoneId(world);
    of(world).answer = [
      await answerOf(
        world.admin.patch(`/api/notifiers/${id}`, { kind: 'webhook', config: { url: 'https://x.example' } }),
      ),
      await answerOf(
        world.admin.post('/api/notifiers', { kind: 'ntfy', name: 'Bad', config: { topic }, events: ['sync.failed'] }),
      ),
      await answerOf(world.admin.post('/api/notifiers', { kind, name: 'Pager', events: ['sync.failed'] })),
    ];
  },
);

Then(
  'the admin is told that a channel keeps its kind, and that the other two channels are not valid',
  async (world: SynoikiaWorld) => {
    const [kind, topic, unknown] = of(world).answer;
    expect(kind).toMatchObject({ status: 400, body: { error: 'kind_immutable' } });
    expect(topic).toMatchObject({ status: 400, body: { error: 'invalid_channel' } });
    expect(JSON.stringify(topic!.body)).toContain('config.topic');
    expect(unknown).toMatchObject({ status: 400, body: { error: 'invalid_channel' } });
    expect((await channels(world)).map((c) => [c.name, c.kind])).toEqual([['Phone', 'ntfy']]);
  },
);

When('the admin adds a webhook, tests it, turns it off and deletes it', async (world: SynoikiaWorld) => {
  const hook = await receiver(world, 'webhook');
  const made = await addChannel(world, {
    kind: 'webhook',
    name: 'Hook',
    config: { url: hook.url },
    events: ['sync.failed'],
  });
  const id = made.id as string;
  of(world).seen = [
    await world.expectOk(world.admin.post(`/api/notifiers/${id}/test`), 'test channel'),
    await world.expectOk(world.admin.patch(`/api/notifiers/${id}`, { enabled: false }), 'turn channel off'),
  ];
  const del = await world.admin.del(`/api/notifiers/${id}`);
  expect(del.status).toBe(204);
});

Then(
  'the test reached the webhook, the webhook showed as off, and the admin has no channel left',
  async (world: SynoikiaWorld) => {
    const [tested, off] = of(world).seen;
    expect(tested).toEqual({ ok: true });
    expect(of(world).receivers.get('webhook')!.requests[0]!.body).toMatchObject({ title: 'Test notification' });
    expect(off).toMatchObject({ enabled: false });
    expect(await channels(world)).toEqual([]);
  },
);

// ── delivery ──

Given(
  'the admin has a signed webhook for failed syncs that fails twice, and a webhook only for {string}',
  async (world: SynoikiaWorld, other: string) => {
    const signed = await receiver(world, 'signed', [503, 503]);
    const only = await receiver(world, other);
    const last = world.lastInstance;
    const otherId = await world.tasksInstance(other);
    world.lastInstance = last;
    await addChannel(world, {
      kind: 'webhook',
      name: 'Signed',
      config: { url: signed.url },
      secrets: { hmacSecret: HMAC_SECRET, headers: { 'x-acme-team': 'home' } },
      events: ['sync.failed'],
    });
    await addChannel(world, {
      kind: 'webhook',
      name: `Only ${other}`,
      config: { url: only.url },
      events: ['sync.failed'],
      instanceFilter: [otherId],
    });
  },
);

Then(
  'the signed webhook got {string} on the third try, with the extra header',
  async (world: SynoikiaWorld, title: string) => {
    const { requests } = of(world).receivers.get('signed')!;
    await eventually(() => requests.length === 3, 'three tries');
    const last = requests[2]!;
    const body = JSON.stringify(last.body);
    const expected = createHmac('sha256', HMAC_SECRET)
      .update(`${String(last.headers['x-synoikia-timestamp'])}.${body}`)
      .digest('hex');
    expect(last.headers['x-synoikia-signature']).toBe(`sha256=${expected}`);
    expect(last.headers['x-acme-team']).toBe('home');
    expect(last.body).toMatchObject({ event: 'sync.failed', title, instance: { slug: 'tasks' } });
  },
);

Then('the webhook of {string} got nothing', async (world: SynoikiaWorld, other: string) => {
  await new Promise((r) => setTimeout(r, 300));
  expect(of(world).receivers.get(other)!.requests).toEqual([]);
});

Given('the admin has a webhook that answers {string}', async (world: SynoikiaWorld, answer: string) => {
  const hook = await receiver(world, 'webhook', answer === 'not found' ? [404, 404, 404] : []);
  await addChannel(world, { kind: 'webhook', name: 'Hook', config: { url: hook.url }, events: ['sync.failed'] });
});

When('the admin tests the webhook', async (world: SynoikiaWorld) => {
  of(world).seen = [
    await world.expectOk(world.admin.post(`/api/notifiers/${of(world).channelId!}/test`), 'test channel'),
  ];
});

Then(
  'the admin is told that the webhook answered "not found", it was asked once, and the channel keeps that error',
  async (world: SynoikiaWorld) => {
    expect(of(world).seen[0]).toEqual({ ok: false, error: 'HTTP 404' });
    expect(of(world).receivers.get('webhook')!.requests).toHaveLength(1);
    expect((await channels(world))[0]).toMatchObject({ lastError: 'HTTP 404' });
  },
);

Given(
  'the admin has a webhook for failed syncs that answers "too many requests" once',
  async (world: SynoikiaWorld) => {
    const hook = await receiver(world, 'webhook', [429]);
    await addChannel(world, { kind: 'webhook', name: 'Hook', config: { url: hook.url }, events: ['sync.failed'] });
  },
);

Then('the webhook got {string} on the second try', async (world: SynoikiaWorld, title: string) => {
  const { requests } = of(world).receivers.get('webhook')!;
  await eventually(() => requests.length === 2, 'two tries');
  expect(requests[1]!.body).toMatchObject({ title });
  await eventually(async () => (await channels(world))[0]!.lastSentAt !== null, 'the channel to record the delivery');
});

// ── what a notification carries ──

Given('the admin has a phone channel for writes to review', async (world: SynoikiaWorld) => {
  const phone = await receiver(world, 'phone');
  await addChannel(world, {
    kind: 'ntfy',
    name: 'Phone',
    config: { server: phone.url, topic: 'synoikia-admin' },
    secrets: { token: PHONE_TOKEN },
    events: ['sync.pending_review'],
  });
});

Then('the phone gets {string} with no actions', async (world: SynoikiaWorld, title: string) => {
  const { requests } = of(world).receivers.get('phone')!;
  await eventually(() => requests.length === 1, 'a push to the phone');
  expect(requests[0]!.headers.authorization).toBe(`Bearer ${PHONE_TOKEN}`);
  expect(requests[0]!.body).toMatchObject({ topic: 'synoikia-admin', title });
  expect(requests[0]!.body).not.toHaveProperty('actions');
});

When('the admin tries to add a phone channel for pending approvals', async (world: SynoikiaWorld) => {
  of(world).answer = [
    await answerOf(
      world.admin.post('/api/notifiers', {
        kind: 'ntfy',
        name: 'Phone',
        config: { topic: 'synoikia-admin' },
        events: ['approval.pending'],
      }),
    ),
  ];
});

Then('the admin is told that the channel is not valid', async (world: SynoikiaWorld) => {
  expect(of(world).answer[0]).toMatchObject({ status: 400, body: { error: 'invalid_channel' } });
  expect(await channels(world)).toEqual([]);
});

Given('the admin gets a notification when an instance goes down, crashes or recovers', async (world: SynoikiaWorld) => {
  identity(world).inbox = await world.notificationInbox(['instance.error', 'plugin.crashed', 'instance.recovered']);
});

When('the plugin of {string} crashes and starts again', async (world: SynoikiaWorld, slug: string) => {
  await world.restartPlugin(slug);
});

Then('the admin got the notifications {string} and {string}', async (world: SynoikiaWorld, a: string, b: string) => {
  const inbox = identity(world).inbox!;
  await eventually(() => inbox.length >= 2, 'two notifications');
  await new Promise((r) => setTimeout(r, 300));
  expect(inbox.map((n) => n.title).sort()).toEqual([a, b].sort());
});

Then(
  'the admin got the notifications {string}, {string} and {string}',
  async (world: SynoikiaWorld, a: string, b: string, c: string) => {
    const inbox = identity(world).inbox!;
    await eventually(() => inbox.length >= 3, 'three notifications');
    await new Promise((r) => setTimeout(r, 300));
    expect(inbox.map((n) => n.title).sort()).toEqual([a, b, c].sort());
  },
);

When(
  'the admin syncs {string}, which fails, and then again after the plugin lists its operations',
  async (world: SynoikiaWorld, slug: string) => {
    const id = await world.tasksInstance(slug);
    expect((await world.admin.post(`/api/instances/${id}/sync`)).ok).toBe(false);
    rmSync(world.pluginFile('catalog-broken'));
    await world.sync(slug);
  },
);
