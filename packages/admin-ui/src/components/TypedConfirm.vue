<script setup lang="ts">
import { useId } from 'vue';

// An unsigned install or revert: the admin types the plugin id (design §4.3).
defineProps<{ expected: string; action: string }>();
const model = defineModel<string>({ required: true });
const inputId = useId();
</script>

<template>
  <div class="field">
    <label :for="inputId"
      >Type <code>{{ expected }}</code> to {{ action }}</label
    >
    <input :id="inputId" v-model="model" autocomplete="off" spellcheck="false" />
  </div>
</template>
