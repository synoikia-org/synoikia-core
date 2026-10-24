import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicUser, RoleRow } from '../src/types';
import { adminRole, fakeApi, json, mountAt, signedIn } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const operators = { ...adminRole, id: 'r1', name: 'Operators', isAdmin: false };
const roles: RoleRow[] = [
  { ...adminRole, users: 1, endpoints: [], isDefault: false },
  {
    ...operators,
    users: 1,
    endpoints: [{ instanceId: 'i1', canSetOwnLevels: false, canManageOwnRules: false, canSeeStatus: false }],
    isDefault: true,
  },
];
const me: PublicUser = { ...signedIn.user, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null };
const olga: PublicUser = { ...me, id: 'u2', username: 'olga', owner: false, totpEnabled: true, role: operators };

const button = (text: string, root: ParentNode = document.body) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const dialogTitle = () => document.getElementById(dialog()?.getAttribute('aria-labelledby') ?? '')?.textContent;
const gets = (calls: { method: string; path: string }[], path: string) =>
  calls.filter((c) => c.method === 'GET' && c.path === path).length;

describe('the Users page', () => {
  it('shows why the list did not load', async () => {
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/users': json(500, { error: 'internal', message: 'Database is locked' }),
      'GET /api/roles': roles,
    });
    const { wrapper } = await mountAt('/settings/users');
    expect(wrapper.get('[role="alert"]').text()).toBe('Database is locked');
    expect(wrapper.findAll('tbody tr')).toHaveLength(0);
  });

  it('resets two-factor after confirmation and shows a failure on the page', async () => {
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/users': [me, olga],
      'GET /api/roles': roles,
      'POST /api/users/u2/reset-totp': json(409, { error: 'conflict', message: 'Two-factor is required' }),
    });
    const { wrapper } = await mountAt('/settings/users');
    button('Reset 2FA')!.click();
    await flushPromises();
    expect(dialogTitle()).toBe('Reset two-factor for olga?');
    button('Reset 2FA', dialog()!)!.click();
    await flushPromises();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/users/u2/reset-totp')).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toBe('Two-factor is required');
  });

  it('adds a user, then closes the dialog and reloads the list', async () => {
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/users': [me],
      'GET /api/roles': roles,
      'POST /api/users': (body: unknown) => json(201, { ...olga, ...(body as object) }),
    });
    const { body } = await mountAt('/settings/users');
    button('Add user')!.click();
    await flushPromises();
    await body.get('input#u-name').setValue('  olga ');
    await body.get('select#u-role').setValue('r1');
    button('Add')!.click();
    await flushPromises();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ username: 'olga', roleId: 'r1' });
    expect(dialog()).toBeNull();
    expect(gets(calls, '/api/users')).toBe(2);
  });

  it('offers only Enable and the role picker on an owner that an older release disabled and demoted', async () => {
    const helper = { ...signedIn.user, id: 'u3', username: 'helper', owner: false };
    fakeApi({
      'GET /api/session': { ...signedIn, user: helper },
      'GET /api/users': [{ ...me, disabled: true, role: operators }],
      'GET /api/roles': roles,
    });
    const { wrapper } = await mountAt('/settings/users');
    const row = wrapper.get('tbody tr');
    expect(row.findAll('button').map((b) => b.text())).toEqual(['Enable']);
    expect(row.get('select').attributes('disabled')).toBeUndefined();
  });

  it('keeps the delete dialog open with core’s refusal', async () => {
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/users': [me, olga],
      'GET /api/roles': roles,
      'DELETE /api/users/u2': json(409, { error: 'last_admin', message: 'You cannot delete the last enabled admin' }),
    });
    const { body } = await mountAt('/settings/users');
    button('Delete')!.click();
    await flushPromises();
    await body.get('input#d-confirm').setValue('olga');
    button('Delete', dialog()!)!.click();
    await flushPromises();
    expect(dialog()?.querySelector('.alert.error')?.textContent).toBe('You cannot delete the last enabled admin');
  });
});
