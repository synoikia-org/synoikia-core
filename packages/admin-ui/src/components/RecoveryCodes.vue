<script setup lang="ts">
/** New recovery codes, shown once until the person says they saved them. */
defineProps<{ codes: string[] }>();
const emit = defineEmits<{ saved: [] }>();
</script>

<template>
  <div class="stack">
    <p class="small">
      Save these recovery codes somewhere safe. Each works once if you lose your authenticator. They are not shown
      again.
    </p>
    <pre class="code recovery">{{ codes.join('\n') }}</pre>
    <div><button class="btn btn-primary" type="button" @click="emit('saved')">I saved them</button></div>
  </div>
</template>

<style scoped>
.recovery {
  columns: 2;
}
</style>
