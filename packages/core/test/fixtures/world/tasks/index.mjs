// The World's "Acme Tasks" plugin: speaks the JSON-RPC-over-IPC contract and calls the fake upstream over HTTP.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Flag files the World drops here: `down`, `catalog-broken`, `no-confirmation`, `count-is-write` (the count
// syncs as a write), `secret-result` (the open tasks' sensitiveResult, as JSON), `diff-path` (`dot` or `bare`)
// and `upstream-version` (the version Acme reports) change what the plugin answers, and a new `restart` value
// restarts the child once. Isolation and supervision: `report`, `start-check`, `hang`/`crash`/`forget` (a method
// name), `catalog-output` (a broken catalog), `catalog-changes` (JSON: add, change, remove) and `catalog-changed`.
const flag = (name) => existsSync(path.join(HERE, name));
const flagValue = (name) => (flag(name) ? readFileSync(path.join(HERE, name), 'utf8') : '');
const upstreamVersion = () => flagValue('upstream-version') || '1.0';

const op = (key, displayName, group, classification, extra = {}) => ({
  key,
  displayName,
  kind: 'method',
  group,
  classification,
  classificationReason: 'fixture',
  docs: { summary: `${displayName[0].toUpperCase()}${displayName.slice(1)}.` },
  ...extra,
});

const TASK_PARAMS = {
  type: 'object',
  properties: { list: { type: 'string' }, title: { type: 'string' } },
  required: ['list', 'title'],
};

const CATALOG = [
  op('lists.tasks', 'show the open tasks', 'lists', 'read', { matchProfile: 'list' }),
  op('lists.count', 'count the tasks', 'lists', 'read', { matchProfile: 'list' }),
  op('lists.share', 'show the share password', 'lists', 'read', { matchProfile: 'list' }),
  op('lists.rename', 'rename a list', 'lists', 'write', {
    kind: 'config',
    matchProfile: 'list',
    sensitiveParams: ['/lockCode'],
  }),
  op('lists.archive', 'archive a list', 'lists', 'write', { typedConfirmation: true, matchProfile: 'list' }),
  op('lists.delete', 'delete a list', 'lists', 'write', { locked: true, matchProfile: 'list' }),
  op('tasks.add', 'add a task', 'tasks', 'write', {
    matchProfile: 'task',
    paramsSchema: TASK_PARAMS,
    sensitiveParams: ['/pin'],
  }),
  op('tasks.complete', 'complete a task', 'tasks', 'write', { matchProfile: 'done' }),
  op('tasks.import', 'import tasks', 'tasks', 'write', { attestationRequired: true, matchProfile: 'list' }),
];

let config = {};
let secrets = {};
const reply = (id, result) => process.send({ jsonrpc: '2.0', id, result: result ?? null });
const fail = (id, code, message) => process.send({ jsonrpc: '2.0', id, error: { code, message } });

async function upstream(method, path, body, headers = {}) {
  const res = await globalThis.fetch(`${config.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secrets.token ?? ''}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status === 409) throw Object.assign(new Error('the list changed upstream'), { code: 'CONFIG_CONFLICT' });
  if (res.status === 403) throw Object.assign(new Error('insufficient permission'), { code: 'UPSTREAM_DENIED' });
  if (res.status === 404)
    throw Object.assign(new Error('not found upstream'), { code: 'UPSTREAM_ERROR', notFound: true });
  if (!res.ok)
    throw Object.assign(new Error(`upstream answered ${res.status}${text ? `: ${text}` : ''}`), {
      code: 'UPSTREAM_ERROR',
    });
  return text ? JSON.parse(text) : null;
}

const listPath = (name) => `/lists/${encodeURIComponent(name)}`;
/** Each call sends its call id, so the upstream can tell the calls apart. */
const callHeaders = (ctx) => (ctx.callId ? { 'x-call-id': ctx.callId } : {});
const openTasksWithIds = (list) => upstream('GET', `${listPath(list)}/tasks?status=open&with=ids`);

const INVOKE = {
  'lists.tasks': (p, ctx) => upstream('GET', `${listPath(p.list)}/tasks?status=open`, undefined, callHeaders(ctx)),
  'lists.count': async (p, ctx) => {
    const lists = p.list === undefined ? (await upstream('GET', '/lists')).map((l) => l.name) : [p.list];
    let open = 0;
    for (const list of lists)
      open += (await upstream('GET', `${listPath(list)}/tasks?status=open`, undefined, callHeaders(ctx))).length;
    return { open };
  },
  'lists.share': (p, ctx) => upstream('GET', `${listPath(p.list)}/share`, undefined, callHeaders(ctx)),
  'lists.rename': (p, ctx) =>
    upstream(
      'PUT',
      listPath(p.list),
      { name: p.name, ...(p.sharePassword === undefined ? {} : { sharePassword: p.sharePassword }) },
      { 'if-match': ctx.expectedHash, ...callHeaders(ctx) },
    ),
  'lists.archive': (p, ctx) => upstream('POST', `${listPath(p.list)}/archive`, undefined, callHeaders(ctx)),
  'lists.delete': (p, ctx) => upstream('DELETE', listPath(p.list), undefined, callHeaders(ctx)),
  'tasks.add': (p, ctx) =>
    upstream(
      'POST',
      `${listPath(p.list)}/tasks`,
      { title: p.title, ...(p.pin === undefined ? {} : { pin: p.pin }) },
      callHeaders(ctx),
    ),
  // Completes exactly the tasks core approved, by their ids.
  'tasks.complete': async (_p, ctx) => {
    const done = [];
    for (const t of ctx.targets ?? []) {
      if (t.kind !== 'task') continue;
      await upstream('POST', `/tasks/${encodeURIComponent(t.id)}/complete`, undefined, callHeaders(ctx));
      done.push(t.id);
    }
    return { completed: done };
  },
  'tasks.import': (p, ctx) => upstream('POST', `${listPath(p.list)}/import`, { tasks: p.tasks }, callHeaders(ctx)),
};

const summary = (key, p) => {
  const name = CATALOG.find((o) => o.key === key)?.displayName ?? key;
  return p.title ? `${name}: "${p.title}" in ${p.list}` : `${name}: ${p.list}`;
};

const changes = () => (flag('catalog-changes') ? JSON.parse(flagValue('catalog-changes')) : {});
const added = () => (changes().add ?? []).map((a) => op(a.key, a.displayName, a.group, a.classification, a.extra));
const known = (key) => [...CATALOG, ...added()].some((o) => o.key === key) || String(key).startsWith('views.');

// Contract breaks: an operation without its classification, a key twice, or result secrets that name no field.
const BROKEN = {
  'no-classification': (ops) => ops.map((o) => (o.key === 'lists.count' ? { ...o, classification: undefined } : o)),
  duplicate: (ops) => [...ops, ops[0]],
  'empty-secret-keys': (ops) => ops.map((o) => (o.key === 'lists.count' ? { ...o, sensitiveResult: { keys: [] } } : o)),
};

async function catalog() {
  if (flag('catalog-broken')) throw Object.assign(new Error('cannot read the catalog'), { code: 'UPSTREAM_ERROR' });
  const views = (await upstream('GET', '/views')) ?? [];
  const secretResult = flag('secret-result') ? JSON.parse(flagValue('secret-result')) : undefined;
  const ops = CATALOG.map((o) =>
    o.key === 'lists.count' && flag('count-is-write')
      ? { ...o, classification: 'write' }
      : o.key === 'lists.tasks' && secretResult
        ? { ...o, sensitiveResult: secretResult }
        : o,
  );
  const { change = {}, remove = [] } = changes();
  const changed = ops
    .filter((o) => !remove.includes(o.key))
    .map((o) => (change[o.key] ? { ...o, ...change[o.key] } : o));
  const all = [...changed, ...added(), ...views.map((v) => op(`views.${v}`, `show the view ${v}`, 'views', 'read'))];
  const broken = BROKEN[flagValue('catalog-output')];
  return broken ? broken([...all, op('lists.done', 'show the done tasks', 'lists', 'read')]) : all;
}

/** What the plugin can reach from its process, sent to Acme so the World can see it. */
async function report() {
  const attempt = (fn) => {
    try {
      fn();
      return 'allowed';
    } catch (err) {
      return err.code ?? String(err.message);
    }
  };
  const body = {
    ownFile: attempt(() => readFileSync(path.join(HERE, 'manifest.json'))),
    systemFile: attempt(() => readFileSync('/etc/passwd')),
    coreKey: attempt(() => readFileSync(path.join(HERE, '..', '..', 'master.key'))),
    coreDatabase: attempt(() => readFileSync(path.join(HERE, '..', '..', 'synoikia.sqlite'))),
    write: attempt(() => writeFileSync(path.join(HERE, 'written.txt'), 'x')),
    env: Object.keys(process.env)
      .filter((k) => k !== '__CF_USER_TEXT_ENCODING')
      .sort(),
    secrets: Object.keys(secrets).sort(),
    config: Object.keys(config).sort(),
  };
  await upstream('POST', '/report', body).catch(() => undefined);
}

/** The start checks that Acme answers, as a plugin that verifies its connection would. */
async function startCheck() {
  try {
    await upstream('GET', '/lists');
  } catch (err) {
    if (err.code) throw err;
    throw Object.assign(new Error('cannot reach upstream'), { code: 'UPSTREAM_ERROR' });
  }
}

// Every target names its list as the scope "list", except in the "Inbox", which belongs to no list.
const scoped = (list) => (list === 'Inbox' ? {} : { scopes: { list } });

async function targetsOf(key, params) {
  const lists = Array.isArray(params?.list) ? params.list : [params?.list];
  if (!lists.every((l) => typeof l === 'string')) return [];
  const out = [];
  for (const list of lists) {
    try {
      if (key === 'tasks.complete') {
        const open = await openTasksWithIds(list);
        for (const t of open.filter((t) => t.title === params.title))
          out.push({ kind: 'task', id: t.id, name: t.title, ...scoped(list) });
        continue;
      }
      await upstream('GET', listPath(list));
    } catch (err) {
      if (err.notFound) throw Object.assign(new Error(`no list ${list}`), { code: 'TARGET_RESOLUTION_FAILED' });
      throw err;
    }
    out.push({ kind: 'list', id: list, name: list, ...scoped(list) });
  }
  return out;
}

async function registry() {
  const out = [];
  for (const list of await upstream('GET', '/lists')) {
    out.push({ kind: 'list', id: list.name, name: list.name, attrs: { description: list.description ?? '' } });
    for (const t of await openTasksWithIds(list.name))
      out.push({ kind: 'task', id: t.id, name: t.title, parentId: list.name });
  }
  return out;
}

const handlers = {
  async init(id, params) {
    config = params.config;
    secrets = params.secrets ?? {};
    if (flag('report')) await report();
    if (flag('start-check')) await startCheck();
    reply(id);
  },
  async testConnection(id) {
    // Only a refused token fails the test: the World reaches no address but Acme's.
    const refused = await upstream('GET', '/lists').then(
      () => false,
      (err) => /answered 401/.test(err.message),
    );
    reply(
      id,
      refused ? { ok: false, message: 'Acme refused the token' } : { ok: true, upstreamVersion: upstreamVersion() },
    );
  },
  getUpstreamVersion: (id) => reply(id, upstreamVersion()),
  syncCatalog: async (id) => reply(id, { upstreamVersion: upstreamVersion(), operations: await catalog() }),
  syncRegistry: async (id) => reply(id, await registry()),
  resolveOperation(id, { args }) {
    const [key, params = {}] = args;
    if (!known(key)) return fail(id, 'UNKNOWN_OPERATION', `unknown operation: ${key}`);
    reply(id, { key, params });
  },
  resolveTargets: async (id, { key, params }) => reply(id, await targetsOf(key, params)),
  summarize: (id, { key, params }) =>
    reply(id, {
      text: summary(key, params ?? {}),
      ...((key === 'lists.archive' || key === 'lists.delete') && !flag('no-confirmation')
        ? { confirmLiteral: params.list }
        : {}),
    }),
  async prepareWrite(id, { params }) {
    const current = await upstream('GET', listPath(params.list));
    const diff = [{ path: '/name', before: current.name, after: params.name }];
    const form = flagValue('diff-path');
    const passwordPath = form === 'dot' ? 'list.sharePassword' : form === 'bare' ? 'sharePassword' : '/sharePassword';
    if (params.sharePassword !== undefined)
      diff.push({ path: passwordPath, before: current.sharePassword ?? null, after: params.sharePassword });
    if (params.lockCode !== undefined) diff.push({ path: '/lockCode', before: null, after: params.lockCode });
    reply(id, { params, diff, expectedHash: current.version });
  },
  async getGuide(id, { key }) {
    reply(id, await upstream('GET', `/guides/${encodeURIComponent(key)}`));
  },
  async invoke(id, { key, params, context }) {
    const run = INVOKE[key];
    if (key.startsWith('views.')) return reply(id, { view: key.slice('views.'.length) });
    if (!run && known(key)) return reply(id, { ran: key });
    if (!run) return fail(id, 'UNKNOWN_OPERATION', `unknown operation: ${key}`);
    reply(id, await run(params ?? {}, context ?? {}));
  },
  shutdown(id) {
    reply(id);
    setImmediate(() => process.exit(0));
  },
};

const restartSeen = flagValue('restart');
let catalogChangedSeen = flagValue('catalog-changed');
globalThis.setInterval(() => {
  if (flagValue('restart') !== restartSeen) process.exit(1);
  if (flagValue('catalog-changed') === catalogChangedSeen) return;
  catalogChangedSeen = flagValue('catalog-changed');
  process.send({ jsonrpc: '2.0', method: 'catalogChanged', params: { reason: 'Acme changed' } });
}, 25);

process.on('message', (msg) => {
  if (flag('down') || flagValue('crash') === msg.method) process.exit(1);
  if (flagValue('hang') === msg.method) return;
  const handler = flagValue('forget') === msg.method ? undefined : handlers[msg.method];
  if (!handler) return fail(msg.id, 'METHOD_NOT_FOUND', `method not found: ${msg.method}`);
  Promise.resolve(handler(msg.id, msg.params)).catch((err) =>
    fail(msg.id, err.code ?? 'UPSTREAM_ERROR', String(err.message ?? err)),
  );
});
