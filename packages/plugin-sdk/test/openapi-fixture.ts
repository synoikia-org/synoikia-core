import { buildOpenApiCatalog, compileRules, parsePluginSettings } from '../src/index.js';

const SPEC = `
openapi: 3.0.2
components:
  schemas:
    Item: { type: object, properties: { id: { type: number }, child: { $ref: '#/components/schemas/Item' } } }
  parameters:
    itemId: { name: itemId, in: path, required: true, schema: { type: number } }
paths:
  /items:
    get: { summary: List items, tags: [Items], parameters: [{ name: take, in: query, schema: { type: number } }] }
    post:
      summary: Create an item
      tags: [Items]
      requestBody: { content: { application/json: { schema: { $ref: '#/components/schemas/Item' } } } }
  /items/{itemId}:
    parameters: [{ $ref: '#/components/parameters/itemId' }]
    get: { summary: Get an item, tags: [Items] }
    delete: { summary: Delete an item, tags: [Items] }
  /items/{itemId}/{action}:
    post: { summary: Act, tags: [Items], parameters: [{ name: itemId, in: path }, { name: action, in: path }] }
  /items/{itemId}/retry:
    post: { summary: Retry, tags: [Items], parameters: [{ name: itemId, in: path }] }
  /cache/flush:
    get: { summary: Flush the cache, tags: [Settings] }
  /status/sync:
    get: { summary: Status of the last sync, tags: [Settings] }
  /internal/debug:
    get: { summary: Debug }
  /../escape:
    get: { summary: nope }
  /bad path:
    get: { summary: nope }
`;

export const rules = compileRules(
  parsePluginSettings({
    exclude: ['* /internal/*'],
    rules: [
      { match: 'DELETE /items/{itemId}', locked: true, confirm: { param: '/path/itemId' } },
      { match: 'POST /items/{itemId}/{action}', split: 'other-user' },
      { match: '*#other-user', description: 'Acting for another user: locked.', summaryNote: "(another user's item)" },
      { match: 'GET /status/sync', classification: 'read', reason: 'verb:GET', needsReview: false },
      { match: 'POST /items', matchProfile: 'item' },
    ],
  }),
);

export const catalog = buildOpenApiCatalog(SPEC, { service: 'Acme', rules });
export const op = (key: string) => catalog.operations.find((o) => o.key === key);
