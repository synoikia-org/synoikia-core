<script setup lang="ts">
import { useId } from 'vue';

/** The endpoint's `formElicitationApprovals` (ADR-0006): Ask operations approved in the agent session. */
const on = defineModel<boolean>({ required: true });
const uid = useId();
</script>

<template>
  <div class="field check">
    <label>
      <input v-model="on" type="checkbox" :aria-describedby="on ? `${uid}-note` : undefined" />
      Approve Ask operations in the agent session (form prompt or chat card)
    </label>
  </div>
  <p v-if="on" :id="`${uid}-note`" class="alert warn" role="note">
    A client connected to this endpoint could then approve those calls itself, with nobody checking. Locked operations
    and ones that need a typed confirmation still need the approval page.
  </p>
</template>
