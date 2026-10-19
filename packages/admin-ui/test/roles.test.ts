import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, mountAt, signedIn } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const role = () => ({ id: 'r1', name: 'Operators', isAdmin: false, canSeeOtherEndpoints: false });
describe('roles for admins', () => {
  const instance = {
    id: 'i1',
    slug: 'nas',
    displayName: 'Acme',
    enabled: true,
    authMethods: null,
    status: 'ready',
    statusError: null,
    upstreamVersion: null,
    lastSyncedAt: null,
    lastSyncStatus: 'ok',
    settings: {},
    plugin: { id: 'p1', pluginId: 'acme', name: 'Acme', enabled: true, status: 'ok' },
  };
  const roleApi = (routes: Record<string, unknown>) =>
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': { instances: [instance], plugins: [], warnings: [], publicMcpUrl: null },
      'GET /api/roles': [
        {
          ...role(),
          id: 'admin',
          name: 'Admin',
          isAdmin: true,
          users: 1,
          endpoints: [],
          isDefault: false,
        },
        {
          ...role(),
          users: 2,
          endpoints: [{ instanceId: 'i1', canSetOwnLevels: false, canManageOwnRules: false, canSeeStatus: false }],
          isDefault: false,
        },
      ],
      ...routes,
    });

  it('flips the role-wide “See other endpoints” switch', async () => {
    const { calls } = roleApi({ 'PATCH /api/roles/r1': role() });
    const { wrapper } = await mountAt('/settings/roles');
    await flushPromises();
    const box = wrapper
      .get('[data-role="Operators"]')
      .findAll('label')
      .find((l) => l.text() === 'See other endpoints')!
      .get('input');
    await box.setValue(true);
    await flushPromises();
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      path: '/api/roles/r1',
      body: { canSeeOtherEndpoints: true },
    });
  });
});

describe('sign-up', () => {
  it('shows “Create account” only while self-registration is open', async () => {
    const signedOut = {
      authenticated: false,
      setupRequired: false,
      localLoginEnabled: true,
      oidc: { enabled: false, label: 'SSO' },
    };
    fakeApi({ 'GET /api/session': signedOut });
    let { wrapper } = await mountAt('/login');
    expect(wrapper.text()).not.toContain('Create account');
    wrapper.unmount();
    const { calls } = fakeApi({
      'GET /api/session': { ...signedOut, signupOpen: true },
      'POST /auth/register': { status: 'ok' },
    });
    ({ wrapper } = await mountAt('/login'));
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Create account')!
      .trigger('click');
    await wrapper.get('input#username').setValue('newbie');
    await wrapper.get('input#password').setValue('correct horse battery');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(calls.find((c) => c.path === '/auth/register')?.body).toEqual({
      username: 'newbie',
      password: 'correct horse battery',
    });
  });
});
