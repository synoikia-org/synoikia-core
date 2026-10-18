import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildOpenApiCatalog,
  compileRules,
  ErrorCodes,
  HttpJsonClient,
  parsePluginSettings,
  restBinding,
  restLookup,
  staticHttpBinding,
} from '../src/index.js';
import type { OpenApiCatalog } from '../src/index.js';
import { catalog, rules } from './openapi-fixture.js';

describe('restBinding against an HTTP upstream', () => {
  let server: http.Server;
  let client: HttpJsonClient;
  const calls: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    client = new HttpJsonClient({
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`,
      service: 'Acme',
    });
  });
  afterAll(() => new Promise((r) => server.close(r)));

  const others = new Set(['9']);
  const binding = restBinding({
    namespace: 'acme',
    service: 'Acme',
    rules,
    catalog: async () => catalog as OpenApiCatalog,
    client: () => client,
    stripPrefix: '/api/v1',
    adjust: (call) =>
      call.key === 'POST /items'
        ? { ...call.params, body: { ...(call.params.body as object), draft: false } }
        : call.params,
    splitWhen: { 'other-user': (call) => others.has(call.params.path!.itemId!) },
  });
  const resolve = (req: unknown, fn = 'request') => binding.resolveOperation({ fn, args: [req] });

  it('validates calls', async () => {
    await expect(resolve({}, 'call')).rejects.toMatchObject({ code: ErrorCodes.UnknownOperation });
    await expect(resolve('x')).rejects.toThrow('acme.request({ method, path, query, body }) takes one object');
    await expect(resolve({ method: 'TRACE', path: '/items' })).rejects.toThrow('Unsupported HTTP method TRACE');
    await expect(resolve({ path: 'items' })).rejects.toThrow('path must be a string starting with /');
    await expect(resolve({ path: '/items?take=1' })).rejects.toThrow(/query/);
    await expect(resolve({ path: '/items', query: 'x' })).rejects.toThrow('query must be an object');
    await expect(resolve({ path: '/nope' })).rejects.toThrow('GET /nope is not a Acme API operation');
  });

  it('resolves keys, params, adjustments and split twins', async () => {
    expect(await resolve({ path: '/items', query: { take: 2 }, body: { ignored: true } })).toEqual({
      key: 'GET /items',
      params: { query: { take: 2 } },
    });
    expect(await resolve({ method: 'post', path: '/items', body: { id: 1 } })).toEqual({
      key: 'POST /items',
      params: { body: { id: 1, draft: false } },
    });
    expect((await resolve({ method: 'POST', path: '/items/1/close' })).key).toBe('POST /items/{itemId}/{action}');
    expect((await resolve({ method: 'POST', path: '/items/9/close' })).key).toBe(
      'POST /items/{itemId}/{action}#other-user',
    );
  });

  it('summarizes with notes and confirm literals', async () => {
    expect(
      await binding.summarize({ key: 'DELETE /items/{itemId}', params: { path: { itemId: '3' } }, targets: [] }),
    ).toEqual({
      text: 'Acme DELETE /items/3',
      confirmLiteral: '3',
    });
    const s = await binding.summarize({
      key: 'POST /items/{itemId}/{action}#other-user',
      params: { path: { itemId: '9', action: 'close' }, query: { a: 1 }, body: { x: 'y'.repeat(500) } },
      targets: [],
    });
    expect(s.text).toMatch(/^Acme POST \/items\/9\/close\?a=1 \{"x":"y+…  ?\(another user's item\)$/);
  });

  it('never lets a path parameter leave the gated endpoint', async () => {
    const before = calls.length;
    const lookup = restLookup(() => client);
    await expect(lookup('GET /items/{itemId}', [{ itemId: '..' }], 1000)).rejects.toThrow();
    await expect(client.request('GET', '/items/%2e%2e/cache')).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
    await expect(client.request('GET', '/items/./x')).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    expect(calls.length).toBe(before);
  });

  it('looks names up with GETs only', async () => {
    const lookup = restLookup(() => client);
    expect(await lookup('GET /items/{itemId}', [{ itemId: '5' }], 1000)).toEqual({ ok: true, url: '/api/v1/items/5' });
    await expect(lookup('DELETE /items/{itemId}', [{ itemId: '5' }], 1000)).rejects.toThrow(/only GET/);
    await expect(lookup('GET items', [], 1000)).rejects.toThrow(/only GET/);
  });

  it('invokes the matching request', async () => {
    const ctx = { callId: 'c', deadlineMs: 5000 };
    expect(
      await binding.invoke({ key: 'GET /items/{itemId}', params: { path: { itemId: 'a b' } }, context: ctx }),
    ).toEqual({
      ok: true,
      url: '/api/v1/items/a%20b',
    });
    await expect(binding.invoke({ key: 'GET /nope', params: {}, context: ctx })).rejects.toMatchObject({
      code: ErrorCodes.UnknownOperation,
    });
    await expect(binding.invoke({ key: 'GET /items/{itemId}', params: {}, context: ctx })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
  });
});

describe('form request bodies', () => {
  let server: http.Server;
  let client: HttpJsonClient;
  const got: { type?: string; body: string }[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        got.push({ type: req.headers['content-type'], body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    client = new HttpJsonClient({
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      service: 'Acme',
    });
  });
  afterAll(() => new Promise((r) => server.close(r)));
  const ctx = { callId: 'c', deadlineMs: 5000 };
  const fields = { type: 'object', properties: { hashes: { type: 'string' } } };

  it('sends the form type an OpenAPI operation takes, and JSON when the spec offers JSON', async () => {
    const formRules = compileRules(parsePluginSettings({}));
    const spec = {
      openapi: '3.0.3',
      paths: {
        '/pause': { post: { requestBody: { content: { 'application/x-www-form-urlencoded': { schema: fields } } } } },
        '/add': { post: { requestBody: { content: { 'multipart/form-data': { schema: fields } } } } },
        '/both': {
          post: {
            requestBody: {
              content: { 'application/x-www-form-urlencoded': { schema: fields }, 'application/json': { schema: {} } },
            },
          },
        },
      },
    };
    const formCatalog = buildOpenApiCatalog(spec, { service: 'Acme', rules: formRules });
    expect(formCatalog.operations.find((o) => o.key === 'POST /pause')?.paramsSchema).toEqual({
      type: 'object',
      properties: { body: fields },
    });
    expect(formCatalog.byVerb.get('POST')!.map((o) => [o.template, o.body])).toEqual([
      ['/pause', 'form'],
      ['/add', 'multipart'],
      ['/both', undefined],
    ]);
    const b = restBinding({
      namespace: 'acme',
      service: 'Acme',
      rules: formRules,
      catalog: async () => formCatalog,
      client: () => client,
    });
    await expect(
      b.resolveOperation({ fn: 'request', args: [{ method: 'POST', path: '/pause', body: 'hashes=x' }] }),
    ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    for (const path of ['/pause', '/add', '/both']) {
      const { key, params } = await b.resolveOperation({
        fn: 'request',
        args: [{ method: 'POST', path, body: { hashes: 'a|b' } }],
      });
      await b.invoke({ key, params, context: ctx });
    }
    expect(got.at(-3)).toEqual({ type: 'application/x-www-form-urlencoded', body: 'hashes=a%7Cb' });
    expect(got.at(-2)!.type).toMatch(/^multipart\/form-data; boundary=/);
    expect(got.at(-2)!.body).toContain('name="hashes"\r\n\r\na|b\r\n');
    expect(got.at(-1)).toEqual({ type: 'application/json', body: '{"hashes":"a|b"}' });
  });
});

describe('static catalogs', () => {
  const srules = compileRules(
    parsePluginSettings({
      operations: [
        {
          key: 'items.list',
          group: 'items',
          classification: 'read',
          summary: 'List items',
          http: { method: 'GET', path: '/items' },
        },
        {
          key: 'items.delete',
          group: 'items',
          classification: 'write',
          summary: 'Delete',
          http: { method: 'DELETE', path: '/items/{id}' },
        },
        {
          key: 'reload',
          kind: 'ws_command',
          group: 'system',
          classification: 'write',
          summary: 'Reload',
          attestation: true,
          reason: 'shape:write',
        },
      ],
      rules: [{ match: 'items.delete', locked: true, confirm: { param: '/path/id' } }],
    }),
  );

  it('binds http operations', async () => {
    const requests: unknown[] = [];
    const fakeClient = {
      request: async (...args: unknown[]) => (requests.push(args), { done: true }),
    } as unknown as HttpJsonClient;
    const b = staticHttpBinding({ namespace: 'acme', service: 'Acme', rules: srules, client: () => fakeClient });
    await expect(b.resolveOperation({ fn: 'call', args: ['reload'] })).rejects.toMatchObject({
      code: ErrorCodes.UnknownOperation,
    });
    await expect(b.resolveOperation({ fn: 'call', args: ['items.list', 'x'] })).rejects.toThrow(
      'params must be an object',
    );
    expect(await b.resolveOperation({ fn: 'call', args: ['items.list', { body: 1, query: { q: 1 } }] })).toEqual({
      key: 'items.list',
      params: { query: { q: 1 } },
    });
    await expect(
      b.resolveOperation({ fn: 'call', args: ['items.delete', { path: { id: { x: 1 } } }] }),
    ).rejects.toThrow('path.id must be a string or number');
    await expect(
      b.invoke({ key: 'items.delete', params: { path: { id: '..' } }, context: { callId: 'c', deadlineMs: 10 } }),
    ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    expect(await b.summarize({ key: 'items.delete', params: { path: { id: '4' } }, targets: [] })).toEqual({
      text: 'Acme items.delete: DELETE /items/4',
      confirmLiteral: '4',
    });
    expect(
      await b.invoke({ key: 'items.delete', params: { path: { id: '4' } }, context: { callId: 'c', deadlineMs: 10 } }),
    ).toEqual({ done: true });
    expect(requests).toEqual([['DELETE', '/items/4', { query: undefined, body: undefined, timeoutMs: 1000 }]]);
  });
});
