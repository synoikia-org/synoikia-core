/** The OpenAPI 3.0 description that the fake "Acme Tasks" serves, as an object the steps change. */
export function acmeDescription(): Record<string, unknown> {
  const listId = { $ref: '#/components/parameters/listId' };
  const body = (type: string, schema: unknown) => ({ content: { [type]: { schema } } });
  return {
    openapi: '3.0.3',
    info: { title: 'Acme Tasks', version: '4.2' },
    components: {
      parameters: {
        listId: {
          name: 'listId',
          in: 'path',
          required: true,
          description: 'The id of the list',
          schema: { type: 'string' },
        },
      },
      schemas: {
        List: {
          type: 'object',
          properties: { name: { type: 'string' }, parent: { $ref: '#/components/schemas/List' } },
        },
        Task: { type: 'object', properties: { title: { type: 'string' } } },
      },
    },
    paths: {
      '/lists': { get: { summary: 'Show the lists', tags: ['Lists'] } },
      '/lists/{listId}': {
        parameters: [listId],
        get: { summary: 'Show a list', tags: ['Lists'] },
        patch: {
          summary: 'Rename a list',
          tags: ['Lists'],
          requestBody: body('application/json', { $ref: '#/components/schemas/List' }),
        },
        delete: { summary: 'Delete a list', tags: ['Lists'] },
      },
      '/lists/{listId}/tasks': {
        parameters: [listId],
        get: {
          summary: 'Show the open tasks',
          description: 'The tasks of the list that are not done.',
          tags: ['Tasks'],
          parameters: [
            { name: 'limit', in: 'query', description: 'How many tasks to show', schema: { type: 'integer' } },
          ],
        },
        post: {
          summary: 'Add a task',
          tags: ['Tasks'],
          requestBody: {
            content: {
              'application/x-www-form-urlencoded': { schema: { $ref: '#/components/schemas/Task' } },
              'application/json': { schema: { $ref: '#/components/schemas/Task' } },
            },
          },
        },
      },
      '/lists/{listId}/tasks/{title}': {
        patch: {
          summary: 'Complete a task',
          tags: ['Tasks'],
          parameters: [listId, { name: 'title', in: 'path', required: true, schema: { type: 'string' } }],
        },
      },
      '/lists/{listId}/count': { get: { summary: 'Count the tasks', tags: ['Tasks'], parameters: [listId] } },
      '/lists/{listId}/state': { get: { summary: 'Reset the list', tags: ['Lists'], parameters: [listId] } },
      '/lists/{listId}/reset': { get: { summary: 'A clean list', tags: ['Lists'], parameters: [listId] } },
      '/lists/{listId}/run-now': { get: { summary: 'Due tasks of the list', tags: ['Tasks'], parameters: [listId] } },
      '/lists/{listId}/share': {
        post: {
          summary: 'Share a list',
          tags: ['Lists'],
          parameters: [listId],
          requestBody: body('application/x-www-form-urlencoded', {
            type: 'object',
            properties: { password: { type: 'string' } },
          }),
        },
      },
      '/lists/{listId}/import': {
        post: {
          summary: 'Import tasks',
          tags: ['Tasks'],
          parameters: [listId],
          requestBody: body('multipart/form-data', { type: 'object', properties: { file: { type: 'string' } } }),
        },
      },
      '/tokens': { post: { summary: 'Create an API token', tags: ['Account'] } },
      '/version': { get: { summary: 'Show the version', tags: ['Account'] } },
      '/internal/debug': { get: { summary: 'Debug the server' } },
      '/../escape': { get: { summary: 'Leave the service' } },
      '/bad path': { get: { summary: 'A path with a space' } },
    },
  };
}

/** A YAML document whose aliases expand 9 times per level, `levels` deep. */
export function aliasBomb(levels: number): string {
  const name = (i: number) => String.fromCharCode(97 + i);
  const lines = ['a: &a [x,x,x,x,x,x,x,x,x]'];
  for (let i = 1; i <= levels; i++)
    lines.push(
      `${name(i)}: &${name(i)} [${Array(9)
        .fill(`*${name(i - 1)}`)
        .join(',')}]`,
    );
  return `openapi: 3.0.0\npaths: {}\n${lines.join('\n')}\n`;
}

const VERBS = ['get', 'post', 'put', 'patch', 'delete'];

/** The catalog key of the operation with this summary, such as `GET /lists/{listId}/tasks`. */
export function keyOf(description: Record<string, unknown>, summary: string): string {
  const paths = description.paths as Record<string, Record<string, { summary?: string }>>;
  for (const [template, item] of Object.entries(paths))
    for (const verb of VERBS) if (item[verb]?.summary === summary) return `${verb.toUpperCase()} ${template}`;
  throw new Error(`the description of Acme Tasks has no operation "${summary}"`);
}

/** The operation object with this summary, to change it. */
export function operationOf(description: Record<string, unknown>, summary: string): Record<string, unknown> {
  const [verb, template] = keyOf(description, summary).split(' ') as [string, string];
  const paths = description.paths as Record<string, Record<string, Record<string, unknown>>>;
  return paths[template]![verb.toLowerCase()]!;
}
