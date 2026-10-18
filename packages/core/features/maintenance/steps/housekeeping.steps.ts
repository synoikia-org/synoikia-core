import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';

const DAY = 24 * 60 * 60_000;

const userRows = async (world: SynoikiaWorld, username: string) =>
  (await world.audit({ decision: 'user_created' })).filter((r) => r.detail?.username === username);

When('the hourly clean-up runs {int} days later', async (world: SynoikiaWorld, days: number) => {
  world.passTime(days * DAY);
  // The clean-up runs at each start of core, and then each hour.
  await world.restartCore();
  await world.signInAgain();
});

Given('the admin keeps the audit log forever', async (world: SynoikiaWorld) => {
  await world.expectOk(world.admin.put('/api/settings/audit', { retentionDays: null }), 'keep the audit log');
});

When('the admin sets the retention of the audit log to {int} days', async (world: SynoikiaWorld, days: number) => {
  await world.expectRefused(world.admin.put('/api/settings/audit', { retentionDays: days }), 'set retention');
});

Then('the admin is told that the retention must be at least 7 days', async (world: SynoikiaWorld) => {
  expect(world.portalAnswer.status).toBe(400);
  expect(JSON.stringify(world.portalAnswer.body)).toMatch(/retentionDays.*>=7/);
  const settings = await world.expectOk(world.admin.get('/api/settings'), 'read settings');
  expect(settings.audit).toMatchObject({ retentionDays: 90 });
});

Then(
  'the audit log no longer shows that the admin made the user {string}',
  async (world: SynoikiaWorld, username: string) => {
    expect(await userRows(world, username)).toEqual([]);
  },
);

Then(
  'the audit log still shows that the admin made the user {string}',
  async (world: SynoikiaWorld, username: string) => {
    expect(await userRows(world, username)).toHaveLength(1);
  },
);

Then('the audit log shows that the clean-up removed old rows', async (world: SynoikiaWorld) => {
  const rows = await world.audit({ decision: 'audit_purged' });
  expect(rows).toHaveLength(1);
  expect(rows[0]!.detail).toMatchObject({ retentionDays: 90, rows: expect.any(Number) as number });
});
