<script setup lang="ts">
import { useRoute } from 'vue-router';
import { openHelp, useHelp } from '../composables/useHelp';

/** The help of the current page (@id:portal-help), from the top corner of its header. */
const route = useRoute();
const help = useHelp();
</script>

<template>
  <button
    v-if="route.meta.help"
    class="help-btn"
    type="button"
    aria-label="Help for this page"
    title="Help (?)"
    :aria-expanded="help.open"
    @click="openHelp(route.meta.help)"
  >
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.2" />
      <path d="M7.7 7.6a2.4 2.4 0 1 1 3.3 2.2c-.6.3-1 .8-1 1.5v.5" />
      <circle class="dot" cx="10" cy="14.4" r=".7" />
    </svg>
  </button>
</template>

<style scoped>
.help-btn {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
}
.help-btn:hover,
.help-btn[aria-expanded='true'] {
  background: var(--surface-300);
  color: var(--ink);
}
svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
}
svg .dot {
  fill: currentColor;
  stroke: none;
}
</style>
