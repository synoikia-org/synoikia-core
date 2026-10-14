import { flushPromises } from '@vue/test-utils';
import type { DOMWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, json, mountAt, signedIn } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const overview = { instances: [], plugins: [], warnings: [], publicMcpUrl: null };
const writes = (calls: { method: string }[]) => calls.filter((c) => c.method !== 'GET');

const plugin = (extra: Record<string, unknown> = {}) => ({
  id: 'p1',
  pluginId: 'acme',
  version: '1.0.0',
  repoId: null,
  sha256: null,
  signatureVerified: true,
  status: 'ok',
  statusError: null,
  enabled: true,
  instances: 2,
  manifest: { name: 'Acme' },
  ...extra,
});

async function click(root: Pick<DOMWrapper<Element>, 'findAll'>, label: string) {
  await root
    .findAll('button')
    .find((b) => b.text() === label)!
    .trigger('click');
  await flushPromises();
}

const dialog = (body: DOMWrapper<Element>) => body.get('[role="dialog"]');

describe('Plugins', () => {
  const pluginsApi = (extra: Record<string, unknown> = {}) =>
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/plugins': [plugin(), plugin({ id: 'p2', pluginId: 'nas', instances: 0, enabled: false })],
      'GET /api/plugin-repos/available': [],
      'GET /api/plugin-repos': [],
      ...extra,
    });

  it('disables a plugin with endpoints only after the dialog confirms it', async () => {
    const { calls } = pluginsApi({ 'PATCH /api/plugins/p1': {} });
    const { wrapper, body } = await mountAt('/plugins');
    expect(wrapper.text()).toContain('Installed (2)');
    await click(wrapper, 'Disable');
    expect(dialog(body).text()).toContain('Disabling acme stops its 2 endpoint(s).');
    await click(dialog(body), 'Cancel');
    expect(writes(calls)).toEqual([]);

    await click(wrapper, 'Disable');
    await click(dialog(body), 'Disable');
    expect(writes(calls)).toEqual([{ method: 'PATCH', path: '/api/plugins/p1', body: { enabled: false } }]);
    expect(calls.filter((c) => c.path === '/api/plugins' && c.method === 'GET')).toHaveLength(2);
  });

  it('describes connection-field hosts and keeps the raw manifest string visible', async () => {
    const manifest = {
      name: 'Acme',
      network: { hosts: ['{{connection.baseUrl}}', 'api.example.com'] },
      connection: { schema: { properties: { baseUrl: { type: 'string', title: 'Base URL' } } } },
    };
    pluginsApi({ 'GET /api/plugins': [plugin({ manifest })] });
    const { wrapper } = await mountAt('/plugins');
    const text = wrapper.text();
    expect(text).toContain("the host of each endpoint's Base URL ({{connection.baseUrl}})");
    expect(text).toContain('api.example.com');
    expect(wrapper.get('[data-raw-host]').text()).toBe('{{connection.baseUrl}}');
  });

  it('uninstalls only after the dialog confirms it, and says so', async () => {
    const { calls } = pluginsApi({ 'DELETE /api/plugins/p2': {} });
    const { wrapper, body } = await mountAt('/plugins');
    const uninstall = () =>
      wrapper
        .findAll('button')
        .filter((b) => b.text() === 'Uninstall')[1]!
        .trigger('click');
    await uninstall();
    await flushPromises();
    expect(dialog(body).text()).toContain('Uninstall nas?');
    expect(dialog(body).text()).toContain('Its files are deleted.');
    await click(dialog(body), 'Cancel');
    expect(writes(calls)).toEqual([]);

    await uninstall();
    await flushPromises();
    await click(dialog(body), 'Uninstall');
    expect(writes(calls)).toEqual([{ method: 'DELETE', path: '/api/plugins/p2', body: undefined }]);
    expect(wrapper.get('[role="status"]').text()).toBe('nas uninstalled.');
  });

  it('shows a failed action in the page alert', async () => {
    pluginsApi({ 'POST /api/plugins/rescan': json(500, { error: 'internal', message: 'Disk full' }) });
    const { wrapper } = await mountAt('/plugins');
    await click(wrapper, 'Rescan');
    expect(wrapper.get('[role="alert"]').text()).toBe('Disk full');
  });
});

describe('Clients & Tokens', () => {
  const token = {
    id: 't1',
    createdBy: 'u1',
    name: 'laptop',
    scope: ['*'],
    access: 'read',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
  };
  const clientsApi = (extra: Record<string, unknown> = {}) =>
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/tokens': [token],
      'GET /api/oauth/clients': [],
      'GET /api/oauth/grants': [],
      'GET /api/users': [signedIn.user],
      ...extra,
    });

  it('revokes a token only after the dialog confirms it', async () => {
    const { calls } = clientsApi({ 'DELETE /api/tokens/t1': {} });
    const { wrapper, body } = await mountAt('/clients');
    expect(wrapper.text()).toContain('laptop');
    await click(wrapper, 'Revoke');
    expect(dialog(body).text()).toContain('Revoke token “laptop”?');
    expect(dialog(body).text()).toContain('Clients using it lose access immediately.');
    await click(dialog(body), 'Cancel');
    expect(writes(calls)).toEqual([]);

    await click(wrapper, 'Revoke');
    await click(dialog(body), 'Revoke');
    expect(writes(calls)).toEqual([{ method: 'DELETE', path: '/api/tokens/t1', body: undefined }]);
    expect(calls.filter((c) => c.path === '/api/tokens' && c.method === 'GET')).toHaveLength(2);
  });

  it('shows no rows while one of the lists fails to load', async () => {
    clientsApi({ 'GET /api/users': json(500, { error: 'internal', message: 'Users unavailable' }) });
    const { wrapper } = await mountAt('/clients');
    expect(wrapper.get('[role="alert"]').text()).toBe('Users unavailable');
    expect(wrapper.text()).not.toContain('laptop');
    expect(wrapper.text()).toContain('No bearer tokens.');
  });

  it('shows the new token once, and a failed create in its dialog', async () => {
    let fail = true;
    clientsApi({
      'POST /api/tokens': () =>
        fail ? json(400, { error: 'invalid', message: 'Name taken' }) : { ...token, id: 't2', token: 'syn_secret' },
    });
    const { wrapper, body } = await mountAt('/clients');
    await click(wrapper, 'New token');
    await dialog(body).get('#t-name').setValue('desk');
    await dialog(body).get('input[type="checkbox"]').setValue(true);
    await click(dialog(body), 'Create token');
    expect(dialog(body).get('.alert.error').text()).toBe('Name taken');

    fail = false;
    await click(dialog(body), 'Create token');
    expect(dialog(body).text()).toContain('syn_secret');
  });
});

describe('New endpoint', () => {
  it('picks the only usable plugin, keeps the draft through a refetch, and opens the new endpoint', async () => {
    const created = { id: 'i9', slug: 'mine', displayName: 'Mine', plugin: { name: 'Acme' }, settings: {} };
    let instances: unknown[] = [];
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': () => ({ ...overview, instances }),
      'GET /api/plugins': [plugin()],
      'POST /api/instances': () => {
        instances = [created];
        return created;
      },
    });
    const { wrapper, router, queryClient } = await mountAt('/endpoints/new');
    expect(wrapper.get<HTMLSelectElement>('#n-plugin').element.value).toBe('acme');
    await wrapper.get('#n-slug').setValue('mine');
    await queryClient.invalidateQueries();
    await flushPromises();
    expect(calls.filter((c) => c.path === '/api/plugins')).toHaveLength(2);
    expect(wrapper.get<HTMLInputElement>('#n-slug').element.value).toBe('mine');

    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(writes(calls)[0]).toMatchObject({
      path: '/api/instances',
      body: { pluginId: 'acme', slug: 'mine', authMethods: null },
    });
    // In-session approval stays off unless the admin turns it on.
    expect(calls.find((c) => c.method === 'POST')?.body).not.toHaveProperty('settings');
    // The overview has the new endpoint before its page opens, so the page needs no second look.
    expect(calls.filter((c) => c.path === '/api/overview')).toHaveLength(3);
    expect(router.currentRoute.value.path).toBe('/endpoints/mine/connection');
  });

  it('sends in-session approval only when it is checked, with its warning', async () => {
    const created = { id: 'i9', slug: 'mine', displayName: 'Mine', plugin: { name: 'Acme' }, settings: {} };
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/plugins': [plugin()],
      'POST /api/instances': created,
    });
    const { wrapper } = await mountAt('/endpoints/new');
    await wrapper.get('#n-slug').setValue('mine');
    const box = wrapper
      .findAll('label')
      .find((l) => l.text().includes('in the agent session'))!
      .get<HTMLInputElement>('input');
    expect(box.element.checked).toBe(false);
    expect(wrapper.text()).not.toContain('could then approve those calls itself');
    await box.setValue(true);
    expect(wrapper.text()).toContain('could then approve those calls itself');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(writes(calls)[0]).toMatchObject({
      path: '/api/instances',
      body: { slug: 'mine', settings: { formElicitationApprovals: 'ask' } },
    });
  });
});

describe('Audit log', () => {
  it('shows the actor username with its id as a hint, else the id, else the kind', async () => {
    const at = '2026-01-01T00:00:00Z';
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/audit': {
        rows: [
          { id: 1, at, kind: 'call', decision: 'ok', actorKind: 'user', actorId: 'u-123', actorName: 'alice' },
          { id: 2, at, kind: 'call', decision: 'ok', actorKind: 'token', actorId: 't-456', actorName: null },
          { id: 3, at, kind: 'config', decision: null, actorKind: 'system', actorId: null, actorName: null },
          {
            id: 4,
            at,
            kind: 'call',
            decision: 'ok',
            actorKind: 'user',
            actorId: 'u-9',
            actorName: 'bob',
            actorDeleted: true,
          },
        ],
        total: 4,
      },
    });
    const { wrapper } = await mountAt('/audit');
    const actors = wrapper.findAll('tbody tr').map((r) => r.findAll('td').at(-1)!);
    expect(actors.map((c) => c.text())).toEqual(['alice', 't-456', 'system', 'bob (deleted)']);
    expect(actors[0]!.get('span').attributes('title')).toBe('u-123');
    expect(actors[1]!.find('[title]').exists()).toBe(false);
  });

  it('applies the filters on submit and pages through the results', async () => {
    const row = (id: number) => ({ id, at: '2026-01-01T00:00:00Z', kind: 'call', decision: 'ok', actorKind: 'user' });
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/audit': (_b: unknown, url: URL) => ({
        rows: Array.from({ length: url.searchParams.get('offset') === '0' ? 100 : 5 }, (_, i) => row(i)),
        total: 105,
      }),
    });
    const { wrapper } = await mountAt('/audit');
    const audits = () => calls.filter((c) => c.path.startsWith('/api/audit')).map((c) => c.path);
    expect(audits()).toEqual(['/api/audit?limit=100&offset=0']);

    await wrapper.get('#a-kind').setValue('call');
    await flushPromises();
    expect(audits()).toHaveLength(1);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(audits().slice(1)).toEqual([
      '/api/audit?kind=call&limit=100&offset=0',
      '/api/audit?kind=call&limit=100&offset=0',
    ]);

    await click(wrapper, 'Older');
    expect(audits().at(-1)).toBe('/api/audit?kind=call&limit=100&offset=100');
    expect(wrapper.get('.pager').text()).toContain('101–105 of 105');
  });
});
