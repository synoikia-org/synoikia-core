import MiniSearch from 'minisearch';
import { reactive } from 'vue';
import { forRole, TOPICS } from '../help/topics';
import type { HelpTopic } from '../help/topics';

/** The one help drawer of the portal (@id:portal-help): which topic it shows, and who opened it. */
const state = reactive({ open: false, topic: '', section: undefined as string | undefined, query: '' });
let opener: HTMLElement | null = null;

export function openHelp(topic: string, section?: string) {
  if (!state.open) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  Object.assign(state, { open: true, topic, section, query: '' });
}

export function showTopic(topic: string, section?: string) {
  Object.assign(state, { topic, section, query: '' });
}

export function closeHelp() {
  state.open = false;
  if (opener?.isConnected) opener.focus();
  opener = null;
}

export function useHelp() {
  return state;
}

export function topicFor(id: string, isAdmin: boolean): HelpTopic | undefined {
  const topic = TOPICS[id];
  return topic && forRole(topic, isAdmin);
}

export interface HelpHit {
  topic: string;
  section?: string;
  heading: string;
  topicTitle: string;
}

const indexes = new Map<boolean, MiniSearch<HelpHit & { id: string; text: string }>>();

/** Every heading of the topics the role may read that matches `query`, best first. */
export function searchHelp(query: string, isAdmin: boolean): HelpHit[] {
  let index = indexes.get(isAdmin);
  if (!index) {
    index = new MiniSearch({
      fields: ['heading', 'text', 'topicTitle'],
      storeFields: ['topic', 'section', 'heading', 'topicTitle'],
      searchOptions: { boost: { heading: 3, topicTitle: 2 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
    });
    for (const id of Object.keys(TOPICS)) {
      const t = topicFor(id, isAdmin);
      if (!t) continue;
      index.add({ id, topic: id, heading: t.title, topicTitle: t.title, text: t.intro });
      for (const s of t.sections)
        index.add({
          id: `${id}#${s.id}`,
          topic: id,
          section: s.id,
          heading: s.heading,
          topicTitle: t.title,
          text: s.body,
        });
    }
    indexes.set(isAdmin, index);
  }
  return index
    .search(query)
    .slice(0, 8)
    .map((r) => ({
      topic: r.topic as string,
      section: r.section as string | undefined,
      heading: r.heading as string,
      topicTitle: r.topicTitle as string,
    }));
}
