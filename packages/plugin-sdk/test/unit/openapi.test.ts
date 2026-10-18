import { describe, expect, it } from 'vitest';
import {
  classifyRest,
  fillTemplate,
  matchPath,
  OperationDescriptorSchema,
  parseOpenApi,
  SpecError,
} from '../../src/index.js';
import { catalog, op } from '../openapi-fixture.js';

describe('parseOpenApi', () => {
  it('refuses anything but a plausible OpenAPI 3 document', () => {
    expect(() => parseOpenApi('openapi: "2.0"\npaths: {}', 'Acme')).toThrow(/^The Acme API spec is not OpenAPI 3$/);
    expect(() => parseOpenApi('{{{ not yaml', 'Acme')).toThrow(SpecError);
    expect(() => parseOpenApi('', 'Acme')).toThrow('The Acme API spec is empty');
    expect(() => parseOpenApi('openapi: 3.0.0\n')).toThrow('The API spec has no paths');
    expect(parseOpenApi('{"openapi": "3.1.0", "paths": {}}')).toMatchObject({ openapi: '3.1.0' });
    expect(parseOpenApi({ openapi: '3.0.3', paths: {} })).toMatchObject({ openapi: '3.0.3' });
    expect(() => parseOpenApi({ swagger: '2.0' })).toThrow(SpecError);
  });
});

describe('classifyRest', () => {
  it('reads GETs, writes everything else and flags action-shaped GETs', () => {
    expect(classifyRest('GET /x', 'List things')).toEqual({
      classification: 'read',
      classificationReason: 'verb:GET',
      needsReview: false,
    });
    expect(classifyRest('PUT /x', '')).toMatchObject({ classification: 'write', classificationReason: 'verb:PUT' });
    expect(classifyRest('GET /x', 'Reset everything')).toMatchObject({ classification: 'write', needsReview: true });
    expect(classifyRest('GET /x', 'Reset everything', null)).toMatchObject({ classification: 'read' });
  });
});

describe('buildOpenApiCatalog', () => {
  it('builds valid descriptors, skipping excluded and unsafe paths', () => {
    expect(catalog.operations.map((o) => o.key)).toEqual([
      'DELETE /items/{itemId}',
      'GET /cache/flush',
      'GET /items',
      'GET /items/{itemId}',
      'GET /status/sync',
      'POST /items',
      'POST /items/{itemId}/{action}',
      'POST /items/{itemId}/{action}#other-user',
      'POST /items/{itemId}/retry',
    ]);
    for (const d of catalog.operations) expect(() => OperationDescriptorSchema.parse(d), d.key).not.toThrow();
  });

  it('groups by tag, resolves refs and carries docs', () => {
    expect(op('GET /items')).toMatchObject({
      kind: 'rest',
      group: 'items',
      classification: 'read',
      docs: { summary: 'List items' },
      paramsSchema: { properties: { query: { properties: { take: { type: 'number' } } } } },
    });
    expect(op('GET /items/{itemId}')).toMatchObject({
      paramsSchema: { properties: { path: { properties: { itemId: { type: 'number' } }, required: ['itemId'] } } },
    });
    expect(op('POST /items')).toMatchObject({
      matchProfile: 'item',
      paramsSchema: {
        properties: { body: { properties: { child: { description: 'See #/components/schemas/Item' } } } },
      },
    });
    expect(op('GET /cache/flush')).toMatchObject({ group: 'settings', classification: 'write', needsReview: true });
    expect(op('GET /status/sync')).toMatchObject({ classification: 'read', needsReview: false });
    expect(op('DELETE /items/{itemId}')).toMatchObject({ locked: true, typedConfirmation: true });
    expect(op('POST /items/{itemId}/{action}#other-user')).toMatchObject({
      locked: true,
      docs: { summary: 'Act', description: 'Acting for another user: locked.' },
    });
  });

  it('flags GETs whose path names an action, even without a description', () => {
    expect(classifyRest('GET /settings/discover/reset', '')).toMatchObject({
      classification: 'write',
      needsReview: true,
    });
    expect(classifyRest('GET /jobs/run-now', '')).toMatchObject({ classification: 'write' });
    expect(classifyRest('GET /tests/{id}', '')).toMatchObject({ classification: 'read' });
    expect(classifyRest('GET /x/reset', '', null, null)).toMatchObject({ classification: 'read' });
    expect(classifyRest('GET /x', 'Restarts the service')).toMatchObject({ classification: 'write' });
  });
});

describe('matchPath and fillTemplate', () => {
  it.each([
    ['POST', '/items/5/retry', 'POST /items/{itemId}/retry', { itemId: '5' }],
    ['POST', '/api/v1/items/5/close', 'POST /items/{itemId}/{action}', { itemId: '5', action: 'close' }],
    ['get', '/items/7/', 'GET /items/{itemId}', { itemId: '7' }],
  ])('%s %s → %s', (method, path, key, pathParams) => {
    expect(matchPath(catalog, method, path, '/api/v1')).toMatchObject({ op: { key }, pathParams });
  });

  it('fills templates with encoded values', () => {
    expect(fillTemplate('/u/{id}/x', { id: 'a b/c' })).toBe('/u/a%20b%2Fc/x');
    expect(() => fillTemplate('/u/{id}', {})).toThrow(/id/);
    expect(() => fillTemplate('/u/{constructor}', {})).toThrow(/constructor/);
  });
});
