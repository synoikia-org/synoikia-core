import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { serverLog } from '../../identity/steps/first-account.steps.js';
import { clientAuth, knock } from './client-auth.js';

const FORGED = { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https', forwarded: 'host=evil.example' };

const read = async (world: SynoikiaWorld, path: string, init: RequestInit = {}) => {
  const res = await fetch(`${world.mcpBase}${path}`, init);
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* empty */
  }
  return { status: res.status, body, text };
};

When(
  "an agent's app looks for OAuth on a server without a public address, also under a forged host name",
  async (world: SynoikiaWorld) => {
    const s = clientAuth(world);
    for (const headers of [{}, FORGED]) {
      s.answers.push(await read(world, '/.well-known/oauth-authorization-server', { headers }));
      s.answers.push(await read(world, '/.well-known/oauth-protected-resource/tasks', { headers }));
    }
    s.answers.push(
      await read(world, '/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'Acme Chat', redirect_uris: ['https://chat.acme.example/cb'] }),
      }),
    );
    s.knocks.set('tasks', await knock(world, 'tasks', FORGED));
  },
);

Then(
  'the app is told each time that OAuth is temporarily unavailable, and that it may not register',
  (world: SynoikiaWorld) => {
    const { answers } = clientAuth(world);
    expect(answers).toHaveLength(5);
    for (const a of answers) {
      expect(a.status).toBe(503);
      expect(a.body).toMatchObject({ error: 'temporarily_unavailable' });
      expect(a.text).not.toContain('evil.example');
    }
  },
);

Then('{string} asks the app to sign in with no pointer to OAuth', (world: SynoikiaWorld, slug: string) => {
  expect(clientAuth(world).knocks.get(slug)).toMatchObject({ status: 401, www: 'Bearer' });
});

Then(
  'the server log warns that OAuth is off until the public address is set, and that credentials still work',
  (world: SynoikiaWorld) => {
    expect(serverLog(world)).toContain(
      'WARN PUBLIC_MCP_URL is not set: OAuth is off (bearer tokens still work). Set it to the public address of the MCP port.',
    );
  },
);

When("an agent's app reads the OAuth description of the server", async (world: SynoikiaWorld) => {
  clientAuth(world).answer = await read(world, '/.well-known/oauth-authorization-server');
});

Then('it names the public address, the proof method S256 and the registration of apps', (world: SynoikiaWorld) => {
  const base = world.mcpBase;
  expect(clientAuth(world).answer).toMatchObject({
    status: 200,
    body: {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    },
  });
});

Given(
  'the instance {string} has the display name {string}',
  async (world: SynoikiaWorld, slug: string, name: string) => {
    const id = await world.tasksInstance(slug);
    await world.expectOk(world.admin.patch(`/api/instances/${id}`, { displayName: name }), 'rename instance');
  },
);

When("an agent's app reads the OAuth description of {string}", async (world: SynoikiaWorld, slug: string) => {
  clientAuth(world).answer = await read(world, `/.well-known/oauth-protected-resource/${slug}`);
});

Then(
  'it names the address of {string} and the server, but not {string}',
  (world: SynoikiaWorld, slug: string, name: string) => {
    const { answer } = clientAuth(world);
    expect(answer.body).toMatchObject({
      resource: `${world.mcpBase}/${slug}`,
      authorization_servers: [world.mcpBase],
    });
    expect(answer.text).not.toContain(name);
  },
);

Then('the app finds no OAuth description of {string}', (world: SynoikiaWorld) => {
  expect(clientAuth(world).answer).toMatchObject({ status: 404, body: { error: 'not_found' } });
});
