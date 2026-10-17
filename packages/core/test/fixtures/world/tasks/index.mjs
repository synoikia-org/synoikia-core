// The World's "Acme Tasks" plugin: speaks the JSON-RPC-over-IPC contract and calls the fake upstream over HTTP.
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

const CATALOG = [
  op('lists.tasks', 'show the open tasks', 'lists', 'read', { matchProfile: 'list' }),
  op('lists.count', 'count the tasks', 'lists', 'read', { matchProfile: 'list' }),
  op('lists.share', 'show the share password', 'lists', 'read', { matchProfile: 'list' }),
  op('lists.rename', 'rename a list', 'lists', 'write', { kind: 'config', matchProfile: 'list' }),
  op('lists.archive', 'archive a list', 'lists', 'write', { typedConfirmation: true, matchProfile: 'list' }),
  op('lists.delete', 'delete a list', 'lists', 'write', { locked: true, matchProfile: 'list' }),
  op('tasks.add', 'add a task', 'tasks', 'write', { matchProfile: 'task' }),
  op('tasks.complete', 'complete a task', 'tasks', 'write', { matchProfile: 'task' }),
  op('tasks.import', 'import tasks', 'tasks', 'write', { attestationRequired: true, matchProfile: 'list' }),
];

const GUIDES = {
  'tasks.import': { version: '1', content: 'Import at most 100 tasks at once, one title for each line.' },
};

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
  const data = text ? JSON.parse(text) : null;
  if (res.status === 409) throw Object.assign(new Error('the list changed upstream'), { code: 'CONFIG_CONFLICT' });
  if (!res.ok) throw Object.assign(new Error(`upstream answered ${res.status}`), { code: 'UPSTREAM_ERROR' });
  return data;
}

const listPath = (name) => `/lists/${encodeURIComponent(name)}`;

const INVOKE = {
  'lists.tasks': (p) => upstream('GET', `${listPath(p.list)}/tasks?status=open`),
  'lists.count': async (p) => ({ open: (await upstream('GET', `${listPath(p.list)}/tasks?status=open`)).length }),
  'lists.share': (p) => upstream('GET', `${listPath(p.list)}/share`),
  'lists.rename': (p, ctx) => upstream('PUT', listPath(p.list), { name: p.name }, { 'if-match': ctx.expectedHash }),
  'lists.archive': (p) => upstream('POST', `${listPath(p.list)}/archive`),
  'lists.delete': (p) => upstream('DELETE', listPath(p.list)),
  'tasks.add': (p) => upstream('POST', `${listPath(p.list)}/tasks`, { title: p.title }),
  'tasks.complete': (p) => upstream('POST', `${listPath(p.list)}/tasks/${encodeURIComponent(p.title)}/complete`),
  'tasks.import': (p) => upstream('POST', `${listPath(p.list)}/import`, { tasks: p.tasks }),
};

const summary = (key, p) => {
  const name = CATALOG.find((o) => o.key === key)?.displayName ?? key;
  return p.title ? `${name}: "${p.title}" in ${p.list}` : `${name}: ${p.list}`;
};

const handlers = {
  init(id, params) {
    config = params.config;
    secrets = params.secrets ?? {};
    reply(id);
  },
  testConnection: (id) => reply(id, { ok: true, upstreamVersion: '1.0' }),
  getUpstreamVersion: (id) => reply(id, '1.0'),
  syncCatalog: (id) => reply(id, { upstreamVersion: '1.0', operations: CATALOG }),
  syncRegistry: (id) => reply(id, []),
  resolveOperation(id, { args }) {
    const [key, params = {}] = args;
    if (!CATALOG.some((o) => o.key === key)) return fail(id, 'UNKNOWN_OPERATION', `unknown operation: ${key}`);
    reply(id, { key, params });
  },
  resolveTargets: (id, { params }) =>
    reply(id, typeof params?.list === 'string' ? [{ kind: 'list', id: params.list, name: params.list }] : []),
  summarize: (id, { key, params }) =>
    reply(id, {
      text: summary(key, params ?? {}),
      ...(key === 'lists.archive' || key === 'lists.delete' ? { confirmLiteral: params.list } : {}),
    }),
  async prepareWrite(id, { params }) {
    const current = await upstream('GET', listPath(params.list));
    reply(id, {
      params,
      diff: [{ path: '/name', before: current.name, after: params.name }],
      expectedHash: current.version,
    });
  },
  getGuide(id, { key }) {
    const guide = GUIDES[key];
    if (!guide) return fail(id, 'UNKNOWN_OPERATION', `no guide for ${key}`);
    reply(id, guide);
  },
  async invoke(id, { key, params, context }) {
    const run = INVOKE[key];
    if (!run) return fail(id, 'UNKNOWN_OPERATION', `unknown operation: ${key}`);
    reply(id, await run(params ?? {}, context ?? {}));
  },
  shutdown(id) {
    reply(id);
    setImmediate(() => process.exit(0));
  },
};

process.on('message', (msg) => {
  const handler = handlers[msg.method];
  if (!handler) return fail(msg.id, 'METHOD_NOT_FOUND', msg.method);
  Promise.resolve(handler(msg.id, msg.params)).catch((err) =>
    fail(msg.id, err.code ?? 'UPSTREAM_ERROR', String(err.message ?? err)),
  );
});
