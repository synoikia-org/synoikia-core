import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { runCli } from '../../support/core-process.js';
import type { SynoikiaWorld } from '../../support/world.js';
import { appOf, codeStep, passwordStep } from '../../identity/steps/identity.js';

const keyFile = (world: SynoikiaWorld) => path.join(world.dataDir, 'master.key');

const state = new WeakMap<
  SynoikiaWorld,
  { result: { code: number | null; output: string }; keyBefore: string; oldKey?: string }
>();
const of = (world: SynoikiaWorld) => {
  let s = state.get(world);
  if (!s) state.set(world, (s = { result: { code: null, output: '' }, keyBefore: '' }));
  return s;
};

/** The operator's `rotate-master-key` command on the World's data directory. */
async function rotate(world: SynoikiaWorld, env: Record<string, string> = {}, flags: string[] = []) {
  of(world).keyBefore = existsSync(keyFile(world)) ? readFileSync(keyFile(world), 'utf8') : '';
  of(world).result = await runCli(['rotate-master-key', ...flags], {
    DATA_DIR: world.dataDir,
    ...(world.coreEnv.MASTER_KEY ? { MASTER_KEY: world.coreEnv.MASTER_KEY } : {}),
    ...env,
  });
}

Given('the admin has a phone channel with a token', async (world: SynoikiaWorld) => {
  await world.expectOk(
    world.admin.post('/api/notifiers', {
      kind: 'ntfy',
      name: 'Phone',
      config: { server: 'https://ntfy.example', topic: 'synoikia-admin' },
      secrets: { token: 'tk_phone_secret' },
      events: ['auth.lockout'],
    }),
    'add phone channel',
  );
});

Given('the operator stopped the server', async (world: SynoikiaWorld) => {
  await world.stopCore();
});

Given('the server runs with a master key in its start-up settings', async (world: SynoikiaWorld) => {
  const key = randomBytes(32).toString('base64');
  of(world).oldKey = key;
  await world.stopCore();
  await world.startAgain({ MASTER_KEY: key });
  expect(world.startError).toBeUndefined();
  await world.signInAgain();
});

Given(
  'the data directory holds the lock of a server in the container {string}',
  (world: SynoikiaWorld, host: string) => {
    writeFileSync(
      path.join(world.dataDir, 'server.lock'),
      JSON.stringify({ pid: 1, host, startedAt: new Date().toISOString() }),
    );
  },
);

When('the operator rotates the master key', async (world: SynoikiaWorld) => {
  await rotate(world);
});

When('the operator rotates the master key with force', async (world: SynoikiaWorld) => {
  await rotate(world, {}, ['--force']);
});

When('the operator rotates the master key with a wrong current key and a new key', async (world: SynoikiaWorld) => {
  await rotate(world, {
    MASTER_KEY: randomBytes(32).toString('base64'),
    NEW_MASTER_KEY: randomBytes(32).toString('base64'),
  });
});

async function rotateAndStart(world: SynoikiaWorld) {
  await world.stopCore();
  await rotate(world);
  expect(of(world).result.code).toBe(0);
  await world.startAgain();
  expect(world.startError).toBeUndefined();
}

When(
  'the operator rotates the master key with the server stopped, and starts the server again',
  async (world: SynoikiaWorld) => {
    await rotateAndStart(world);
  },
);

Given(
  'the operator rotated the master key with the server stopped, and started the server again',
  async (world: SynoikiaWorld) => {
    await rotateAndStart(world);
  },
);

When('the server starts again', async (world: SynoikiaWorld) => {
  await world.startAgain();
  expect(world.startError).toBeUndefined();
});

When(
  'user {int} signs in to the portal with their password and the current code',
  async (world: SynoikiaWorld, user: number) => {
    const person = `user ${user}`;
    await passwordStep(world, person);
    await codeStep(world, person, world.totpCode(appOf(world, person).secret));
  },
);

Then(
  /^the command says that it encrypted (\d+) instance connection and (\d+) channels? again, and signed everyone out$/,
  (world: SynoikiaWorld, instances: string, channels: string) => {
    const { code, output } = of(world).result;
    expect(code, output).toBe(0);
    expect(output).toMatch(
      new RegExp(
        `^Re-encrypted ${instances} endpoint connection\\(s\\), ${channels} notifier\\(s\\), 0 TOTP secret\\(s\\) and 0 OIDC secret\\(s\\); signed out [1-9]\\d* session\\(s\\)\\.$`,
        'm',
      ),
    );
  },
);

Then('the key file holds a new key, and no half-written key file is left', (world: SynoikiaWorld) => {
  const now = readFileSync(keyFile(world), 'utf8');
  expect(now).not.toBe(of(world).keyBefore);
  expect(Buffer.from(now.trim(), 'base64')).toHaveLength(32);
  expect(existsSync(`${keyFile(world)}.new`)).toBe(false);
  expect(of(world).result.output).toContain(`New key written to ${keyFile(world)}.`);
});

Then('the portal asks the admin to sign in again', async (world: SynoikiaWorld) => {
  const session = await world.expectOk(world.admin.get('/api/session'), 'read session');
  expect(session.authenticated).toBe(false);
});

Then('the command says that the server may be running, and the key file is unchanged', (world: SynoikiaWorld) => {
  const { code, output } = of(world).result;
  expect(code).toBe(1);
  expect(output).toMatch(new RegExp(`^Error: The server may be running \\(pid ${process.pid}, since `, 'm'));
  expect(output).toContain('stop it first');
  expect(readFileSync(keyFile(world), 'utf8')).toBe(of(world).keyBefore);
});

Then('the command asks for the new key in the start-up settings', (world: SynoikiaWorld) => {
  const { code, output } = of(world).result;
  expect(code).toBe(1);
  expect(output).toContain('Error: MASTER_KEY comes from the environment: set NEW_MASTER_KEY to the replacement key');
});

Then(
  'the command says that it cannot decrypt the secrets, and the old key still opens them',
  async (world: SynoikiaWorld) => {
    const { code, output } = of(world).result;
    expect(code).toBe(1);
    expect(output).toContain('Error: Unable to decrypt value');
    await world.startAgain({ MASTER_KEY: of(world).oldKey! });
    expect(world.startError).toBeUndefined();
    await world.signInAgain();
    const id = world.instances.get('tasks')!;
    const conn = await world.expectOk(world.admin.get(`/api/instances/${id}/connection`), 'read connection');
    expect(conn.secrets).toMatchObject({ token: { set: true } });
  },
);

Then(
  'the command says that a server may be running on the host {string}, and the key file is unchanged',
  (world: SynoikiaWorld, host: string) => {
    const { code, output } = of(world).result;
    expect(code).toBe(1);
    expect(output).toContain(`Error: The server may be running (pid 1 on host ${host}, since `);
    expect(output).toContain('run again with --force');
    expect(readFileSync(keyFile(world), 'utf8')).toBe(of(world).keyBefore);
  },
);

Then('the server log warns that it took over the lock of {string}', (world: SynoikiaWorld, host: string) => {
  expect(world.serverLog).toContain(
    `WARN ${path.join(world.dataDir, 'server.lock')} was held by pid 1 on host ${host}; taking it over. Two servers must never share a data directory.`,
  );
});
