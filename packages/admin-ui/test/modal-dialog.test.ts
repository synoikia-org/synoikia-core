import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import InfoTip from '../src/components/InfoTip.vue';
import ModalDialog from '../src/components/ModalDialog.vue';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const button = (text: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const press = (target: Element, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

/** A page with an "Open" trigger and a dialog holding a name field, an InfoTip and two buttons. */
function mountPage() {
  const root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  const Page = defineComponent(() => {
    const open = ref(false);
    return () => [
      h('button', { type: 'button', onClick: () => (open.value = true) }, 'Open'),
      open.value &&
        h(
          ModalDialog,
          { title: 'Edit thing', onClose: () => (open.value = false) },
          {
            default: () => [
              h('input', { id: 'name' }),
              h(InfoTip, { text: 'Explains the field.', label: 'About the field' }),
            ],
            footer: () => [h('button', { type: 'button' }, 'Cancel'), h('button', { type: 'button' }, 'Save')],
          },
        ),
    ];
  });
  return mount(Page, { attachTo: root });
}

async function openDialog() {
  const wrapper = mountPage();
  const trigger = button('Open')!;
  trigger.focus();
  trigger.click();
  await flushPromises();
  return { wrapper, trigger };
}

describe('ModalDialog', () => {
  it('closes on Escape, but not on an Escape an inner control already handled', async () => {
    await openDialog();
    const name = document.getElementById('name')!;
    name.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
    press(name, 'Escape');
    await flushPromises();
    expect(dialog()).not.toBeNull();

    press(name, 'Escape');
    await flushPromises();
    expect(dialog()).toBeNull();
  });

  it('lets Escape hide a hovered InfoTip first, then close the dialog', async () => {
    await openDialog();
    const name = document.getElementById('name')!;
    const tip = document.body.querySelector<HTMLButtonElement>('[aria-label="About the field"]')!;
    const infotip = tip.closest('.infotip')!;
    expect(tip.hasAttribute('aria-expanded')).toBe(false);
    infotip.dispatchEvent(new MouseEvent('mouseenter'));
    await flushPromises();

    expect(press(name, 'Escape').defaultPrevented).toBe(true);
    await flushPromises();
    expect(infotip.classList.contains('dismissed')).toBe(true);
    expect(dialog()).not.toBeNull();

    press(name, 'Escape');
    await flushPromises();
    expect(dialog()).toBeNull();
  });
});
