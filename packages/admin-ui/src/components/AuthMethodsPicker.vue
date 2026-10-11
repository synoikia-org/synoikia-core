<script setup lang="ts">
import { computed, useId } from 'vue';
import { AUTH_METHOD_LABELS } from '../format';
import { AUTH_METHODS } from '../types';
import type { AuthMethod } from '../types';

/** An endpoint's accepted client auth methods (design §6.2): null accepts every globally enabled method. */
const methods = defineModel<AuthMethod[] | null>({ required: true });
const props = defineProps<{
  /** The globally enabled methods; undefined while the settings load. */
  enabled: AuthMethod[] | undefined;
}>();

const uid = useId();
const limited = computed({
  get: () => methods.value !== null,
  // Limiting starts from the globally enabled methods; the radio stays disabled until they load.
  set: (on) => (methods.value = on ? [...(props.enabled ?? [])] : null),
});
const effective = computed(() =>
  props.enabled ? (methods.value ?? AUTH_METHODS).filter((m) => props.enabled?.includes(m)) : undefined,
);

function toggle(m: AuthMethod, on: boolean) {
  const current = methods.value ?? [];
  methods.value = AUTH_METHODS.filter((x) => (x === m ? on : current.includes(x)));
}
</script>

<template>
  <fieldset class="methods" :aria-describedby="effective?.length === 0 ? `${uid}-empty` : `${uid}-help`">
    <legend>Accepted client auth</legend>
    <label class="row small"
      ><input v-model="limited" type="radio" :name="`${uid}-mode`" :value="false" /> All enabled methods</label
    >
    <label class="row small"
      ><input v-model="limited" type="radio" :name="`${uid}-mode`" :value="true" :disabled="!enabled" /> Only
      these</label
    >
    <div v-if="limited" class="subset">
      <label v-for="m in AUTH_METHODS" :key="m" class="row small">
        <input
          type="checkbox"
          :checked="methods?.includes(m)"
          :disabled="!!enabled && !enabled.includes(m) && !methods?.includes(m)"
          @change="toggle(m, ($event.target as HTMLInputElement).checked)"
        />
        {{ AUTH_METHOD_LABELS[m] }}
        <span v-if="enabled && !enabled.includes(m)" class="muted">(off under Client auth)</span>
      </label>
    </div>
    <p v-if="effective?.length === 0" :id="`${uid}-empty`" class="alert warn" data-warn="no-auth-method">
      No accepted method is enabled under <RouterLink to="/settings/client-auth">Settings → Client auth</RouterLink>.
      This endpoint refuses every call.
    </p>
    <p v-else :id="`${uid}-help`" class="help small muted">
      Methods are enabled under <RouterLink to="/settings/client-auth">Settings → Client auth</RouterLink>; an endpoint
      can only accept fewer.
    </p>
  </fieldset>
</template>

<style scoped>
.methods {
  border: none;
  padding: 0;
  margin: 0 0 14px;
}
.methods legend {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-muted);
  margin-bottom: 5px;
  padding: 0;
}
.methods input {
  accent-color: var(--brand);
}
.methods label + label,
.subset label + label {
  margin-top: 4px;
}
.subset {
  margin: 4px 0 0 22px;
}
.help,
.alert {
  margin: 6px 0 0;
}
</style>
