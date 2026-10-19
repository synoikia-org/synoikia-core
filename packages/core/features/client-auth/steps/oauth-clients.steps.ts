import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { adminApp, clientAuth, flowFor, keepAnswer, putMcp, REDIRECT, tokenService } from './client-auth.js';

const register = (world: SynoikiaWorld, name: string, redirectUris: string[]) =>
  fetch(`${world.mcpBase}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: redirectUris }),
  });

const apps = async (world: SynoikiaWorld) =>
  (await world.expectOk(world.admin.get('/api/oauth/clients'), 'list clients')) as unknown as {
    id: string;
    clientId: string;
    name: string;
    confidential: boolean;
    redirectUris: string[];
  }[];

/** A browser opens the authorize page with this query; it does not follow where the page sends it. */
const openSignIn = async (world: SynoikiaWorld, query: URLSearchParams) => {
  const page = await world.pageBrowser().send(`/oauth/authorize?${query.toString()}`);
  clientAuth(world).answers.push({ status: page.status, body: { location: page.location ?? null }, text: page.html });
};

When(
  'the app {string} registers itself with the return address {string}',
  async (world: SynoikiaWorld, name: string, uri: string) => {
    await keepAnswer(world, register(world, name, [uri]));
  },
);

Then(
  '{string} gets an app id, and the admin sees {string} among the apps',
  async (world: SynoikiaWorld, name: string) => {
    const { answer } = clientAuth(world);
    expect(answer.status).toBe(201);
    expect(answer.body).toMatchObject({ client_name: name, token_endpoint_auth_method: 'none' });
    expect(answer.body.client_secret).toBeUndefined();
    const listed = (await apps(world)).find((a) => a.clientId === answer.body.client_id);
    expect(listed).toMatchObject({ name, registeredVia: 'dcr', confidential: false });
  },
);

When(
  'the app {string} registers itself with {string}, {string} and {string}',
  async (world: SynoikiaWorld, name: string, a: string, b: string, c: string) => {
    for (const uri of [a, b, c]) await keepAnswer(world, register(world, name, [uri]));
  },
);

Then(
  'the first two are refused as unacceptable return addresses, and the address on this machine is accepted',
  (world: SynoikiaWorld) => {
    const [script, plain, local] = clientAuth(world).answers;
    for (const refused of [script!, plain!]) {
      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({ error: 'invalid_redirect_uri' });
    }
    expect(local!.status).toBe(201);
  },
);

Given('the admin closes the self-registration of apps', async (world: SynoikiaWorld) => {
  await world.expectOk(putMcp(world, { allowDynamicRegistration: false }), 'close registration');
});

Then(
  '{string} is told to ask the administrator, and the server description offers no registration',
  async (world: SynoikiaWorld) => {
    expect(clientAuth(world).answer).toMatchObject({
      status: 403,
      body: { error: 'registration_disabled', error_description: 'Ask the administrator to register this client' },
    });
    const meta = (await (await fetch(`${world.mcpBase}/.well-known/oauth-authorization-server`)).json()) as Record<
      string,
      unknown
    >;
    expect(meta.issuer).toBe(world.mcpBase);
    expect(meta).not.toHaveProperty('registration_endpoint');
    expect(await apps(world)).toEqual([]);
  },
);

When(
  'the admin registers the app {string} with two return addresses and a secret',
  async (world: SynoikiaWorld, name: string) => {
    const answer = await keepAnswer(
      world,
      world.admin.post('/api/oauth/clients', {
        name,
        redirectUris: ['https://chat.acme.example/callback', REDIRECT],
        confidential: true,
      }),
    );
    clientAuth(world).apps.set(name, {
      clientId: answer.body.client_id as string,
      secret: answer.body.client_secret as string,
      redirectUri: REDIRECT,
    });
  },
);

Then(
  'the admin sees the secret once, and the token service refuses {string} without it',
  async (world: SynoikiaWorld, name: string) => {
    const { answer } = clientAuth(world);
    expect(answer.status).toBe(201);
    const secret = answer.body.client_secret as string;
    expect(secret.length).toBeGreaterThan(20);
    const listed = await apps(world);
    expect(listed).toEqual([
      expect.objectContaining({
        name,
        confidential: true,
        registeredVia: 'admin',
        redirectUris: ['https://chat.acme.example/callback', REDIRECT],
      }),
    ]);
    expect(JSON.stringify(listed)).not.toContain(secret);
    const app = clientAuth(world).apps.get(name)!;
    for (const form of <Record<string, string>[]>[
      { client_id: app.clientId },
      { client_id: app.clientId, client_secret: 'not the secret' },
    ]) {
      const refused = await tokenService(world, { grant_type: 'refresh_token', refresh_token: 'synr_x', ...form });
      expect(refused).toMatchObject({ status: 401, body: { error: 'invalid_client' } });
    }
    const known = await tokenService(world, {
      grant_type: 'refresh_token',
      refresh_token: 'synr_x',
      client_id: app.clientId,
      client_secret: app.secret!,
    });
    expect(known).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
  },
);

When('the admin revokes the app {string}', async (world: SynoikiaWorld, name: string) => {
  const app = (await apps(world)).find((a) => a.name === name);
  if (!app) throw new Error(`no app "${name}"`);
  const res = await world.admin.del(`/api/oauth/clients/${app.id}`);
  expect(res.status).toBe(204);
});

Then('agent {word} is refused, and cannot renew its sign-in', async (world: SynoikiaWorld, agent: string) => {
  await world.call(agent, 'show the open tasks', { list: 'Groceries' });
  expect(world.answer.refused).toMatch(/Invalid or expired token/);
  const renewed = await world.renewOAuth(agent);
  expect(renewed.status).toBeGreaterThanOrEqual(400);
  expect(['invalid_client', 'invalid_grant']).toContain(renewed.body.error);
});

Given('the admin registered the app {string}', async (world: SynoikiaWorld, name: string) => {
  await world.tasksInstance('tasks');
  await adminApp(world, name);
});

When(
  'a browser opens the sign-in of {string} with the return address {string}',
  async (world: SynoikiaWorld, name: string, uri: string) => {
    await openSignIn(world, flowFor(clientAuth(world).apps.get(name)!, { redirect_uri: uri }).query);
  },
);

Then('the browser gets the page {string}, and is not sent anywhere', (world: SynoikiaWorld, title: string) => {
  const [page] = clientAuth(world).answers;
  expect(page!.status).toBe(400);
  expect(page!.body.location).toBeNull();
  expect(page!.text).toContain(`<h1>${title}</h1>`);
  expect(page!.text).not.toContain('evil.example');
});

When('a browser opens the sign-in of {string} without a proof key', async (world: SynoikiaWorld, name: string) => {
  const app = clientAuth(world).apps.get(name)!;
  await openSignIn(world, flowFor(app, { code_challenge: '', code_challenge_method: '' }).query);
});

Then(
  'the browser goes back to {string} with {string} and the state {string}',
  (world: SynoikiaWorld, _name: string, error: string, state: string) => {
    const [page] = clientAuth(world).answers;
    const back = new URL(page!.body.location as string);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    expect(back.searchParams.get('error')).toBe(error);
    expect(back.searchParams.get('state')).toBe(state);
    expect(back.searchParams.get('iss')).toBe(world.mcpBase);
  },
);

When(
  'a browser opens the sign-in of an unknown app, and of {string} for {string} and for {string}',
  async (world: SynoikiaWorld, name: string, a: string, b: string) => {
    const app = clientAuth(world).apps.get(name)!;
    await openSignIn(world, flowFor({ ...app, clientId: 'mcp_unknown' }).query);
    for (const slug of [a, b]) await openSignIn(world, flowFor(app, { resource: `${world.mcpBase}/${slug}` }).query);
  },
);

Then(
  'the browser gets the page {string}, and then goes back to {string} with {string} twice',
  (world: SynoikiaWorld, title: string, _name: string, error: string) => {
    const [unknown, ...targets] = clientAuth(world).answers;
    expect(unknown!.body.location).toBeNull();
    expect(unknown!.text).toContain(`<h1>${title}</h1>`);
    expect(targets).toHaveLength(2);
    for (const t of targets) expect(new URL(t.body.location as string).searchParams.get('error')).toBe(error);
  },
);
