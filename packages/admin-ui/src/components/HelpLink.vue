<script setup lang="ts">
import { openHelp } from '../composables/useHelp';

/** A `?` beside a heading whose help is one part of a long topic (@id:portal-help). */
defineProps<{ topic: string; section: string; label: string }>();
</script>

<template>
  <button class="help-link" type="button" :aria-label="`Help on ${label}`" @click="openHelp(topic, section)">?</button>
</template>

<style scoped>
.help-link {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  margin: 0 0 0 6px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  vertical-align: middle;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-full);
  background: var(--surface-100);
  color: var(--ink-muted);
  font: 600 11px/1 var(--font-sans);
  cursor: pointer;
}
.help-link:hover {
  color: var(--ink);
  border-color: var(--ink-muted);
}
</style>
