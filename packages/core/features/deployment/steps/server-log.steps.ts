import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { startCoreProcess } from '../../support/core-process.js';
import { eventually, GATEWAY } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';
import { foreignJwt, INITIALIZE, rawRequest } from './requests.js';

const OTHER_ISSUER = 'https://home.cloudflareaccess.com';

const state = new WeakMap<
  SynoikiaWorld,
  { answers: { status: number; text: string }[]; token: string; logFrom: number; processLog: string }
>();
const of = (world: SynoikiaWorld) => {
  let s = state.get(world);
  if (!s) state.set(world, (s = { answers: [], token: '', logFrom: 0, processLog: '' }));
  return s;
};

/** The server log since the When step began. */
const lines = (world: SynoikiaWorld) => world.serverLog.slice(of(world).logFrom);
const mark = (world: SynoikiaWorld) => (of(world).logFrom = world.serverLog.length);

const send = (base: string, slug: string, headers: Record<string, string>) =>
  rawRequest(base, `/${slug}`, { body: INITIALIZE, headers });

// ── refusals ──

When('an app sends {string} a token of another issuer', async (world: SynoikiaWorld, slug: string) => {
  mark(world);
  const token = foreignJwt({ iss: OTHER_ISSUER, aud: 'x' });
  of(world).token = token;
  of(world).answers = [
    await send(world.mcpBase, slug, { authorization: `Bearer ${token}`, 'cf-access-jwt-assertion': token }),
  ];
});

Then('the app is asked to sign in', (world: SynoikiaWorld) => {
  expect(of(world).answers[0]!.status).toBe(401);
});

Then(
  'the server log warns that the token comes from another issuer, says to turn on the access gateway, and never shows the token',
  (world: SynoikiaWorld) => {
    const warn = lines(world).find((l) => l.startsWith('WARN MCP request refused'));
    expect(warn).toMatch(/^WARN MCP request refused method=POST slug=tasks status=401 reason="got a JWT/);
    expect(warn).toContain(`a JWT from another issuer (iss=${OTHER_ISSUER})`);
    expect(warn).toContain('enable External client auth for this endpoint');
    expect(lines(world).join('\n')).not.toContain(of(world).token);
  },
);

When(
  'an app sends {string} a token whose issuer holds a line break, a forged log line and 10000 characters',
  async (world: SynoikiaWorld, slug: string) => {
    mark(world);
    const token = foreignJwt({ iss: `x\nINFO MCP session opened slug=tasks client=token:admin ${'y'.repeat(10_000)}` });
    of(world).answers = [await send(world.mcpBase, slug, { authorization: `Bearer ${token}` })];
  },
);

Then(
  'the server log has one line for the refusal, under {int} characters, and no forged line',
  (world: SynoikiaWorld, max: number) => {
    expect(of(world).answers[0]!.status).toBe(401);
    const refused = lines(world).filter((l) => l.includes('MCP request refused'));
    expect(refused).toHaveLength(1);
    expect(refused[0]).not.toContain('\n');
    expect(refused[0]!.length).toBeLessThan(max);
    expect(lines(world).some((l) => l.startsWith('INFO MCP session opened'))).toBe(false);
  },
);

When(
  'an app sends {string} an assertion of the access gateway for another application, and then no assertion',
  async (world: SynoikiaWorld, slug: string) => {
    mark(world);
    const assertion = await world.gatewayAssertion({ email: 'me@example.com' }, { aud: 'another-application' });
    of(world).answers = [
      await send(world.mcpBase, slug, { 'cf-access-jwt-assertion': assertion }),
      await send(world.mcpBase, slug, {}),
    ];
  },
);

Then(
  'the server log warns about the application claim, and logs the request without an assertion only for debugging',
  (world: SynoikiaWorld) => {
    expect(of(world).answers.map((a) => a.status)).toEqual([401, 401]);
    const [bad, missing] = lines(world).filter((l) => l.includes('MCP request refused'));
    expect(bad).toMatch(/^WARN /);
    expect(bad).toContain('Cloudflare Access assertion rejected');
    expect(bad).toContain(`aud=another-application; expected iss=https://${GATEWAY.teamDomain} aud=${GATEWAY.aud}`);
    expect(missing).toMatch(/^DEBUG /);
    expect(missing).toContain('no Cf-Access-Jwt-Assertion header');
  },
);

// ── noise ──

When(
  'an app sends {string} the token {string} three times, and once more a minute later',
  async (world: SynoikiaWorld, slug: string, token: string) => {
    mark(world);
    for (let i = 0; i < 3; i++) await send(world.mcpBase, slug, { authorization: `Bearer ${token}` });
    world.passTime(61_000);
    await send(world.mcpBase, slug, { authorization: `Bearer ${token}` });
  },
);

Then(
  'the server log has a debug line for the first one, and a line a minute later that counts {int} dropped repeats',
  (world: SynoikiaWorld, dropped: number) => {
    const refused = lines(world).filter((l) => l.includes('MCP request refused'));
    expect(refused).toHaveLength(2);
    expect(refused[0]).toMatch(/^DEBUG MCP request refused /);
    expect(refused[0]).not.toContain('suppressed=');
    expect(refused[1]).toMatch(/^DEBUG MCP request refused /);
    expect(refused[1]).toContain(` suppressed=${dropped}`);
  },
);

When(
  'agent {word} opens a session from a page of {string}, then a session, then sends a request without a session',
  async (world: SynoikiaWorld, agent: string, origin: string) => {
    mark(world);
    const authorization = `Bearer ${world.agents.get(agent)!.token}`;
    of(world).token = world.agents.get(agent)!.token;
    of(world).answers = [
      await send(world.mcpBase, world.lastInstance, { authorization, origin }),
      await send(world.mcpBase, world.lastInstance, { authorization }),
      await rawRequest(world.mcpBase, `/${world.lastInstance}`, {
        body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        headers: { authorization },
      }),
    ];
  },
);

Then(
  'the server log warns about the origin, notes the session, and warns about the transport error, without the credential',
  (world: SynoikiaWorld) => {
    const [origin, opened, notInit] = of(world).answers;
    expect([origin!.status, opened!.status]).toEqual([403, 200]);
    expect(notInit!.status).toBeGreaterThanOrEqual(400);
    const text = lines(world).join('\n');
    expect(text).toMatch(/^WARN MCP request refused .*reason="Host or Origin not allowed.* origin=/m);
    expect(text).toMatch(/^INFO MCP session opened slug=tasks client="token:agent 7"/m);
    expect(text).toMatch(/^WARN MCP request rejected by the transport method=POST slug=tasks status=4\d\d error=/m);
    expect(text).not.toContain(of(world).token);
  },
);

When(
  'a browser opens the OAuth sign-in of the agent port with the state {string}',
  async (world: SynoikiaWorld, secret: string) => {
    mark(world);
    await rawRequest(world.mcpBase, `/oauth/authorize?state=${secret}&client_id=acme-chat`);
  },
);

Then(
  'the server log shows a request line for {string} without {string}',
  (world: SynoikiaWorld, pathname: string, secret: string) => {
    expect(lines(world).some((l) => l.startsWith(`DEBUG MCP listener request method=GET path=${pathname} `))).toBe(
      true,
    );
    expect(lines(world).join('\n')).not.toContain(secret);
  },
);

// ── levels and faults ──

When(
  'the server runs with the log level {string}, and an app sends a junk token and a token of another issuer',
  async (world: SynoikiaWorld, level: string) => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-log-'));
    world.cleanups.push(() => Promise.resolve(rmSync(dataDir, { recursive: true, force: true })));
    const run = await startCoreProcess(world, dataDir, { LOG_LEVEL: level });
    expect(run.mcpBase, run.log).not.toBe('');
    await send(run.mcpBase, 'tasks', { authorization: 'Bearer junk' });
    await send(run.mcpBase, 'tasks', { authorization: `Bearer ${foreignJwt({ iss: OTHER_ISSUER })}` });
    await eventually(() => run.log.includes('MCP request refused'), 'the refusal in the log');
    await new Promise((r) => setTimeout(r, 200));
    of(world).processLog = run.log;
  },
);

Then('its log has the warning for the token of another issuer, and no debug or info line', (world: SynoikiaWorld) => {
  const log = of(world).processLog.split('\n');
  expect(log.filter((l) => l.startsWith('WARN MCP request refused'))).toHaveLength(1);
  expect(log.filter((l) => /^(DEBUG|INFO) /.test(l))).toEqual([]);
});

When('the admin tries to open the connection of {string}', async (world: SynoikiaWorld, slug: string) => {
  await world.signInAgain();
  mark(world);
  const res = await world.admin.get(`/api/instances/${world.instances.get(slug)!}/connection`);
  of(world).answers = [{ status: res.status, text: await res.text() }];
});

Then('the admin is told only that there was an internal error', (world: SynoikiaWorld) => {
  expect(of(world).answers[0]!.status).toBe(500);
  expect(JSON.parse(of(world).answers[0]!.text)).toEqual({ error: 'internal', message: 'Internal error' });
});

Then(
  'the server log names the route of the connection, but not the id of {string}',
  (world: SynoikiaWorld, slug: string) => {
    const errors = lines(world).filter((l) => l.startsWith('ERROR request failed'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ERROR request failed method=GET route=\/api\/instances\/:id\/connection /);
    expect(errors[0]).not.toContain(world.instances.get(slug)!);
  },
);
