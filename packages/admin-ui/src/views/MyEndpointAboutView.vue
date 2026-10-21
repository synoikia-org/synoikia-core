<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { errorText } from '../api';
import { useMyEndpointAboutQuery } from '../composables/useMyEndpoints';

/** An endpoint outside the user's role (ADR-0010): its name and plugin, and who to ask for access. */
const route = useRoute();
const { data: about, error: loadError, isPending: loading } = useMyEndpointAboutQuery(() => String(route.params.id));
const error = computed(() => (loadError.value ? errorText(loadError.value) : undefined));
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="mono">/{{ about?.slug ?? '…' }}</h1>
        <p class="sub">{{ about ? `${about.displayName} · ${about.plugin}` : '' }}</p>
      </div>
    </div>
    <div class="stack" :aria-busy="loading">
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <template v-else-if="about">
        <p v-if="about.description">{{ about.description }}</p>
        <p class="small muted">
          Your role: <strong>{{ about.role }}</strong>
        </p>
        <p class="alert warn" role="status">
          You don't have access to this endpoint. Contact an administrator if you need it.
        </p>
      </template>
      <p><RouterLink to="/my">← My endpoints</RouterLink></p>
    </div>
  </div>
</template>
