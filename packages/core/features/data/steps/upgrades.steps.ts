import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';

Then(
  'the admin still has the user {string} with the role {string}, and the instance {string}',
  async (world: SynoikiaWorld, username: string, role: string, slug: string) => {
    const users = (await world.expectOk(world.admin.get('/api/users'), 'list users')) as unknown as {
      username: string;
      role: { name: string } | null;
    }[];
    expect(users.find((u) => u.username === username)?.role?.name).toBe(role);
    const instance = await world.expectOk(
      world.admin.get(`/api/instances/${world.instances.get(slug)!}`),
      'read instance',
    );
    expect(instance).toMatchObject({ slug, status: 'ready' });
  },
);

// ── an upgrade to the account kinds (ADR-0025) ──

Given(
  'user {int} had a password and a linked Acme ID before the upgrade',
  async (world: SynoikiaWorld, user: number) => {
    await world.setUpAcmeId();
    const who = await world.user(`user ${user}`, 'family');
    const { issuer } = await world.acmeId();
    await world.stopCore();
    // The data file of an earlier release: an identity on a user with a password, and no account kinds yet.
    world.editDataFile((db) => {
      db.prepare('UPDATE users SET oidc_issuer = ?, oidc_subject = ? WHERE id = ?').run(issuer, `acme-${user}`, who.id);
      db.exec(
        'DROP INDEX users_oidc_email_idx; ALTER TABLE users DROP COLUMN kind; ALTER TABLE users DROP COLUMN oidc_email;',
      );
      db.exec('DROP INDEX users_owner_idx; ALTER TABLE users DROP COLUMN owner;');
      db.exec(
        'DELETE FROM __drizzle_migrations WHERE created_at IN (SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 2)',
      );
    });
  },
);

When('the server starts on the new release', async (world: SynoikiaWorld) => {
  await world.startAgain();
  expect(world.startError).toBeUndefined();
});

Then(
  'user {int} signs in with Acme ID, and their old password no longer signs in',
  async (world: SynoikiaWorld, user: number) => {
    const who = world.person(`user ${user}`);
    await world.ssoSignInTo(await world.portalBrowser(), `user ${user}`);
    const old = await (
      await world.portalBrowser()
    ).post('/auth/login', { username: who.username, password: who.password });
    expect(old.status).toBe(401);
  },
);

Then(
  'the audit log says that the upgrade removed the password of user {int}, because the account signs in with Acme ID',
  async (world: SynoikiaWorld, user: number) => {
    const rows = await world.audit({ kind: 'auth' });
    expect(rows.filter((r) => r.decision === 'password_removed_sso_account')).toMatchObject([
      { detail: { username: world.person(`user ${user}`).username, migration: '0020_account_kinds' } },
    ]);
  },
);

// ── an upgrade to the primary owner (ADR-0025) ──

Given('the admin and then user 15 were local admins before the upgrade', async (world: SynoikiaWorld) => {
  const username = 'user15@acme.example';
  await world.expectOk(
    world.admin.post('/api/users', { username, password: `${username} world passphrase`, roleId: 'admin' }),
    'create the second admin',
  );
  await world.stopCore();
  // The data file of an earlier release: no primary owner yet.
  world.editDataFile((db) => {
    db.exec('DROP INDEX users_owner_idx; ALTER TABLE users DROP COLUMN owner;');
    db.exec('DELETE FROM __drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)');
  });
});

Then('the user list marks the admin as the primary owner', async (world: SynoikiaWorld) => {
  const list = (await world.expectOk(world.admin.get('/api/users'), 'list users')) as unknown as {
    username: string;
    owner: boolean;
  }[];
  expect(list.filter((u) => u.owner).map((u) => u.username)).toEqual([world.person('admin').username]);
});
