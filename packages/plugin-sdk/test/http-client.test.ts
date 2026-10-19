import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeBody, ErrorCodes, HttpJsonClient } from '../src/index.js';

const SECRET = 'super-secret-token';
const seen: { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const send = (status: number, payload?: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(payload === undefined ? '' : typeof payload === 'string' ? payload : JSON.stringify(payload));
      };
      const path = req.url!.split('?')[0];
      if (path === '/api/ok') return send(200, { ok: true, echo: body ? JSON.parse(body) : null });
      if (path === '/api/raw') return send(200, { ok: true });
      if (path === '/api/denied') return send(403, { message: 'no access' });
      if (path === '/api/invalid') return send(422, { message: 'bad field' });
      if (path === '/api/broken') return send(500, 'oops');
      send(404, { message: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => new Promise((r) => server.close(r)));

const client = (opts: Partial<ConstructorParameters<typeof HttpJsonClient>[0]> = {}) =>
  new HttpJsonClient({
    baseUrl: base,
    service: 'Acme',
    headers: () => ({ authorization: `Bearer ${SECRET}` }),
    ...opts,
  });

describe('HttpJsonClient', () => {
  it('sends JSON with auth headers and parses the response', async () => {
    expect(await client().request('POST', '/ok', { body: { a: 1 }, query: { q: ['x', 'y'], n: null } })).toEqual({
      ok: true,
      echo: { a: 1 },
    });
    const req = seen.at(-1)!;
    expect(req.url).toBe('/api/ok?q=x&q=y');
    expect(req.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(req.headers['content-type']).toBe('application/json');
  });

  it('maps error statuses without leaking credentials', async () => {
    const errors = await Promise.all(
      ['/denied', '/invalid', '/broken', '/missing'].map((p) =>
        client()
          .request('GET', p)
          .catch((e: unknown) => e),
      ),
    );
    expect(errors.map((e) => (e as { code: string }).code)).toEqual([
      ErrorCodes.UpstreamDenied,
      ErrorCodes.InvalidParams,
      ErrorCodes.UpstreamError,
      ErrorCodes.UpstreamError,
    ]);
    expect((errors[0] as Error).message).toBe('Acme denied GET /denied: insufficient permission (no access)');
    expect((errors[1] as Error).message).toBe('GET /invalid: bad field');
    expect((errors[2] as Error).message).toBe('GET /broken: HTTP 500 (oops)');
    for (const e of errors) expect(JSON.stringify(e) + (e as Error).message).not.toContain(SECRET);
  });
});

describe('form and multipart bodies', () => {
  const fields = { name: 'a&b=c d', tags: ['x', 'y'], on: true, off: false, n: 0, skip: null, gone: undefined };

  it('sends a urlencoded form', async () => {
    await client().request('POST', '/raw', { body: fields, bodyEncoding: 'form' });
    const req = seen.at(-1)!;
    expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(req.body).toBe('name=a%26b%3Dc+d&tags=x&tags=y&on=true&off=false&n=0');
    expect(req.headers['content-length']).toBe(String(Buffer.byteLength(req.body)));
    expect(new URLSearchParams(req.body).get('name')).toBe('a&b=c d');
  });

  it('sends multipart text fields under a random boundary', async () => {
    await client().request('POST', '/raw', {
      body: { urls: 'magnet:?xt=urn:btih:abc\nhttp://x/y', 'we"ird\r\nname': 'é', obj: { a: 1 } },
      bodyEncoding: 'multipart',
    });
    const req = seen.at(-1)!;
    const boundary = /^multipart\/form-data; boundary=(synoikia-[0-9a-f]{32})$/.exec(req.headers['content-type']!)?.[1];
    expect(boundary).toBeDefined();
    expect(req.body).toBe(
      [
        `--${boundary}`,
        'content-disposition: form-data; name="urls"',
        '',
        'magnet:?xt=urn:btih:abc\nhttp://x/y',
        `--${boundary}`,
        'content-disposition: form-data; name="we%22ird%0D%0Aname"',
        '',
        'é',
        `--${boundary}`,
        'content-disposition: form-data; name="obj"',
        '',
        '{"a":1}',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    );
    const again = encodeBody({ a: '1' }, 'multipart')!;
    expect(again.contentType).not.toBe(req.headers['content-type']);
  });

  it('keeps JSON the default and rejects bodies that are not fields', async () => {
    expect(encodeBody({ a: [1] })).toEqual({ data: Buffer.from('{"a":[1]}'), contentType: 'application/json' });
    expect(encodeBody(undefined, 'form')).toBeUndefined();
    expect(encodeBody({}, 'form')!.data.toString()).toBe('');
    const before = seen.length;
    for (const [body, bodyEncoding] of [
      ['text', 'form'],
      [[1, 2], 'multipart'],
      [{ a: 1 }, 'xml'],
    ] as const) {
      await expect(
        client().request('POST', '/raw', { body, bodyEncoding: bodyEncoding as 'form' }),
      ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    }
    await expect(client().request('POST', '/raw', { body: { n: 1n } })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
    expect(seen.length).toBe(before);
  });
});
