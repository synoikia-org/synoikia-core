import { createHash, randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';

/** What an instance of the MCP listener answered to one request, as the agent's app got it. */
export interface Knock {
  status: number;
  /** The sign-in challenge, empty when there is none. */
  www: string;
  body: Record<string, unknown>;
  text: string;
  sessionId?: string;
}

/** An app that signs in with OAuth, as core registered it. */
export interface OAuthApp {
  clientId: string;
  secret?: string;
  redirectUri: string;
}

/** A sign-in request of an app, from the authorize page to the code. */
export interface Flow {
  app: OAuthApp;
  verifier: string;
  query: URLSearchParams;
  browser?: ReturnType<SynoikiaWorld['pageBrowser']>;
  page?: { status: number; html: string; location?: string | null };
  /** What the sign-in form answered. */
  signIn?: { status: number; html: string; location?: string | null };
  code?: string;
}

/** What the client-auth steps keep between steps of one scenario. */
interface ClientAuthState {
  /** The answers each caller got, by name, such as "agent 7" or "the stranger at nope". */
  knocks: Map<string, Knock>;
  /** What the last request to the Admin API or the token service answered. */
  answer: { status: number; body: Record<string, unknown>; text: string };
  /** More answers of one step, in order. */
  answers: { status: number; body: Record<string, unknown>; text: string }[];
  apps: Map<string, OAuthApp>;
  flow?: Flow;
  /** The token pairs the token service gave, in order. */
  pairs: { access_token: string; refresh_token: string }[];
  seen: Record<string, unknown>;
}

const states = new WeakMap<SynoikiaWorld, ClientAuthState>();
export const clientAuth = (world: SynoikiaWorld) => {
  let s = states.get(world);
  if (!s)
    states.set(
      world,
      (s = {
        knocks: new Map(),
        answer: { status: 0, body: {}, text: '' },
        answers: [],
        apps: new Map(),
        pairs: [],
        seen: {},
      }),
    );
  return s;
};

export const REDIRECT = 'http://127.0.0.1:9/callback';

/** The first message of an MCP session, with the name and version the agent's app gives for itself. */
export const initialize = (name?: unknown, version = '1.0.0') => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    ...(name === undefined ? {} : { clientInfo: { name, version } }),
  },
});

const parse = (text: string): Record<string, unknown> => {
  const data = /^data: (.*)$/m.exec(text)?.[1] ?? text;
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** Sends one message to an instance of the MCP listener; without `body`, it opens a session. */
export async function knock(
  world: SynoikiaWorld,
  slug: string,
  headers: Record<string, string> = {},
  body: unknown = initialize('Acme Chat'),
  method = 'POST',
): Promise<Knock> {
  const res = await fetch(`${world.mcpBase}/${slug}`, {
    method,
    headers: {
      accept: 'application/json, text/event-stream',
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const text = method === 'GET' && res.ok ? (await res.body?.cancel(), '') : await res.text();
  return {
    status: res.status,
    www: res.headers.get('www-authenticate') ?? '',
    body: parse(text),
    text,
    sessionId: res.headers.get('mcp-session-id') ?? undefined,
  };
}

/** The credential an agent of the World holds, as its app sends it. */
export const bearerOf = (world: SynoikiaWorld, agent: string) => {
  const a = world.agents.get(agent);
  if (!a) throw new Error(`The World has no agent ${agent} yet`);
  return { authorization: `Bearer ${a.token}` };
};

/** A ping in an open session. */
export const ping = (world: SynoikiaWorld, slug: string, headers: Record<string, string>, sessionId: string) =>
  knock(world, slug, { ...headers, 'mcp-session-id': sessionId }, { jsonrpc: '2.0', id: 2, method: 'ping' });

/** Keeps what an Admin API request answered. */
export async function keepAnswer(world: SynoikiaWorld, res: Promise<Response> | Response) {
  const r = await res;
  const text = await r.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* not data */
  }
  const answer = { status: r.status, body, text };
  clientAuth(world).answer = answer;
  clientAuth(world).answers.push(answer);
  return answer;
}

/** The last kept answer is a refusal of the Admin API with this code. */
export const expectRefusal = (
  answer: { status: number; body: Record<string, unknown>; text: string },
  code: string,
) => {
  expect(answer.status, answer.text).toBeGreaterThanOrEqual(400);
  expect(answer.status, answer.text).toBeLessThan(500);
  expect(answer.body.error, answer.text).toBe(code);
};

export const mcpSettings = async (world: SynoikiaWorld) =>
  (await world.expectOk(world.admin.get('/api/settings'), 'read settings')).mcp as {
    clientAuth: Record<string, boolean>;
    cfAccess: { teamDomain: string; aud: string };
    allowDynamicRegistration: boolean;
    accessTokenTtlMinutes: number;
    refreshTokenTtlDays: number;
    clientPolicy: { mode: string; names: string[] };
  };

export const putMcp = (world: SynoikiaWorld, patch: Record<string, unknown>) =>
  world.admin.put('/api/settings/mcp', patch);

/** The admin lets an instance take only these sign-in methods. */
export async function instanceMethods(world: SynoikiaWorld, slug: string, methods: string[] | null) {
  const id = await world.tasksInstance(slug);
  await world.expectOk(world.admin.patch(`/api/instances/${id}`, { authMethods: methods }), 'set sign-in methods');
}

/** The app "Acme Chat" as the admin registered it, or with `confidential`, with a secret. */
export async function adminApp(world: SynoikiaWorld, name = 'Acme Chat', confidential = false) {
  const s = clientAuth(world);
  const known = s.apps.get(name);
  if (known) return known;
  await world.publicMcpAddress();
  const created = await world.expectOk(
    world.admin.post('/api/oauth/clients', { name, redirectUris: [REDIRECT], confidential }),
    'register client',
  );
  const app = {
    clientId: created.client_id as string,
    secret: created.client_secret as string | undefined,
    redirectUri: REDIRECT,
  };
  s.apps.set(name, app);
  return app;
}

/** The sign-in request of an app: the query of the authorize page with a fresh proof key. */
export function flowFor(app: OAuthApp, extra: Record<string, string | string[]> = {}): Flow {
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: app.clientId,
    redirect_uri: app.redirectUri,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'acme-chat',
  });
  for (const [k, v] of Object.entries(extra)) {
    query.delete(k);
    for (const one of [v].flat()) if (one !== '') query.append(k, one);
  }
  return { app, verifier, query };
}

/** `person` opens the authorize page of the flow in a fresh browser and signs in with a password there. */
export async function signInForFlow(world: SynoikiaWorld, flow: Flow, person: string) {
  flow.browser = world.pageBrowser();
  const path = `/oauth/authorize?${flow.query.toString()}`;
  flow.signIn = await world.signInOnPage(flow.browser.send, person, path);
  flow.page = await flow.browser.send(path);
  clientAuth(world).flow = flow;
  return flow.page;
}

/** The consent form's fields on the page the flow shows now. */
export const consentForm = (html: string) => ({
  form: /name="form" value="([^"]+)"/.exec(html)?.[1] ?? '',
  resources: [...html.matchAll(/name="resource" value="([^"]+)"/g)].map((m) => m[1]!),
});

/** The person decides on the consent page; `resources` picks by instance name, all by default. */
export async function decide(
  world: SynoikiaWorld,
  flow: Flow,
  decision: 'approve' | 'deny',
  opts: { access?: 'read' | 'write'; slugs?: string[] } = {},
) {
  const { form, resources } = consentForm(flow.page!.html);
  const chosen = opts.slugs ? resources.filter((r) => opts.slugs!.some((s) => r.endsWith(`/${s}`))) : resources;
  const body = new URLSearchParams({ form, decision, ...(opts.access ? { access: opts.access } : {}) });
  for (const r of chosen) body.append('resource', r);
  const res = await fetch(`${world.mcpBase}/oauth/consent`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: flowCookies(flow).join('; '),
    },
    body: body.toString(),
  });
  flow.page = { status: res.status, html: await res.text(), location: res.headers.get('location') };
  flow.code = flow.page.location ? (new URL(flow.page.location).searchParams.get('code') ?? undefined) : undefined;
  return flow.page;
}

const flowCookies = (flow: Flow) => [...flow.browser!.jar].map(([k, v]) => `${k}=${v}`);

/** The token service's answer to a form. */
export async function tokenService(world: SynoikiaWorld, form: Record<string, string>, path = '/oauth/token') {
  const res = await fetch(`${world.mcpBase}${path}`, { method: 'POST', body: new URLSearchParams(form) });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* empty */
  }
  const answer = { status: res.status, body, text };
  clientAuth(world).answer = answer;
  return answer;
}

/** The app exchanges the code of the flow, with its own proof key unless `verifier` differs. */
export async function exchange(world: SynoikiaWorld, flow: Flow, overrides: Record<string, string> = {}) {
  const answer = await tokenService(world, {
    grant_type: 'authorization_code',
    code: flow.code ?? '',
    redirect_uri: flow.app.redirectUri,
    code_verifier: flow.verifier,
    client_id: flow.app.clientId,
    ...(flow.app.secret ? { client_secret: flow.app.secret } : {}),
    ...overrides,
  });
  if (answer.status === 200) clientAuth(world).pairs.push(answer.body as never);
  return answer;
}

/** The app renews its sign-in with a refresh token. */
export async function refresh(world: SynoikiaWorld, flow: Flow, refreshToken: string) {
  const answer = await tokenService(world, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: flow.app.clientId,
    ...(flow.app.secret ? { client_secret: flow.app.secret } : {}),
  });
  if (answer.status === 200) clientAuth(world).pairs.push(answer.body as never);
  return answer;
}

/** `person` lets the app in for the agent: sign-in, consent with `access` on `slugs`, and the code exchange. */
export async function oauthSignIn(
  world: SynoikiaWorld,
  agent: string,
  person: string,
  opts: { access?: 'read' | 'write'; slugs?: string[]; app?: OAuthApp } = {},
) {
  const app = opts.app ?? (await adminApp(world));
  const flow = flowFor(app);
  await signInForFlow(world, flow, person);
  const granted = consentForm(flow.page!.html).resources;
  await decide(world, flow, 'approve', opts);
  if (!flow.code) throw new Error(`no code: ${flow.page?.location} ${flow.page?.html}`);
  const answer = await exchange(world, flow);
  if (answer.status !== 200) throw new Error(`token exchange: ${answer.text}`);
  world.agents
    .get(agent)
    ?.client?.close()
    .catch(() => undefined);
  world.agents.set(agent, {
    token: answer.body.access_token as string,
    tokenId: '',
    owner: person,
    oauth: {
      clientId: app.clientId,
      refreshToken: answer.body.refresh_token as string,
      resource: granted.find((r) => !opts.slugs || opts.slugs.some((s) => r.endsWith(`/${s}`))) ?? '',
    },
  });
  return flow;
}
