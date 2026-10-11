<script setup lang="ts">
import { useRoute } from 'vue-router';
import PageHeader from '../../components/PageHeader.vue';

const route = useRoute();
const tabs = [
  { path: 'client-auth', label: 'Client auth' },
  { path: 'user-auth', label: 'User auth' },
  { path: 'users', label: 'Users' },
  { path: 'roles', label: 'Roles' },
  { path: 'notifications', label: 'Notifications' },
  { path: 'server', label: 'Server settings' },
];
</script>

<template>
  <div class="page">
    <PageHeader title="Settings" />
    <nav class="tabs" aria-label="Settings sections">
      <RouterLink
        v-for="t in tabs"
        :key="t.path"
        :to="`/settings/${t.path}`"
        :class="{ active: route.path === `/settings/${t.path}` }"
      >
        {{ t.label }}
      </RouterLink>
    </nav>
    <RouterView />
  </div>
</template>
