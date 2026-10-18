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

  const manual = { fileName: '<b>acme</b>.tgz', uploadedAt: '2026-01-01T00:00:00Z', releasedVersion: '1.0.0' };
  const manualPlugin = plugin({
    repoId: 'r1',
    sha256: 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12',
    signatureVerified: false,
    manual,
  });
  const repo = (signingMode: 'signed' | 'unsigned') => ({
    id: 'r1',
    url: 'https://example.com/index.json',
    name: 'Main',
    signingMode,
    keyStatus: 'ok',
    pluginCount: 1,
  });

  it('installs from an unsigned repository after its warning, without a typed id', async () => {
    const { calls } = pluginsApi({
      'GET /api/plugins': [],
      'GET /api/plugin-repos': [repo('unsigned')],
      'GET /api/plugin-repos/available': [
        {
          repoId: 'r1',
          repoName: 'Main',
          signingMode: 'unsigned',
          pluginId: 'acme',
          name: 'Acme',
          description: null,
          versions: [{ version: '1.0.0', compatible: true }],
          latest: '1.0.0',
          installed: null,
          updateAvailable: false,
          blocked: null,
        },
      ],
      'POST /api/plugins/install': plugin({ enabled: false }),
    });
    const { wrapper, body } = await mountAt('/plugins');
    await click(wrapper, 'Available (1)');
    await click(wrapper, 'Install…');
    expect(dialog(body).text()).toContain('This repository is unsigned');
    expect(dialog(body).find('input').exists()).toBe(false);
    await click(dialog(body), 'Install');
    expect(writes(calls)).toEqual([
      { method: 'POST', path: '/api/plugins/install', body: { repoId: 'r1', pluginId: 'acme', version: '1.0.0' } },
    ]);
  });

  it('offers a manual plugin no revert without a released version, and reads repository installs as revert/update', async () => {
    pluginsApi({
      'GET /api/plugins': [{ ...manualPlugin, manual: { ...manual, releasedVersion: null } }],
      'GET /api/plugin-repos': [repo('signed')],
      'GET /api/plugin-repos/available': [
        {
          repoId: 'r1',
          repoName: 'Main',
          signingMode: 'signed',
          pluginId: 'acme',
          name: 'Acme',
          description: null,
          versions: [{ version: '1.0.0', compatible: true }],
          latest: '1.0.0',
          installed: { version: '1.1.0-dev', fromThisRepo: true, managed: true, manual: true },
          updateAvailable: false,
          blocked: null,
        },
      ],
    });
    const { wrapper } = await mountAt('/plugins');
    expect(wrapper.findAll('button').some((b) => b.text().startsWith('Revert'))).toBe(false);
    await click(wrapper, 'Available (1)');
    expect(wrapper.findAll('button').some((b) => b.text() === 'Revert / update to 1.0.0…')).toBe(true);
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

  it('shows no rows while one of the lists fails to load', async () => {
    clientsApi({ 'GET /api/users': json(500, { error: 'internal', message: 'Users unavailable' }) });
    const { wrapper } = await mountAt('/clients');
    expect(wrapper.get('[role="alert"]').text()).toBe('Users unavailable');
    expect(wrapper.text()).not.toContain('laptop');
    expect(wrapper.text()).toContain('No bearer tokens.');
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
});
