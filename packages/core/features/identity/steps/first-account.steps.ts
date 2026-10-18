import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { browser } from '../../../test/admin-client.js';
import type { SynoikiaWorld } from '../../support/world.js';

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Core as the operator runs it: its own process on its own data directory, with its server log. */
interface ServerRun {
  dataDir: string;
  env: Record<string, string>;
  log: string;
  adminBase: string;
  child?: ChildProcess;
}

const state = new WeakMap<
  SynoikiaWorld,
  { answers: Response[]; bodies: Record<string, unknown>[]; server?: ServerRun; startEnv?: Record<string, string> }
>();
const of = (world: SynoikiaWorld) => {
  let s = state.get(world);
  if (!s) state.set(world, (s = { answers: [], bodies: [] }));
  return s;
};

const portalOf = (base: string) =>
  browser({ request: (p, init) => fetch(`${base}${String(p)}`, { ...init, redirect: 'manual' }) });

async function setup(world: SynoikiaWorld, username: string, password: string) {
  const page = await world.portalBrowser();
  const res = await page.post('/api/setup', { username, password });
  return { page, res, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function startServer(world: SynoikiaWorld, run: ServerRun) {
  const child = spawn(
    process.execPath,
    ['--no-node-snapshot', '--conditions=synoikia-source', '--import', 'tsx', 'src/main.ts'],
    {
      cwd: CORE,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        DATA_DIR: run.dataDir,
        MCP_HOST: '127.0.0.1',
        MCP_PORT: '0',
        ADMIN_HOST: '127.0.0.1',
        ADMIN_PORT: '0',
        ...run.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  run.child = child;
  run.log = '';
  const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  world.cleanups.push(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await stopped;
  });
  const port = await new Promise<string>((resolve, reject) => {
    const read = (chunk: Buffer) => {
      run.log += chunk.toString();
      const m = /Admin listener on 127\.0\.0\.1:(\d+)/.exec(run.log);
      if (m) resolve(m[1]!);
    };
    child.stdout!.on('data', read);
    child.stderr!.on('data', read);
    child.once('exit', () => reject(new Error(`core stopped at start-up: ${run.log}`)));
  });
  run.adminBase = `http://127.0.0.1:${port}`;
}

async function stopServer(run: ServerRun) {
  const child = run.child!;
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await stopped;
}

function newServer(world: SynoikiaWorld, env: Record<string, string>) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'synoikia-server-'));
  world.cleanups.unshift(() => Promise.resolve(rmSync(dataDir, { recursive: true, force: true })));
  return (of(world).server = { dataDir, env, log: '', adminBase: '' });
}

async function accountsOf(run: ServerRun, username: string, password: string) {
  const page = portalOf(run.adminBase);
  await page.init();
  const signIn = await page.post('/auth/login', { username, password });
  expect(signIn.status).toBe(200);
  return (await (await page.get('/api/users')).json()) as { username: string }[];
}

// ── the first account in the portal ──

Given('a new server with no accounts', async (world: SynoikiaWorld) => {
  await world.freshCore();
});

When(
  'the admin makes the first account {string} with the password {string}',
  async (world: SynoikiaWorld, username: string, password: string) => {
    const { page, res, body } = await setup(world, username, password);
    of(world).answers = [res];
    of(world).bodies = [body];
    world.admin = page;
  },
);

When(
  'the admin makes the first account {string} with a password of {int} characters',
  async (world: SynoikiaWorld, username: string, length: number) => {
    const { res, body } = await setup(world, username, 'x'.repeat(length));
    of(world).answers = [res];
    of(world).bodies = [body];
  },
);

When(
  'someone makes the first account {string} with the password {string}',
  async (world: SynoikiaWorld, username: string, password: string) => {
    const { res, body } = await setup(world, username, password);
    of(world).answers = [res];
    of(world).bodies = [body];
  },
);

When(
  '{string} and {string} each make the first account at the same moment',
  async (world: SynoikiaWorld, a: string, b: string) => {
    const both = await Promise.all([a, b].map((name) => setup(world, name, `${name} correct horse battery`)));
    of(world).answers = both.map((r) => r.res);
    of(world).bodies = both.map((r) => r.body);
  },
);

Then('the admin is signed in to the portal as {string}', async (world: SynoikiaWorld, username: string) => {
  expect(of(world).answers[0]!.status).toBe(200);
  const session = await world.expectOk(world.admin.get('/api/session'), 'read session');
  expect(session).toMatchObject({ authenticated: true, setupRequired: false, user: { username } });
  expect((session.user as { role: { isAdmin: boolean } }).role.isAdmin).toBe(true);
});

Then('they are told that setup is already done', (world: SynoikiaWorld) => {
  expect(of(world).answers[0]!.status).toBe(409);
  expect(of(world).bodies[0]).toMatchObject({ error: 'setup_done', message: 'Setup has already been completed' });
});

Then('the server has no account {string}', async (world: SynoikiaWorld, username: string) => {
  const users = (await world.expectOk(world.admin.get('/api/users'), 'list users')) as unknown as {
    username: string;
  }[];
  expect(users.map((u) => u.username)).not.toContain(username);
});

Then(
  'one of them has the only account, and the other is told that setup is already done',
  async (world: SynoikiaWorld) => {
    const { answers, bodies } = of(world);
    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(bodies.find((b) => b.error)).toMatchObject({ error: 'setup_done' });
    const winner = bodies.find((b) => b.status === 'ok')!.user as { username: string };
    const page = await world.portal(winner.username, `${winner.username} correct horse battery`);
    const users = (await world.expectOk(page.get('/api/users'), 'list users')) as unknown as unknown[];
    expect(users).toHaveLength(1);
  },
);

Then('the admin is told that a password needs at least 12 characters', (world: SynoikiaWorld) => {
  expect(of(world).answers[0]!.status).toBe(400);
  expect(of(world).bodies[0]).toMatchObject({ message: 'Passwords must be at least 12 characters' });
});

Then('the admin is told that the password is too long', (world: SynoikiaWorld) => {
  expect(of(world).answers[0]!.status).toBe(400);
  expect(JSON.stringify(of(world).bodies[0])).toMatch(/password.*(too long|<=1024)/i);
});

Then('the server still has no accounts', async (world: SynoikiaWorld) => {
  const page = await world.portalBrowser();
  const session = await world.expectOk(page.get('/api/session'), 'read session');
  expect(session.setupRequired).toBe(true);
});

// ── the first admin from the start-up settings ──

Given(
  'the operator sets the start-up admin {string} with the password {string}',
  (world: SynoikiaWorld, username: string, password: string) => {
    of(world).startEnv = { ADMIN_BOOTSTRAP_USERNAME: username, ADMIN_BOOTSTRAP_PASSWORD: password };
  },
);

When('the server starts on an empty data directory', async (world: SynoikiaWorld) => {
  await startServer(world, newServer(world, of(world).startEnv ?? {}));
});

When('the server starts on an empty data directory without a start-up admin', async (world: SynoikiaWorld) => {
  await startServer(world, newServer(world, {}));
});

Given('the server started once and made the admin {string}', async (world: SynoikiaWorld, username: string) => {
  const run = newServer(world, of(world).startEnv ?? {});
  await startServer(world, run);
  expect(run.log).toContain(`Created admin user "${username}"`);
  await stopServer(run);
});

When('the server starts again with the same start-up settings', async (world: SynoikiaWorld) => {
  await startServer(world, of(world).server!);
});

Then('the server log says that it made the admin {string}', (world: SynoikiaWorld, username: string) => {
  expect(of(world).server!.log).toContain(`WARN Created admin user "${username}" from ADMIN_BOOTSTRAP_*`);
});

Then(
  '{string} signs in to the portal with the password {string}',
  async (world: SynoikiaWorld, username: string, password: string) => {
    const users = await accountsOf(of(world).server!, username, password);
    expect(users.map((u) => u.username)).toEqual([username]);
  },
);

Then('the server log warns that the start-up admin is ignored and should be removed', (world: SynoikiaWorld) => {
  const { log } = of(world).server!;
  expect(log).toContain('WARN ADMIN_BOOTSTRAP_* is set but users already exist; it is ignored');
  expect(log).toContain('remove it');
  expect(log).not.toContain('Created admin user');
});

Then('the server still has one account', async (world: SynoikiaWorld) => {
  const { env } = of(world).server!;
  const users = await accountsOf(of(world).server!, env.ADMIN_BOOTSTRAP_USERNAME!, env.ADMIN_BOOTSTRAP_PASSWORD!);
  expect(users).toHaveLength(1);
});

Then('the server log says to open the portal to make the first account', (world: SynoikiaWorld) => {
  const { log } = of(world).server!;
  expect(log).toContain('No users yet: open the admin portal to create the first account.');
  expect(log).not.toContain('Created admin user');
});
