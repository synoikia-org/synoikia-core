<script setup lang="ts">
import HelpButton from './HelpButton.vue';

defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <div class="page-header">
    <div>
      <h1>{{ title }}</h1>
      <p v-if="subtitle" class="sub">{{ subtitle }}</p>
    </div>
    <div class="actions">
      <slot />
      <HelpButton />
    </div>
  </div>
</template>
