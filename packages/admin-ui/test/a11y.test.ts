import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import ChipsInput from '../src/components/ChipsInput.vue';
import { announcement } from '../src/composables/useAnnounce';
import { fakeApi, mountAt, signedIn } from './helpers';

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
  upstreamVersion: null,
  lastSyncedAt: null,
  lastSyncStatus: 'ok',
  endpointUrl: 'https://mcp.example.com/nas',
  settings: {},
  plugin: { id: 'p1', pluginId: 'acme', name: 'Acme', enabled: true, status: 'ok', labels: {} },
};
const overview = { instances: [instance], plugins: [], warnings: [], publicMcpUrl: null };

const liveRegion = () => document.body.querySelector('[aria-live="polite"]')!;

async function mountShell(path: string) {
  fakeApi({ 'GET /api/session': signedIn, 'GET /api/overview': overview });
  return mountAt(path);
}

describe('App shell', () => {
  it('announces a copy through the shared live region', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => undefined) } });
    await mountShell('/');
    const copy = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Copy URL')!;
    copy.click();
    await flushPromises();
    expect(liveRegion().textContent).toBe('Copied');
    // Outside the app root, which an open dialog makes inert.
    expect(liveRegion().parentElement).toBe(document.body);
  });
});

describe('ChipsInput', () => {
  function mountChips(initial: string[]) {
    const values = ref(initial);
    const Host = defineComponent(() => () => [
      h('div', { 'aria-live': 'polite' }, announcement.value),
      h(ChipsInput, {
        modelValue: values.value,
        'onUpdate:modelValue': (v: string[]) => (values.value = v),
        inputId: 'chips-in',
        ariaLabelledby: 'chips-label',
      }),
    ]);
    const wrapper = mount(Host, { attachTo: document.body });
    return { wrapper, values };
  }
  const removeButton = (v: string) => document.body.querySelector<HTMLButtonElement>(`[aria-label="Remove ${v}"]`)!;

  it('lists the chips and labels the input as asked', async () => {
    mountChips(['a', 'b']);
    const list = document.body.querySelector('[role="list"]')!;
    expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    const input = document.getElementById('chips-in')!;
    expect(input.getAttribute('aria-labelledby')).toBe('chips-label');
  });

  it('moves focus to the next chip, then to the input, after a removal', async () => {
    const { values } = mountChips(['a', 'b']);
    removeButton('a').click();
    await flushPromises();
    expect(values.value).toEqual(['b']);
    expect(document.activeElement).toBe(removeButton('b'));

    removeButton('b').click();
    await flushPromises();
    expect(values.value).toEqual([]);
    expect(document.activeElement).toBe(document.getElementById('chips-in'));
    expect(document.body.querySelector('[role="list"]')).toBeNull();
  });
});
