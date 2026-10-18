import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  buildOpenApiCatalog,
  compileRules,
  definePlugin,
  fetchSpec,
  HttpJsonClient,
  notify,
  parsePluginSettings,
  requireString,
  restBinding,
  restLookup,
  singleFlight,
} from '@synoikia/plugin-sdk';
import type { PluginHandlers } from '@synoikia/plugin-sdk';

/** The plugin's own `plugin:` section: the lists that belong to the signed-in user. */
const OwnSection = z.object({ myLists: z.array(z.string()).default([]) }).strict();

interface Connection {
  baseUrl: string;
  http: HttpJsonClient;
}

/** The "Acme Tasks" plugin of plugin author 3: an OpenAPI catalog read from Acme Tasks, with plugin.yaml rules. */
export function acmeTasksPlugin(dir: string): PluginHandlers {
  const settings = parsePluginSettings(parseYaml(readFileSync(path.join(dir, 'plugin.yaml'), 'utf8')), OwnSection);
  let client: () => HttpJsonClient = () => {
    throw new Error('not connected');
  };
  const rules = compileRules(settings, { lookup: restLookup(() => client()) });

  return definePlugin<Connection>({
    connect: ({ config, secrets }) => {
      const baseUrl = requireString(config, 'baseUrl');
      const token = requireString(secrets, 'token');
      let cookie: string | undefined;
      const session = config.signIn === 'session';
      const http: HttpJsonClient = new HttpJsonClient({
        baseUrl,
        service: 'Acme Tasks',
        headers: (): Record<string, string> =>
          session ? (cookie ? { cookie } : {}) : { authorization: `Bearer ${token}` },
        ...(session ? { before: async (deadline) => void (cookie ? undefined : await signIn(deadline)) } : {}),
      });
      const signIn = singleFlight(async (deadline: number) => {
        const res = await http.raw('POST', '/login', {
          body: { username: 'author3', password: token },
          bodyEncoding: 'form',
          deadline,
        });
        cookie = res.headers['set-cookie']?.[0]?.split(';')[0];
      });
      return { baseUrl, http };
    },
    close: (c) =>
      notify({ method: 'log', params: { level: 'info', message: `closed the connection to ${c.baseUrl}` } }),
    version: async (kit) => String(await kit.client().http.request('GET', '/version')),
    probe: async (kit) => {
      await kit.client().http.request('GET', '/account');
    },
    handlers: (kit) => {
      client = () => kit.client().http;
      const catalog = kit.lazy(async () => {
        const { text } = await fetchSpec({
          service: 'Acme Tasks',
          candidates: [{ url: `${kit.client().baseUrl}/spec/v4.2/openapi.yaml`, ref: 'v4.2' }],
        });
        return buildOpenApiCatalog(text, { service: 'Acme Tasks', rules });
      });
      const binding = restBinding({
        namespace: 'acme',
        service: 'Acme Tasks',
        rules,
        catalog: () => catalog.get(),
        client: () => kit.client().http,
        splitWhen: {
          'other-user': (call) => !settings.plugin.myLists.includes(call.params.path?.listId ?? ''),
        },
      });
      return {
        syncCatalog: async () => ({
          upstreamVersion: await kit.version(),
          operations: (await catalog.get()).operations,
        }),
        resolveOperation: (p) => binding.resolveOperation(p),
        summarize: (p) => binding.summarize(p),
        invoke: (p) => binding.invoke(p),
      };
    },
  });
}
