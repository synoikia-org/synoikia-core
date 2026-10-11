<script setup lang="ts">
import { messageRole } from '../../a11y';
import { computed, ref, toRaw, watch } from 'vue';
import { errorText } from '../../api';
import { useSaveSettings, useSettingsQuery } from '../../composables/useSettings';
import type { Settings } from '../../types';

type Message = { kind: 'ok' | 'error'; text: string };

const settingsQuery = useSettingsQuery();
const saveAudit = useSaveSettings('audit');
const audit = ref<Settings['audit']>();
const saved = ref<Message>();
const message = computed<Message | undefined>(() =>
  settingsQuery.error.value ? { kind: 'error', text: errorText(settingsQuery.error.value) } : saved.value,
);

// The form is a draft of its section; a save replaces only that section in the cache with core's answer.
watch(
  () => settingsQuery.data.value?.audit,
  (s) => s && (audit.value = structuredClone(toRaw(s))),
  { immediate: true },
);

function save() {
  saveAudit.mutate(audit.value, {
    onSuccess: () => (saved.value = { kind: 'ok', text: 'Saved.' }),
    onError: (err) => (saved.value = { kind: 'error', text: errorText(err) }),
  });
}
</script>

<template>
  <div class="stack">
    <p v-if="!audit && message" class="alert error" role="alert">{{ message.text }}</p>

    <form v-if="audit" class="card" @submit.prevent="save">
      <h2>Audit log retention</h2>
      <div class="field">
        <label for="a-ret">Delete entries older than (days)</label>
        <input
          id="a-ret"
          :value="audit.retentionDays ?? ''"
          type="number"
          min="7"
          placeholder="Keep forever"
          aria-describedby="a-ret-help"
          @input="
            audit.retentionDays = ($event.target as HTMLInputElement).value
              ? Number(($event.target as HTMLInputElement).value)
              : null
          "
        />
        <p id="a-ret-help" class="help">
          Empty keeps everything. The default is 90 days. Purges are themselves audited.
        </p>
      </div>
      <p v-if="message" class="alert" :class="message.kind" :role="messageRole(message.kind)">
        {{ message.text }}
      </p>
      <button class="btn btn-primary" type="submit">Save</button>
    </form>
  </div>
</template>
