<script setup lang="ts">
import { useId } from 'vue';

/** The endpoint's `idleStopMs` (ADR-0022): when the plugin stops while nobody calls it. */
const idleStopMs = defineModel<number | null>({ required: true });
const uid = useId();
const MINUTE = 60_000;
const choices: { label: string; value: number | null }[] = [
  { label: 'After 5 minutes', value: 5 * MINUTE },
  { label: 'After 10 minutes', value: 10 * MINUTE },
  { label: 'After 30 minutes', value: 30 * MINUTE },
  { label: 'After 1 hour', value: 60 * MINUTE },
  { label: 'After 2 hours', value: 120 * MINUTE },
  { label: 'After 6 hours', value: 360 * MINUTE },
  { label: 'After 24 hours', value: 1440 * MINUTE },
  { label: 'Always on', value: null },
];
const costly = () => idleStopMs.value === null || idleStopMs.value > 60 * MINUTE;
</script>

<template>
  <div class="field">
    <label :for="`${uid}-idle`">Stop the plugin when idle</label>
    <select :id="`${uid}-idle`" v-model="idleStopMs" :aria-describedby="costly() ? `${uid}-note` : `${uid}-help`">
      <option v-for="c in choices" :key="c.label" :value="c.value">{{ c.label }}</option>
    </select>
    <p v-if="!costly()" :id="`${uid}-help`" class="help">
      The plugin stops when nobody calls this endpoint, and starts again at the next call.
    </p>
  </div>
  <p v-if="costly()" :id="`${uid}-note`" class="alert warn" role="note">
    The server may use more memory: the plugin keeps running while nobody calls this endpoint.
  </p>
</template>
