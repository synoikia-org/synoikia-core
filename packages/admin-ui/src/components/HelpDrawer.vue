<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, useId, useTemplateRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { closeHelp, searchHelp, showTopic, topicFor, useHelp } from '../composables/useHelp';
import { useOverviewQuery } from '../composables/useOverview';
import { EDIT_URL } from '../help/topics';
import { useSessionStore } from '../stores/session';
import MarkdownLite from './MarkdownLite';

const help = useHelp();
const route = useRoute();
const session = useSessionStore();
const isAdmin = session.isAdmin;
// The version is admin data (ADR-0010), so the other roles see none.
const { data: overview } = useOverviewQuery(isAdmin);
const titleId = useId();
const panel = useTemplateRef<HTMLElement>('panel');
const title = useTemplateRef<HTMLElement>('title');

const pageTopic = computed(() => route.meta.help ?? '');
const topic = computed(() => topicFor(help.topic, isAdmin));
const hits = computed(() => (help.query.trim() ? searchHelp(help.query.trim(), isAdmin) : []));
const related = computed(() =>
  (topic.value?.related ?? []).flatMap((id) => {
    const t = topicFor(id, isAdmin);
    return t ? [{ id, title: t.title }] : [];
  }),
);
const back = computed(() =>
  help.topic !== pageTopic.value || help.query ? topicFor(pageTopic.value, isAdmin) : undefined,
);

async function land() {
  await nextTick();
  const target = help.section && panel.value?.querySelector<HTMLElement>(`#${titleId}-${help.section}`);
  if (target) {
    target.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
  } else {
    panel.value?.querySelector('.d-body')?.scrollTo({ top: 0 });
    title.value?.focus();
  }
}
watch(
  () => [help.open, help.topic, help.section],
  () => help.open && void land(),
  { immediate: true },
);

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
// Capture phase, so the help takes Escape and Tab before an open dialog does.
function onKey(e: KeyboardEvent) {
  if (!help.open) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeHelp();
  } else if (e.key === 'Tab' && panel.value?.contains(document.activeElement)) {
    const items = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (at <= 0 ? items.at(-1) : items[at - 1]) : items[(at + 1) % items.length];
    e.preventDefault();
    next?.focus();
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));

function open(id: string, section?: string) {
  showTopic(id, section);
}
</script>

<template>
  <Teleport to="body">
    <aside v-if="help.open && topic" ref="panel" class="help-drawer" :aria-labelledby="titleId">
      <div class="d-head">
        <h2 :id="titleId" ref="title" tabindex="-1">{{ help.query ? 'Search' : topic.title }}</h2>
        <button class="icon-btn" type="button" aria-label="Close help" title="Close (Esc)" @click="closeHelp">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </button>
      </div>
      <div class="field d-search">
        <input
          v-model="help.query"
          type="search"
          placeholder="Search all help topics"
          aria-label="Search all help topics"
          autocomplete="off"
        />
      </div>
      <div class="d-body">
        <p v-if="back" class="small">
          <button class="btn-link" type="button" @click="open(pageTopic)">← Back to {{ back.title }}</button>
        </p>
        <template v-if="help.query.trim()">
          <ul v-if="hits.length" class="hits" aria-label="Search results">
            <li v-for="h in hits" :key="`${h.topic}#${h.section ?? ''}`">
              <button type="button" @click="open(h.topic, h.section)">
                <span>{{ h.heading }}</span>
                <span class="small muted">{{ h.topicTitle }}</span>
              </button>
            </li>
          </ul>
          <p v-else class="muted" role="status">No help matches “{{ help.query.trim() }}”.</p>
        </template>
        <template v-else>
          <MarkdownLite v-if="topic.intro" :source="topic.intro" />
          <section v-for="s in topic.sections" :key="s.id">
            <h3 :id="`${titleId}-${s.id}`" tabindex="-1">{{ s.heading }}</h3>
            <MarkdownLite :source="s.body" />
          </section>
          <nav v-if="related.length" class="related" aria-label="Related help">
            <h3>Related</h3>
            <ul>
              <li v-for="r in related" :key="r.id">
                <a href="#" @click.prevent="open(r.id)">{{ r.title }}</a>
              </li>
            </ul>
          </nav>
        </template>
      </div>
      <div class="d-foot small">
        <span v-if="overview?.version">Help for Synoikia {{ overview.version }}</span>
        <a :href="EDIT_URL(help.topic)" target="_blank" rel="noopener noreferrer">Suggest an edit ↗</a>
      </div>
    </aside>
  </Teleport>
</template>

<style scoped>
.help-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 60;
  width: min(380px, 100vw);
  display: flex;
  flex-direction: column;
  background: var(--surface-100);
  border-left: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
}
.d-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 8px 20px;
}
.d-head h2 {
  margin: 0;
  font-size: 18px;
}
.d-head h2:focus,
.d-body h3:focus {
  outline: none;
}
.icon-btn {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--radius-full);
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--surface-300);
  color: var(--ink);
}
.icon-btn svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
}
.d-search {
  margin: 0 20px 8px;
}
.d-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 20px 16px;
}
.d-body h3 {
  margin: 16px 0 4px;
  font-size: 14px;
  scroll-margin-top: 8px;
}
.hits {
  list-style: none;
  margin: 0;
  padding: 0;
}
.hits button {
  width: 100%;
  display: grid;
  gap: 2px;
  text-align: left;
  padding: 8px;
  border: none;
  border-radius: var(--radius-md);
  background: none;
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}
.hits button:hover {
  background: var(--brand-subtle);
}
.related {
  margin-top: 16px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.related ul {
  margin: 0;
  padding-left: 18px;
}
.d-foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 20px;
  border-top: 1px solid var(--border);
  color: var(--ink-muted);
}
.d-foot a {
  margin-left: auto;
}
</style>
