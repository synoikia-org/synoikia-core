import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, mountAt, signedIn } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const role = () => ({ id: 'r1', name: 'Operators', isAdmin: false, canSeeOtherEndpoints: false });
const asUser = () => ({
  ...signedIn,
  user: { ...signedIn.user, id: 'u2', username: 'olga', role: role() },
});

type Switches = Partial<Record<'canSetOwnLevels' | 'canManageOwnRules' | 'canSeeStatus', boolean>>;
const endpoint = (id: string, slug: string, switches: Switches = {}) => ({
  id,
  slug,
  displayName: 'Acme',
  endpointUrl: `https://mcp.example/${slug}`,
  authMode: 'bearer',
  canSetOwnLevels: false,
  canManageOwnRules: false,
  canSeeStatus: false,
  ...switches,
});
const mine = { assigned: [endpoint('i1', 'nas')], unassigned: [] };
const other = { id: 'i9', slug: 'lab', displayName: 'Lab', plugin: 'Acme', description: 'Runs the lab.' };
const view = {
  groups: [{ key: 'app', label: 'Apps', endpointLevel: 'ask', roleLevel: 'ask', ownLevel: null }],
  operations: [
    {
      id: 'op1',
      key: 'app.start',
      displayName: null,
      description: null,
      group: 'app',
      classification: 'write',
      matchProfile: null,
      allowedLevels: ['none', 'ask', 'write'],
      endpointLevel: 'ask',
      roleLevel: null,
      roleMax: 'ask',
      ownLevel: null,
      level: 'ask',
      reachable: true,
      mode: 'approve',
      reason: null,
    },
  ],
};

describe('a non-admin user', () => {
  it('lands on My endpoints, with only their endpoints and profile in the menu', async () => {
    fakeApi({ 'GET /api/session': asUser(), 'GET /api/me/endpoints': mine });
    const { wrapper, router } = await mountAt('/');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/my');
    const nav = wrapper.get('nav').text();
    expect(nav).toContain('/nas');
    expect(nav).toContain('My profile');
    expect(nav).not.toContain('Plugins');
    expect(nav).not.toContain('Settings');
    expect(wrapper.text()).toContain('https://mcp.example/nas');
    // Admin pages send them back.
    await router.push('/settings/users');
    expect(router.currentRoute.value.path).toBe('/my');
  });

  it('sees unassigned endpoints only when there are some, and opens their about page', async () => {
    fakeApi({ 'GET /api/session': asUser(), 'GET /api/me/endpoints': mine });
    const first = await mountAt('/my');
    await flushPromises();
    expect(first.wrapper.text()).toContain('Assigned endpoints');
    expect(first.wrapper.text()).not.toContain('Unassigned endpoints');
    first.wrapper.unmount();

    fakeApi({
      'GET /api/session': asUser(),
      'GET /api/me/endpoints': { ...mine, unassigned: [other] },
      'GET /api/me/endpoints/i9/about': { ...other, role: 'Operators' },
    });
    const { wrapper, router } = await mountAt('/my');
    await flushPromises();
    const tables = wrapper.findAll('table');
    expect(tables).toHaveLength(2);
    expect(tables[0]!.text()).toContain('/nas');
    expect(tables[1]!.text()).toContain('/lab');
    expect(tables[1]!.text()).not.toContain('https://');
    await tables[1]!.get('a').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/my/i9/about');
    const text = wrapper.text();
    expect(text).toContain('/lab');
    expect(text).toContain('Runs the lab.');
    expect(text).toContain('Operators');
    expect(text).toContain("You don't have access to this endpoint. Contact an administrator if you need it.");
  });

  it('shows operations their role keeps at None as Off, with no level to pick', async () => {
    const off = {
      ...view.operations[0]!,
      id: 'op2',
      key: 'app.delete',
      roleMax: 'none',
      level: 'none',
      reachable: false,
      mode: null,
      reason: 'level_none',
    };
    fakeApi({
      'GET /api/session': asUser(),
      'GET /api/me/endpoints': {
        assigned: [endpoint('i1', 'nas', { canSetOwnLevels: true, canSeeStatus: true })],
        unassigned: [],
      },
      'GET /api/me/endpoints/i1/access': {
        groups: [
          ...view.groups,
          { key: 'sys', label: 'System', endpointLevel: 'ask', roleLevel: null, ownLevel: null },
        ],
        operations: [view.operations[0], off, { ...off, id: 'op3', key: 'sys.reboot', group: 'sys' }],
      },
    });
    const { wrapper } = await mountAt('/my/i1');
    await flushPromises();
    expect(wrapper.find('[aria-label="Access for Apps"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Access for System"]').exists()).toBe(false);
    await wrapper.get('[aria-label="Expand Apps"]').trigger('click');
    expect(wrapper.find('[aria-label="Level of app.start"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Level of app.delete"]').exists()).toBe(false);
    expect(wrapper.get('[data-op="app.delete"]').text()).toContain('Off');
  });

  it('sees levels read-only without the own-levels switch', async () => {
    fakeApi({ 'GET /api/session': asUser(), 'GET /api/me/endpoints': mine, 'GET /api/me/endpoints/i1/access': view });
    const { wrapper } = await mountAt('/my/i1');
    await flushPromises();
    expect(wrapper.text()).toContain('Apps');
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('My pre-approval rules');
  });

  it('sets their own level, capped by the role maximum', async () => {
    const { calls } = fakeApi({
      'GET /api/session': asUser(),
      'GET /api/me/endpoints': {
        assigned: [endpoint('i1', 'nas', { canSetOwnLevels: true, canManageOwnRules: true })],
        unassigned: [],
      },
      'GET /api/me/endpoints/i1/access': view,
      'PUT /api/me/endpoints/i1/groups/app': view,
    });
    const { wrapper } = await mountAt('/my/i1');
    await flushPromises();
    expect(wrapper.text()).toContain('My pre-approval rules');
    expect(wrapper.find('select.bulk').exists()).toBe(false);
    const control = wrapper.get('[aria-label="Access for Apps"]');
    const button = (label: string) => control.findAll('button').find((b) => b.text() === label)!;
    expect(button('Write').attributes('disabled')).toBeDefined();
    await button('Read').trigger('click');
    await flushPromises();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/api/me/endpoints/i1/groups/app',
      body: { level: 'read' },
    });
  });

  it('gets the rules tab and own levels only on endpoints whose switches allow them', async () => {
    fakeApi({
      'GET /api/session': asUser(),
      'GET /api/me/endpoints': {
        assigned: [endpoint('i1', 'nas'), endpoint('i2', 'lab', { canManageOwnRules: true })],
        unassigned: [],
      },
      'GET /api/me/endpoints/i1/access': view,
      'GET /api/me/endpoints/i2/access': view,
      'GET /api/me/endpoints/i2/rules': [],
    });
    const { wrapper, router } = await mountAt('/my/i1');
    await flushPromises();
    expect(wrapper.text()).not.toContain('My pre-approval rules');
    await router.push('/my/i2');
    await flushPromises();
    expect(wrapper.text()).toContain('My pre-approval rules');
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
  });
});

describe('roles for admins', () => {
  const instance = {
    id: 'i1',
    slug: 'nas',
    displayName: 'Acme',
    enabled: true,
    authMode: null,
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
      'GET /api/instances/i1/groups': [],
      'GET /api/instances/i1/operations': [],
      'GET /api/roles/r1/endpoints/i1/access': view,
      ...routes,
    });

  it('offers the role selector on the Access page and edits a role’s maximums', async () => {
    const { calls } = roleApi({ 'PUT /api/roles/r1/endpoints/i1/groups/app': view });
    const { wrapper } = await mountAt('/endpoints/nas/access?role=r1');
    await flushPromises();
    expect(wrapper.get('select#access-role').text()).toContain('Operators');
    await wrapper
      .get('[aria-label="Access for Apps"]')
      .findAll('button')
      .find((b) => b.text() === 'None')!
      .trigger('click');
    await flushPromises();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/api/roles/r1/endpoints/i1/groups/app',
      body: { level: 'none' },
    });
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

  it('flips one switch on one endpoint of a role, and keeps the endpoint list', async () => {
    const { calls } = roleApi({
      'PATCH /api/roles/r1/endpoints/i1': { canSetOwnLevels: false, canManageOwnRules: true, canSeeStatus: false },
    });
    const { wrapper } = await mountAt('/settings/roles');
    await flushPromises();
    const group = wrapper.get('[role="group"][aria-label="Operators: switches on /nas"]');
    expect(group.text()).toContain('Set personal levels');
    expect(group.text()).toContain('See endpoint status');
    expect(wrapper.get('[data-role="Operators"]').text()).toContain(
      'Users see the other endpoints by name and description, without access.',
    );
    await group
      .findAll('label')
      .find((l) => l.text() === 'Own pre-approval rules')!
      .get('input')
      .setValue(true);
    await flushPromises();
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      path: '/api/roles/r1/endpoints/i1',
      body: { canManageOwnRules: true },
    });
    expect(wrapper.get('[data-role="Operators"]').find('a[href="/endpoints/nas/access?role=r1"]').exists()).toBe(true);
  });

  it('shows a failed switch change as an alert', async () => {
    roleApi({
      'PATCH /api/roles/r1/endpoints/i1': new Response(
        JSON.stringify({ error: 'not_in_role', message: 'Add the endpoint to the role first' }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    });
    const { wrapper } = await mountAt('/settings/roles');
    await flushPromises();
    await wrapper.get('[aria-label="Operators: switches on /nas"]').findAll('input')[0]!.setValue(true);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Add the endpoint to the role first');
  });

  it('removes an endpoint from a role', async () => {
    const { calls } = roleApi({ 'PUT /api/roles/r1/instances': { instanceIds: [] } });
    const { wrapper } = await mountAt('/settings/roles');
    await flushPromises();
    await wrapper
      .get('[data-role="Operators"] [data-endpoint="nas"]')
      .findAll('label')
      .find((l) => l.text() === '/nas')!
      .get('input')
      .setValue(false);
    await flushPromises();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/api/roles/r1/instances',
      body: { instanceIds: [] },
    });
  });

  it('sets every group of a role through the role’s bulk route', async () => {
    const { calls } = roleApi({ 'POST /api/roles/r1/endpoints/i1/bulk-level': view });
    const { wrapper, body } = await mountAt('/endpoints/nas/access?role=r1');
    await flushPromises();
    await wrapper.get('select.bulk').setValue('read');
    await flushPromises();
    await body
      .get('[role="dialog"]')
      .findAll('button')
      .find((b) => b.text() === 'Set all groups')!
      .trigger('click');
    await flushPromises();
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/api/roles/r1/endpoints/i1/bulk-level',
      body: { level: 'read' },
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

describe('own pre-approval rules', () => {
  it('fill the editor’s pickers from the user’s own endpoint routes', async () => {
    const own = {
      ...view,
      operations: [{ ...view.operations[0]!, matchProfile: 'vol' }],
    };
    const { calls } = fakeApi({
      'GET /api/session': asUser(),
      'GET /api/me/endpoints': { assigned: [endpoint('i1', 'nas', { canManageOwnRules: true })], unassigned: [] },
      'GET /api/me/endpoints/i1/access': own,
      'GET /api/me/endpoints/i1/rules': [],
      'GET /api/me/endpoints/i1/rule-form': {
        matchProfiles: {
          vol: [
            { field: '/name', label: 'Name', op: 'in', widget: 'select', optionsSource: 'names' },
            { field: '$targets', label: 'Volumes', widget: 'registry-picker' },
          ],
        },
        targets: { label: 'Volume', registryKind: 'volume', scopes: [] },
      },
      'GET /api/me/endpoints/i1/options/names': [{ value: 'a', label: 'A' }],
      'GET /api/me/endpoints/i1/registry': [{ kind: 'volume', id: 'vol/a', name: 'A', parentId: null, scopes: null }],
    });
    const { wrapper, body } = await mountAt('/my/i1');
    await flushPromises();
    await wrapper
      .findAll('a')
      .find((a) => a.text() === 'My pre-approval rules')!
      .trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'New rule')!
      .trigger('click');
    await flushPromises();
    await body.get('select#r-op').setValue('op1');
    await flushPromises();
    const paths = calls.map((c) => c.path);
    expect(paths.some((p) => p.startsWith('/api/me/endpoints/i1/registry?'))).toBe(true);
    expect(paths).toContain('/api/me/endpoints/i1/options/names');
    expect(paths.some((p) => p.startsWith('/api/instances') || p === '/api/plugins')).toBe(false);
  });
});
