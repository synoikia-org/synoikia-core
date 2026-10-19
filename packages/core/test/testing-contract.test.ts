import { describe, expect, it } from 'vitest';
import { startFakeHttp } from '../src/testing/index.js';

/** The fake HTTP upstream of `@synoikia/core/testing`. */

describe('startFakeHttp', () => {
  it('routes by method and path params, records requests and answers 404 otherwise', async () => {
    const fake = await startFakeHttp({
      routes: {
        'GET /items/{id}': (req) => ({ body: { id: req.params.id, q: req.query.get('q') } }),
        'POST /items': (req) => ({ status: 201, body: req.body }),
        'GET /text': () => ({ body: 'plain' }),
        'GET /boom': () => {
          throw new Error('kaput');
        },
      },
      guard: (req) => (req.headers.authorization === 'Bearer t' ? undefined : { status: 401, body: { message: 'no' } }),
    });
    try {
      const get = (p: string, init: RequestInit = {}) =>
        fetch(`${fake.url}${p}`, { ...init, headers: { authorization: 'Bearer t', ...init.headers } });
      expect(await (await get('/items/a%20b?q=1')).json()).toEqual({ id: 'a b', q: '1' });
      const created = await get('/items', { method: 'POST', body: '{"x":1}' });
      expect([created.status, await created.json()]).toEqual([201, { x: 1 }]);
      expect(await (await get('/text')).text()).toBe('plain');
      expect((await get('/boom')).status).toBe(500);
      expect((await get('/nope')).status).toBe(404);
      expect((await fetch(`${fake.url}/items/1`)).status).toBe(401);
      expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
        'GET /items/a%20b',
        'POST /items',
        'GET /text',
        'GET /boom',
        'GET /nope',
        'GET /items/1',
      ]);
      expect(fake.requests[1]!.body).toEqual({ x: 1 });
    } finally {
      await fake.close();
    }
  });
});
