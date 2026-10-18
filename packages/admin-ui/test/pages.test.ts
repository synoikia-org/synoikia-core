import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SchemaForm from '../src/components/SchemaForm.vue';
import { fakeApi, mcpSettings, mountAt, signedIn } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const instance = {
  id: 'i1',
  slug: 'nas',
  displayName: 'Acme',
  enabled: true,
  authMethods: null,
  status: 'ready',
  statusError: null,
  upstreamVersion: '25.10.7',
  lastSyncedAt: null,
  lastSyncStatus: 'ok',
  settings: {},
  plugin: {
    id: 'p1',
    pluginId: 'acme',
    name: 'Acme',
    enabled: true,
    status: 'ok',
    labels: { operation: 'Method', operations: 'Methods' },
  },
};
const overview = { instances: [instance], plugins: [], warnings: [], publicMcpUrl: null };

describe('SchemaForm', () => {
  const schema = {
    type: 'object',
    properties: {
      url: { type: 'string', format: 'uri', title: 'URL' },
      authMethod: { type: 'string', enum: ['api_key', 'password'], default: 'api_key' },
      apiKey: { type: 'string', writeOnly: true },
      username: { type: 'string' },
      verifyTls: { type: 'boolean', default: true },
    },
    required: ['url'],
  };
  const ui = {
    apiKey: { widget: 'secret', showWhen: { field: 'authMethod', in: ['api_key'] } },
    username: { showWhen: { field: 'authMethod', in: ['password'] } },
  };

  it('shows fields per showWhen and never renders stored secrets', async () => {
    const wrapper = mount(SchemaForm, {
      props: {
        schema,
        ui,
        config: { url: 'https://nas' },
        secrets: { apiKey: { set: true, hint: '…ab12' } },
        secretPatch: {},
      },
    });
    expect(wrapper.find('[data-field="apiKey"]').exists()).toBe(true);
    expect(wrapper.find('[data-field="username"]').exists()).toBe(false);
    expect(wrapper.get('[data-field="apiKey"]').text()).toContain('Set · …ab12');
    expect(wrapper.find('[data-field="apiKey"] input').exists()).toBe(false);

    await wrapper.setProps({ config: { url: 'https://nas', authMethod: 'password' } });
    expect(wrapper.find('[data-field="apiKey"]').exists()).toBe(false);
    expect(wrapper.find('[data-field="username"]').exists()).toBe(true);
  });
});

describe('Accepted client auth of an endpoint', () => {
  const settings = {
    approvalTimeoutMs: 900_000,
    formElicitationApprovals: 'off',
    executePerMinute: 30,
    writesPerMinute: 10,
    sandbox: { timeoutMs: 10_000, memoryMb: 64, maxResultBytes: 65_536 },
    extraRedactKeys: [],
    syncMaxAgeMs: 3_600_000,
    memoryMb: 256,
  };
  const picker = (body: Awaited<ReturnType<typeof mountAt>>['body']) => {
    const set = body.get('fieldset.methods');
    const option = (label: string) =>
      set
        .findAll<HTMLInputElement>('label')
        .find((l) => l.text().startsWith(label))!
        .get<HTMLInputElement>('input');
    return { set, option };
  };
  it('keeps "Only these" disabled until the global settings load', async () => {
    const { fetchMock } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': { ...overview, instances: [{ ...instance, authMethods: null, settings }] },
    });
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) =>
      String(input).startsWith('/api/settings') ? new Promise<Response>(() => {}) : respond(input, init),
    );
    const { body } = await mountAt('/endpoints/nas/settings');
    const { set, option } = picker(body);
    expect(option('Only these').element.disabled).toBe(true);
    expect(set.findAll('input[type="checkbox"]')).toHaveLength(0);
  });
});

describe('Client auth in endpoint lists', () => {
  it('lists the accepted methods on the overview and flags an endpoint that refuses calls', async () => {
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': {
        ...overview,
        instances: [
          { ...instance, effectiveAuthMethods: ['bearer', 'oauth'] },
          { ...instance, id: 'i2', slug: 'off', effectiveAuthMethods: [] },
        ],
      },
    });
    const { wrapper } = await mountAt('/');
    const rows = wrapper.findAll('tbody tr');
    expect(rows[0]!.text()).toContain('Bearer tokens, OAuth');
    expect(rows[1]!.get('.pill.danger').text()).toBe('No client auth — refuses calls');
  });
});

describe('Connect a client', () => {
  function api(auth: string[], opts: { dcr?: boolean; publicMcpUrl?: string | null } = {}) {
    const pub = opts.publicMcpUrl === undefined ? 'https://mcp.example.com' : opts.publicMcpUrl;
    const inst = { ...instance, endpointUrl: `${pub ?? ''}/nas`, effectiveAuthMethods: auth };
    return fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': { ...overview, instances: [inst], publicMcpUrl: pub },
      'GET /api/instances/i1/connection': {
        config: {},
        schema: { type: 'object', properties: {} },
        secrets: {},
        help: 'Notes.',
      },
      'GET /api/settings': { mcp: { allowDynamicRegistration: opts.dcr ?? true } },
    });
  }
  const card = async () => {
    const { wrapper } = await mountAt('/endpoints/nas/connection');
    return { wrapper, card: wrapper.get('.connect') };
  };

  afterEach(() => localStorage.clear());

  it('points an External endpoint’s Cloudflare portal setup at Cloudflare Access, without OAuth warnings', async () => {
    api(['external'], { dcr: false });
    const { card: c } = await card();
    await c.get('select').setValue('cloudflare');
    expect(c.findAll('.alert')).toHaveLength(0);
    expect(c.find('[data-note="cf-access"]').text()).toContain('Managed OAuth');
    expect(c.text()).toContain('Sign in with Cloudflare Access');
  });

  it('shows a placeholder host, never the portal’s own address, when PUBLIC_MCP_URL is unset', async () => {
    api(['oauth'], { publicMcpUrl: null });
    const { card: c } = await card();
    expect(c.get('[data-snippet="url"]').text()).toBe('https://<your-mcp-host>/nas');
    expect(c.find('[data-warn="public-url"]').exists()).toBe(true);
    expect(c.get('[data-snippet="command"]').text()).toContain('https://<your-mcp-host>/nas');
  });
});

describe('Shell and settings', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('names the six settings tabs in order, and explains MCP access', async () => {
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/settings': { mcp: mcpSettings, publicMcpUrl: 'https://mcp.example.com' },
    });
    const { wrapper } = await mountAt('/settings/client-auth');
    const tabs = wrapper.findAll('.tabs a');
    expect(tabs.map((t) => t.text())).toEqual([
      'Client auth',
      'User auth',
      'Users',
      'Roles',
      'Notifications',
      'Server settings',
    ]);
    expect(tabs.map((t) => t.attributes('href'))).toEqual([
      '/settings/client-auth',
      '/settings/user-auth',
      '/settings/users',
      '/settings/roles',
      '/settings/notifications',
      '/settings/server',
    ]);
    expect(wrapper.get('.tabs').text()).not.toContain('Admin UI settings');
    expect(wrapper.get('.tabs').text()).not.toContain('My profile');
    expect(document.title).toBe('Client auth · Synoikia');
    const about = wrapper.get('.card.about');
    expect(about.text()).toContain('https://mcp.example.com/<slug>');
    expect(about.text()).toContain('search');
    expect(about.text()).toContain('execute');
    expect(about.text()).toContain('accepts all the methods enabled below');
  });

  it('explains OAuth, and Cloudflare Access setup once External is on, with no other reverse proxies', async () => {
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/settings': {
        mcp: { ...mcpSettings, clientAuth: { bearer: false, oauth: true, external: true } },
        publicMcpUrl: null,
      },
    });
    const { wrapper } = await mountAt('/settings/client-auth');
    const headings = wrapper.findAll('section.card h2').map((h) => h.text());
    expect(headings).toEqual(['How MCP access works', 'Client auth methods', 'Clients', 'OAuth', 'Cloudflare Access']);
    expect(wrapper.text()).not.toContain('Other reverse proxies');
    expect(wrapper.text()).not.toContain('Trusted identity header');
    const oauthCard = wrapper.findAll('section.card').find((s) => s.get('h2').text() === 'OAuth')!;
    expect(oauthCard.find('[data-explain="oauth"]').text()).toContain('no provider, client ID or secret');
    expect(oauthCard.find('[data-warn="oauth-public-url"]').exists()).toBe(true);
    const steps = wrapper.get('[data-explain="cf-access"]').text();
    expect(steps).toContain('Managed OAuth');
    expect(steps).toContain('https://claude.ai/api/mcp/auth_callback');
    expect(steps).toContain('https://<portal-hostname>/servers-callback');
    expect(steps).toContain('Optional');
    expect(steps).not.toContain('Service Auth');
    expect(steps).toContain('Every endpoint then accepts External');
  });
});

describe('Endpoint pages on the query cache', () => {
  it('fetches the overview again for a slug it does not know before saying there is none', async () => {
    let instances: unknown[] = [];
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': () => ({ ...overview, instances }),
    });
    const { wrapper, router } = await mountAt('/');
    instances = [instance];
    await router.push('/endpoints/nas/access');
    await flushPromises();
    expect(calls.filter((c) => c.path === '/api/overview')).toHaveLength(2);
    expect(wrapper.get('h1').text()).toContain('/nas');

    await router.push('/endpoints/gone/access');
    await flushPromises();
    expect(calls.filter((c) => c.path === '/api/overview')).toHaveLength(3);
    expect(wrapper.text()).toContain('No endpoint at /gone.');
  });
});
