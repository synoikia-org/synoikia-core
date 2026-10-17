// The World's "Acme Tasks" plugin: speaks the JSON-RPC-over-IPC contract and calls the fake upstream over HTTP.
const CATALOG = [
  {
    key: 'lists.tasks',
    kind: 'method',
    group: 'lists',
    classification: 'read',
    classificationReason: 'fixture',
    docs: { summary: 'The open tasks of a list.' },
  },
];

let config = {};
const reply = (id, result) => process.send({ jsonrpc: '2.0', id, result: result ?? null });
const fail = (id, code, message) => process.send({ jsonrpc: '2.0', id, error: { code, message } });

const handlers = {
  init(id, params) {
    config = params.config;
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
  resolveTargets: (id) => reply(id, []),
  summarize: (id, { key, params }) => reply(id, { text: `${key} ${JSON.stringify(params)}` }),
  async invoke(id, { params }) {
    const res = await globalThis.fetch(`${config.url}/lists/${encodeURIComponent(params.list)}/tasks?status=open`);
    if (!res.ok) return fail(id, 'UPSTREAM_ERROR', `upstream answered ${res.status}`);
    reply(id, await res.json());
  },
  shutdown(id) {
    reply(id);
    setImmediate(() => process.exit(0));
  },
};

process.on('message', (msg) => {
  const handler = handlers[msg.method];
  if (!handler) return fail(msg.id, 'METHOD_NOT_FOUND', msg.method);
  Promise.resolve(handler(msg.id, msg.params)).catch((err) => fail(msg.id, 'UPSTREAM_ERROR', String(err)));
});
