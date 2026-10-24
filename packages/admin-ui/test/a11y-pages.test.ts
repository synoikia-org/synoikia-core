import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SchemaForm from '../src/components/SchemaForm.vue';
import { fakeApi, mountAt, signedIn } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

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
  endpointUrl: 'https://mcp.example.com/nas',
  settings: {},
  plugin: { id: 'p1', pluginId: 'acme', name: 'Acme', enabled: true, status: 'ok', labels: {} },
};
const overview = { instances: [instance], plugins: [], warnings: [], publicMcpUrl: null };

const byRole = (role: string, root: ParentNode = document.body) => [
  ...root.querySelectorAll<HTMLElement>(`[role="${role}"]`),
];
/** The text an `aria-labelledby` or `aria-describedby` list points at; every id must exist. */
const refText = (el: Element, attr: string) =>
  el
    .getAttribute(attr)!
    .split(' ')
    .map((id) => {
      const target = document.getElementById(id);
      expect(target, `#${id} for ${attr}`).not.toBeNull();
      return target!.textContent!.trim();
    })
    .join(' ');

describe('Tables', () => {
  it('say they are busy while loading, with a spoken Loading where nothing shows', async () => {
    const { fetchMock } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/roles': [],
      'GET /api/users': [signedIn.user, { ...signedIn.user, id: 'u2', username: 'olga', owner: false }],
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const real = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      if (input.startsWith('/api/users')) await held;
      return real(input, init);
    });
    await mountAt('/settings/users');
    const table = document.querySelector('table[aria-label="Users"]')!;
    expect(table.getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('.table-card [role="status"]')!.textContent).toBe('Loading…');

    release();
    await flushPromises();
    expect(table.getAttribute('aria-busy')).toBe('false');
    expect(document.querySelector('.table-card [role="status"]')).toBeNull();
    const reset = [...table.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Set password')!;
    expect(refText(reset, 'aria-describedby')).toContain('olga');
  });
});

/** The accessible name of a control from aria-labelledby, aria-label or its `<label for>`. */
function nameOf(el: Element) {
  if (el.hasAttribute('aria-labelledby')) {
    return el
      .getAttribute('aria-labelledby')!
      .split(' ')
      .map((id) => {
        const target = document.getElementById(id)!;
        expect(target, `#${id}`).not.toBeNull();
        return target === el ? el.getAttribute('aria-label') : target.textContent!.trim();
      })
      .join(' ');
  }
  if (el.hasAttribute('aria-label')) return el.getAttribute('aria-label');
  return el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() : undefined;
}

describe('Form labels and hints', () => {
  it('ties SchemaForm help to its control and labels secret and multi-choice groups', () => {
    mount(SchemaForm, {
      attachTo: document.body,
      props: {
        schema: {
          type: 'object',
          properties: {
            url: { type: 'string', title: 'URL', description: 'Where the service runs.' },
            apiKey: { type: 'string', writeOnly: true, title: 'API key' },
            kinds: { type: 'array', title: 'Kinds', items: { enum: ['a', 'b'] } },
          },
        },
        ui: {},
        config: {},
        secrets: { apiKey: { set: true } },
        secretPatch: {},
      },
    });
    const url = document.querySelector('#f-url')!;
    expect(nameOf(url)).toBe('URL');
    expect(refText(url, 'aria-describedby')).toBe('Where the service runs.');
    const groups = byRole('group').map((g) => refText(g, 'aria-labelledby'));
    expect(groups).toEqual(['API key', 'Kinds']);
  });
});
